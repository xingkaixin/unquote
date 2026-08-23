import type { ParseResult } from "@unquote/core";
import { isParsed, parseInput } from "@unquote/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParser } from "../src/hooks/use-parser";
import { I18nProvider } from "../src/i18n/context";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import { mainThreadWorkBudgetBytes } from "../src/lib/main-thread-budget";
import { MockWorkerEvents } from "./helpers/mock-worker-events";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

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

class MockWorker extends MockWorkerEvents {
  static instances: MockWorker[] = [];
  static failConstruction = false;
  static failJsonlEnrichment = false;
  static holdFileReads = false;
  // 1-based index of the first postMessage call that should throw.
  static postMessageFailsFrom: number | null = null;
  messages: Array<{
    type: string;
    requestId: number;
    input?: string;
    chunk?: string;
    done?: boolean;
    file?: File;
    forcedFormat?: string;
  }> = [];
  postMessageCalls = 0;
  terminateCalls = 0;
  preserveListenersOnTerminate = false;

  constructor(..._args: unknown[]) {
    super();
    if (MockWorker.failConstruction) {
      throw new Error("worker script failed to load");
    }
    MockWorker.instances.push(this);
  }

  terminate() {
    this.terminateCalls += 1;
    if (!this.preserveListenersOnTerminate) {
      this.clearListeners();
    }
  }

  postMessage(payload: {
    type: string;
    requestId: number;
    input?: string;
    chunk?: string;
    done?: boolean;
    file?: File;
    forcedFormat?: string;
  }) {
    this.postMessageCalls += 1;
    if (
      MockWorker.postMessageFailsFrom !== null &&
      this.postMessageCalls >= MockWorker.postMessageFailsFrom
    ) {
      throw new DOMException("payload could not be cloned", "DataCloneError");
    }
    this.messages.push(payload);
    if (payload.type === "start-jsonl") {
      return;
    }
    if (payload.type === "jsonl-chunk" && payload.done && MockWorker.failJsonlEnrichment) {
      setTimeout(() => {
        this.respond({
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
        });
      }, 0);
      return;
    }
    // Mirrors the real worker, which only reports a terminal response once the
    // stream is drained, and leaves "stalled" input open so failure paths can
    // be exercised mid-parse.
    if ((payload.type === "jsonl-chunk" && !payload.done) || payload.input === "stalled") {
      return;
    }
    if (payload.type === "file-jsonl") {
      if (MockWorker.holdFileReads) {
        return;
      }
      const delay = payload.file?.name === "old.jsonl" ? 20 : 0;
      setTimeout(() => {
        this.respond({
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
        });
      }, delay);
      return;
    }

    const input = payload.input ?? payload.chunk ?? "";
    if (input === "first") {
      setTimeout(() => {
        this.respond({
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
        });
      }, 20);
      return;
    }

    setTimeout(() => {
      this.respond({
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
      });
      this.respond({
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
      });
      this.respond({
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
      });
    }, 0);
  }
}

interface ProbeProps {
  input: string;
  forcedFormat?: "json" | "jsonl";
  sourceFile?: File;
  revision?: number;
  onAgentSessionDetected?: (() => void) | undefined;
}

