import type { ParseResult } from "@unquote/core";
import { isParsed, parseInput } from "@unquote/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParser } from "../src/hooks/use-parser";
import { I18nProvider } from "../src/i18n/context";
import { createLocalFileAccess } from "../src/lib/local-file-source";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

interface Listener {
  (event: MessageEvent): void;
}

const resultFromRecords = (records: ParseResult["records"]): ParseResult => ({
  format: "jsonl",
  records,
  stats: {
    total: records.length,
    success: records.filter(isParsed).length,
    failed: records.filter((record) => !isParsed(record)).length,
  },
});

const failedRecord = (lineNumber: number, summary: string): ParseResult["records"][number] => ({
  ...parseInput("not-json", { forcedFormat: "jsonl" }).records[0]!,
  id: `record-${lineNumber}`,
  lineNumber,
  summary,
});

class MockWorker {
  static instances: MockWorker[] = [];
  listener: Listener | null = null;
  messages: Array<{
    type: string;
    requestId: number;
    input?: string;
    chunk?: string;
    file?: File;
    forcedFormat?: string;
  }> = [];
  terminateCalls = 0;

  constructor(..._args: unknown[]) {
    MockWorker.instances.push(this);
  }

  addEventListener(_type: string, listener: Listener) {
    this.listener = listener;
  }

  removeEventListener() {
    this.listener = null;
  }

  terminate() {
    this.terminateCalls += 1;
    this.listener = null;
  }

  postMessage(payload: {
    type: string;
    requestId: number;
    input?: string;
    chunk?: string;
    file?: File;
    forcedFormat?: string;
  }) {
    this.messages.push(payload);
    if (payload.type === "start-jsonl") {
      return;
    }
    if (payload.type === "file-jsonl") {
      const delay = payload.file?.name === "old.jsonl" ? 20 : 0;
      setTimeout(() => {
        this.listener?.({
          data: {
            type: "error",
            requestId: payload.requestId,
            stats: { total: 0, success: 0, failed: 0 },
            progress: {
              processedLines: 0,
              success: 0,
              failed: 0,
              elapsedMs: 1,
              done: true,
            },
          },
        } as MessageEvent);
      }, delay);
      return;
    }

    const input = payload.input ?? payload.chunk ?? "";
    if (input === "first") {
      setTimeout(() => {
        this.listener?.({
          data: {
            type: "complete-result",
            requestId: payload.requestId,
            result: resultFromRecords([failedRecord(1, "old")]),
            agentSession: null,
            progress: {
              processedLines: 1,
              success: 0,
              failed: 1,
              elapsedMs: 10,
              done: true,
            },
          },
        } as MessageEvent);
      }, 20);
      return;
    }

    setTimeout(() => {
      this.listener?.({
        data: {
          type: "batch",
          requestId: payload.requestId,
          records: [failedRecord(1, "new-1")],
          stats: { total: 1, success: 0, failed: 1 },
          progress: {
            processedLines: 1,
            success: 0,
            failed: 1,
            elapsedMs: 1,
            done: false,
          },
        },
      } as MessageEvent);
      this.listener?.({
        data: {
          type: "batch",
          requestId: payload.requestId,
          records: [failedRecord(2, "new-2")],
          stats: { total: 2, success: 0, failed: 2 },
          progress: {
            processedLines: 2,
            success: 0,
            failed: 2,
            elapsedMs: 2,
            done: true,
          },
        },
      } as MessageEvent);
      this.listener?.({
        data: {
          type: "complete-stats",
          requestId: payload.requestId,
          stats: { total: 2, success: 0, failed: 2 },
          agentSession: null,
          progress: {
            processedLines: 2,
            success: 0,
            failed: 2,
            elapsedMs: 2,
            done: true,
          },
        },
      } as MessageEvent);
    }, 0);
  }
}

interface ProbeProps {
  input: string;
  forcedFormat?: "json" | "jsonl";
  sourceFile?: File;
}

const ParserProbe = ({ input, forcedFormat, sourceFile }: ProbeProps) => {
  const sourceAccess = useMemo(
    () => (sourceFile ? createLocalFileAccess(sourceFile) : null),
    [sourceFile],
  );
  const { result, progress, agentSession } = useParser({
    sourceRevision: 0,
    input,
    forcedFormat,
    sourceAccess,
  });
  return (
    <div>
      <div data-testid="records">{result.records.map((record) => record.summary).join(",")}</div>
      <div data-testid="stats">{result.stats.total}</div>
      <div data-testid="progress">{progress.done ? "done" : "pending"}</div>
      <div data-testid="format">{result.format}</div>
      <div data-testid="agent-session">{agentSession ? "present" : "absent"}</div>
    </div>
  );
};

const Probe = (props: ProbeProps) => (
  <I18nProvider>
    <ParserProbe {...props} />
  </I18nProvider>
);

describe("useParser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    MockWorker.instances = [];
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("merges batches and ignores stale responses", async () => {
    const { rerender } = render(<Probe input="first" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    rerender(<Probe input="second" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(screen.getByTestId("stats")).toHaveTextContent("2");
    expect(screen.getByTestId("records")).toHaveTextContent("new-1,new-2");
    expect(screen.getByTestId("records")).not.toHaveTextContent("old");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(MockWorker.instances).toHaveLength(1);
  });

  it("finishes when worker file reading fails", async () => {
    render(<Probe input="" sourceFile={new File(["x"], "broken.jsonl")} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith("Failed to read file");
  });

  it("ignores a stale worker file error", async () => {
    const { rerender } = render(<Probe input="" sourceFile={new File(["old"], "old.jsonl")} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    rerender(<Probe input="" sourceFile={new File(["new"], "new.jsonl")} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it("parses text on the main thread when Worker is unavailable", () => {
    Reflect.deleteProperty(globalThis, "Worker");

    render(<Probe input='{"value":1}' forcedFormat="json" />);

    expect(screen.getByTestId("format")).toHaveTextContent("json");
    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(screen.getByTestId("agent-session")).toHaveTextContent("absent");
  });

  it("parses a file on the main thread and ignores an obsolete read", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    let resolveOldFile: ((value: string) => void) | undefined;
    const oldFile = new File([], "old.jsonl");
    const newFile = new File([], "new.jsonl");
    Object.defineProperty(oldFile, "text", {
      value: () => new Promise<string>((resolve) => (resolveOldFile = resolve)),
    });
    Object.defineProperty(newFile, "text", {
      value: () => Promise.resolve('{"source":"new"}\n'),
    });

    const { rerender } = render(<Probe input="" sourceFile={oldFile} />);
    rerender(<Probe input="" sourceFile={newFile} />);
    await act(async () => undefined);
    expect(screen.getByTestId("records")).toHaveTextContent("source:new");

    await act(async () => resolveOldFile?.('{"source":"old"}\n'));
    expect(screen.getByTestId("records")).toHaveTextContent("source:new");
    expect(screen.getByTestId("records")).not.toHaveTextContent("source:old");
    expect(screen.getByTestId("stats")).toHaveTextContent("1");
  });

  it("reports a main-thread file read failure", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const file = new File([], "broken.jsonl");
    Object.defineProperty(file, "text", {
      value: () => Promise.reject(new Error("read failed")),
    });

    render(<Probe input="" sourceFile={file} />);
    await act(async () => undefined);

    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith("Failed to read file");
  });

  it("posts non-streaming JSON requests without an implicit format", async () => {
    const { rerender, unmount } = render(<Probe input='{"value":1}' />);
    await act(() => vi.advanceTimersByTimeAsync(121));

    expect(MockWorker.instances[0]?.messages).toContainEqual({
      type: "parse",
      requestId: 1,
      input: '{"value":1}',
    });

    rerender(<Probe input='{"value":2}' forcedFormat="json" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    expect(MockWorker.instances[0]?.messages).toContainEqual({
      type: "parse",
      requestId: 2,
      input: '{"value":2}',
      forcedFormat: "json",
    });

    unmount();
    expect(MockWorker.instances[0]?.terminateCalls).toBe(1);
  });

  it("streams large JSONL input in bounded chunks", async () => {
    const input = `${"x".repeat(256 * 1024)}\n{}`;
    render(<Probe input={input} forcedFormat="jsonl" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    const chunks = MockWorker.instances[0]?.messages.filter(
      (message) => message.type === "jsonl-chunk",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks?.[0]?.chunk).toHaveLength(256 * 1024);
    expect(chunks?.[1]?.chunk).toBe("\n{}");
  });
});