const ParserProbe = ({
  input,
  forcedFormat,
  sourceFile,
  revision = 0,
  onAgentSessionDetected,
}: ProbeProps) => {
  const source = useMemo(
    () =>
      sourceFile
        ? createStreamingFileSourceRevision(revision, createLocalFileAccess(sourceFile), "jsonl")
        : createTextSourceRevision(revision, input, forcedFormat ?? "auto"),
    [forcedFormat, input, revision, sourceFile],
  );
  const { result, progress, agentSession } = useParser({ source, onAgentSessionDetected });
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

const renderAfterMount = (props: ProbeProps) => {
  const rendered = render(<Probe input="" />);
  rendered.rerender(<Probe {...props} />);
  return rendered;
};

describe("useParser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    MockWorker.instances = [];
    MockWorker.failConstruction = false;
    MockWorker.failJsonlEnrichment = false;
    MockWorker.holdFileReads = false;
    MockWorker.postMessageFailsFrom = null;
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("reports Agent detection before the worker finishes parsing", async () => {
    const onAgentSessionDetected = vi.fn();
    renderAfterMount({
      input: "stalled",
      forcedFormat: "json",
      onAgentSessionDetected,
    });
    await act(() => vi.advanceTimersByTimeAsync(121));

    act(() => {
      MockWorker.instances[0]!.respond({
        type: "agent-session-detected",
        requestId: 1,
      });
    });

    expect(onAgentSessionDetected).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("progress")).toHaveTextContent("pending");
  });

  it("terminates a busy worker and publishes only the replacement source", async () => {
    const { rerender } = renderAfterMount({ input: "stalled", forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    const staleWorker = MockWorker.instances[0]!;
    staleWorker.preserveListenersOnTerminate = true;

    rerender(<Probe input="stalled" forcedFormat="json" revision={1} />);

    expect(staleWorker.terminateCalls).toBe(1);
    expect(MockWorker.instances).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(121));
    const activeWorker = MockWorker.instances[1]!;
    act(() => {
      activeWorker.respond({
        type: "complete-result",
        requestId: 2,
        result: resultFromRecords([failedRecord(1, "replacement")]),
        agentSession: null,
        progress: {
          processedLines: 1,
          success: 0,
          failed: 1,
          elapsedMs: 10,
          done: true,
        },
      });
      staleWorker.respond({
        type: "complete-result",
        requestId: 1,
        result: resultFromRecords([failedRecord(1, "old")]),
        agentSession: null,
        progress: {
          processedLines: 1,
          success: 0,
          failed: 1,
          elapsedMs: 10,
          done: true,
        },
      });
    });

    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("records")).toHaveTextContent("replacement");
    expect(screen.getByTestId("records")).not.toHaveTextContent("old");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(activeWorker.messages).toContainEqual({
      type: "parse",
      requestId: 2,
      input: "stalled",
      forcedFormat: "json",
    });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("keeps an idle worker when a replacement is removed before debounce dispatch", async () => {
    const { rerender } = renderAfterMount({ input: "second", forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());
    const worker = MockWorker.instances[0]!;

    rerender(<Probe input="stalled" forcedFormat="json" />);
    rerender(<Probe input="second" forcedFormat="json" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(MockWorker.instances).toHaveLength(1);
    expect(worker.terminateCalls).toBe(0);
    expect(worker.messages.filter((message) => message.type === "parse")).toEqual([
      { type: "parse", requestId: 1, input: "second", forcedFormat: "json" },
      { type: "parse", requestId: 3, input: "second", forcedFormat: "json" },
    ]);
    expect(toastMocks.error).not.toHaveBeenCalled();
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

  it("detects an Agent session on the main thread when Worker is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const input = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "main-thread-session" },
    });

    render(<Probe input={input} forcedFormat="jsonl" />);
    expect(screen.getByTestId("stats")).toHaveTextContent("1");

    await act(() => vi.dynamicImportSettled());

    expect(screen.getByTestId("agent-session")).toHaveTextContent("present");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
  });

  it("keeps the completed mount result while a Worker enriches JSONL input", async () => {
    const input = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "mount-session" },
    });

    render(
      <StrictMode>
        <Probe input={input} forcedFormat="jsonl" />
      </StrictMode>,
    );
    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");

    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(
      MockWorker.instances.some((worker) =>
        worker.messages.some((message) => message.type === "start-jsonl"),
      ),
    ).toBe(true);
    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
  });

  it("keeps the completed mount result when Agent enrichment fails", async () => {
    MockWorker.failJsonlEnrichment = true;
    const input = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "failed-enrichment" },
    });

    render(<Probe input={input} forcedFormat="jsonl" />);
    await act(() => vi.runAllTimersAsync());

    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(screen.getByTestId("agent-session")).toHaveTextContent("absent");
    expect(toastMocks.error).not.toHaveBeenCalled();
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
    await act(() => vi.dynamicImportSettled());
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
    const { rerender, unmount } = renderAfterMount({ input: '{"value":1}' });
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());
    const worker = MockWorker.instances[0]!;

    expect(worker.messages).toContainEqual({
      type: "parse",
      requestId: 1,
      input: '{"value":1}',
    });

    rerender(<Probe input='{"value":2}' forcedFormat="json" />);
    expect(MockWorker.instances).toHaveLength(1);
    expect(worker.terminateCalls).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(worker.messages).toContainEqual({
      type: "parse",
      requestId: 2,
      input: '{"value":2}',
      forcedFormat: "json",
    });

    unmount();
    expect(worker.terminateCalls).toBe(1);
  });

  it("terminates a busy worker once on unmount and ignores later worker activity", async () => {
    const { unmount } = renderAfterMount({ input: "first", forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    const worker = MockWorker.instances[0]!;

    unmount();
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(worker.terminateCalls).toBe(1);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("terminates each StrictMode worker at most once without an error toast", async () => {
    MockWorker.holdFileReads = true;
    const { unmount } = render(
      <StrictMode>
        <Probe input="" sourceFile={new File(["x"], "stalled.jsonl")} />
      </StrictMode>,
    );
    await act(() => vi.advanceTimersByTimeAsync(121));

    const activeWorker = MockWorker.instances.find((worker) =>
      worker.messages.some((message) => message.type === "file-jsonl"),
    );
    expect(activeWorker).toBeDefined();

    unmount();

    expect(MockWorker.instances).not.toHaveLength(0);
    expect(activeWorker?.terminateCalls).toBe(1);
    expect(MockWorker.instances.every((worker) => worker.terminateCalls <= 1)).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("parses on the main thread when the worker cannot be constructed", () => {
    MockWorker.failConstruction = true;

    renderAfterMount({ input: '{"value":1}', forcedFormat: "json" });

    expect(MockWorker.instances).toHaveLength(0);
    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
  });

  it("finishes the request when the worker rejects a posted message", async () => {
    MockWorker.postMessageFailsFrom = 1;

    renderAfterMount({ input: '{"value":1}', forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));

    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances[0]?.terminateCalls).toBe(1);
  });

  it.each([
    ["an uncaught worker error", (worker: MockWorker) => worker.fail()],
    ["an undeserializable message", (worker: MockWorker) => worker.failDeserialization()],
  ])("finishes a stalled parse after %s", async (_label, provokeFailure) => {
    renderAfterMount({ input: "stalled", forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    expect(screen.getByTestId("progress")).toHaveTextContent("pending");

    act(() => provokeFailure(MockWorker.instances[0]!));

    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances[0]?.terminateCalls).toBe(1);
  });

  it("builds a fresh worker for the request after a worker failure", async () => {
    const { rerender } = renderAfterMount({ input: "stalled", forcedFormat: "json" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    act(() => MockWorker.instances[0]!.fail());

    rerender(<Probe input="second" forcedFormat="jsonl" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(MockWorker.instances).toHaveLength(2);
    expect(screen.getByTestId("records")).toHaveTextContent("new-1,new-2");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
  });

  it.each([
    ["the stream cannot be started", 1, 0],
    ["a mid-stream chunk cannot be posted", 3, 1],
  ])("finishes a streaming parse when %s", async (_label, failsFrom, expectedChunks) => {
    MockWorker.postMessageFailsFrom = failsFrom;
    renderAfterMount({ input: `${"x".repeat(256 * 1024)}\n{}`, forcedFormat: "jsonl" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    const worker = MockWorker.instances[0]!;
    expect(worker.messages.filter((message) => message.type === "jsonl-chunk")).toHaveLength(
      expectedChunks,
    );
    expect(worker.terminateCalls).toBe(1);
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it("streams large JSONL input in bounded chunks", async () => {
    const input = `${"x".repeat(256 * 1024)}\n{}`;
    renderAfterMount({ input, forcedFormat: "jsonl" });
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    const chunks = MockWorker.instances[0]?.messages.filter(
      (message) => message.type === "jsonl-chunk",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks?.[0]?.chunk).toHaveLength(256 * 1024);
    expect(chunks?.[1]?.chunk).toBe("\n{}");
  });

  it("parses within the main-thread budget when Worker is unavailable", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const padding = " ".repeat(mainThreadWorkBudgetBytes - 32);
    const input = `{"value":1,"pad":"${padding.slice(0, mainThreadWorkBudgetBytes - 32)}"}`;
    expect(input.length).toBeLessThanOrEqual(mainThreadWorkBudgetBytes);

    render(<Probe input={input} forcedFormat="json" />);

    expect(screen.getByTestId("stats")).toHaveTextContent("1");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("refuses an oversized input instead of blocking the main thread", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const parse = vi.spyOn(JSON, "parse");
    const input = `{"pad":"${"x".repeat(mainThreadWorkBudgetBytes)}"}`;

    render(<Probe input={input} forcedFormat="json" />);

    // The heavy synchronous parse is never entered.
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByTestId("stats")).toHaveTextContent("0");
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledWith(
      "This input is too large to parse without a background worker",
    );
    parse.mockRestore();
  });

  it("refuses an oversized file instead of reading it on the main thread", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const file = new File([], "huge.jsonl");
    Object.defineProperty(file, "size", { value: mainThreadWorkBudgetBytes + 1 });
    const text = vi.fn(() => Promise.resolve(""));
    Object.defineProperty(file, "text", { value: text });

    render(<Probe input="" sourceFile={file} />);
    await act(async () => undefined);

    expect(text).not.toHaveBeenCalled();
    expect(screen.getByTestId("progress")).toHaveTextContent("done");
    expect(toastMocks.error).toHaveBeenCalledWith(
      "This input is too large to parse without a background worker",
    );
  });

  it("still uses the worker for an oversized input", async () => {
    const input = `${"x".repeat(mainThreadWorkBudgetBytes + 1)}\n{}`;

    render(<Probe input={input} forcedFormat="jsonl" />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    await act(() => vi.runOnlyPendingTimersAsync());

    expect(MockWorker.instances).toHaveLength(1);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
