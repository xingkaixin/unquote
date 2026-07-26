import { act, cleanup, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  largeFileSearchWorkerTimeoutMs,
  searchWorkerTimeoutMs,
  useSearchWorker,
} from "../src/hooks/use-search-worker";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import type { SearchMatch } from "../src/lib/tree";

interface Listener {
  (event: MessageEvent): void;
}

const defaultOptions = { regex: false, caseSensitive: false, jq: false };

const matchStub = (recordId: string): SearchMatch => ({
  recordId,
  pathText: "$",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

class MockWorker {
  static instances: MockWorker[] = [];
  listener: Listener | null = null;
  terminated = false;
  postMessage = vi.fn();

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
    this.terminated = true;
    this.listener = null;
  }

  respond(data: unknown) {
    this.listener?.({ data } as MessageEvent);
  }
}

// Populated in the render body itself (not an effect), so it captures every
// render React commits — including one that a passive-effect-based reset
// would race past before assertions ever get to observe it via `screen`.
interface RenderLogEntry {
  query: string;
  text: string;
  sourceFile: File | null;
  status: string;
  matches: string;
}
let renderLog: RenderLogEntry[] = [];

const Probe = ({
  query,
  text,
  sourceFile = null,
  sourceRevision = 0,
  debounceMs = 0,
  options = defaultOptions,
}: {
  query: string;
  text: string;
  sourceFile?: File | null;
  sourceRevision?: number;
  debounceMs?: number;
  options?: typeof defaultOptions;
}) => {
  const sourceAccess = useMemo(
    () => (sourceFile ? createLocalFileAccess(sourceFile) : null),
    [sourceFile],
  );
  const result = useSearchWorker({
    text,
    sourceAccess,
    query,
    options,
    debounceMs,
    sourceRevision,
  });
  renderLog.push({
    query,
    text,
    sourceFile,
    status: result.status,
    matches: result.matches?.[0]?.recordId ?? "",
  });
  return (
    <div>
      <div data-testid="status">{result.status}</div>
      <div data-testid="error-kind">{result.errorKind ?? ""}</div>
      <div data-testid="record-id">{result.matches?.[0]?.recordId ?? ""}</div>
    </div>
  );
};

describe("useSearchWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performance.clearMeasures("unquote:search:request");
    MockWorker.instances = [];
    renderLog = [];
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("posts a search-text request and applies the completed result", () => {
    const measure = vi.spyOn(performance, "measure");
    render(<Probe query="hello" text='{"a":"hello"}' />);

    const worker = MockWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "search-text",
      requestId: 1,
      source: {
        kind: "content",
        sourceRevision: 0,
        text: '{"a":"hello"}',
      },
      query: "hello",
      options: defaultOptions,
    });

    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("A")] }));
    expect(worker.terminated).toBe(false);
    expect(measure).toHaveBeenCalledWith(
      "unquote:search:request",
      expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("A");
  });

  it("reuses a worker after a completed search", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("first")] }));

    rerender(<Probe query="b" text="text" />);

    expect(MockWorker.instances).toHaveLength(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "search-text",
      requestId: 2,
      source: { kind: "cached", sourceRevision: 0 },
      query: "b",
      options: defaultOptions,
    });
    act(() => worker.respond({ type: "result", requestId: 2, matches: [matchStub("second")] }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("second");
  });

  it("terminates a superseded worker and applies only the new query", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const staleWorker = MockWorker.instances[0]!;
    rerender(<Probe query="b" text="text" />);

    expect(staleWorker.terminated).toBe(true);
    expect(MockWorker.instances).toHaveLength(2);
    const currentWorker = MockWorker.instances[1]!;
    expect(currentWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ query: "b", requestId: 2 }),
    );

    act(() => staleWorker.respond({ type: "result", requestId: 1, matches: [matchStub("stale")] }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("");

    act(() =>
      currentWorker.respond({ type: "result", requestId: 2, matches: [matchStub("fresh")] }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh");
  });

  it("terminates the active worker when the query is cleared", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    rerender(<Probe query="" text="text" />);

    expect(worker.terminated).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("terminates the worker and reports a timeout when no response arrives", async () => {
    render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    await act(() => vi.advanceTimersByTimeAsync(searchWorkerTimeoutMs));
    expect(worker.terminated).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("timeout");
  });

  it("creates a fresh worker for the next query after a timeout", async () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    await act(() => vi.advanceTimersByTimeAsync(searchWorkerTimeoutMs));
    expect(MockWorker.instances).toHaveLength(1);

    rerender(<Probe query="b" text="text" />);
    expect(MockWorker.instances).toHaveLength(2);

    const worker = MockWorker.instances[1]!;
    act(() => worker.respond({ type: "result", requestId: 2, matches: [matchStub("recovered")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("recovered");
  });

  it("extends the timeout for a large local file", async () => {
    const file = new File(["x".repeat(1_000_001)], "large.jsonl");
    render(<Probe query="a" text="" sourceFile={file} />);
    const worker = MockWorker.instances[0]!;

    await act(() => vi.advanceTimersByTimeAsync(searchWorkerTimeoutMs));
    expect(worker.terminated).toBe(false);

    await act(() =>
      vi.advanceTimersByTimeAsync(largeFileSearchWorkerTimeoutMs - searchWorkerTimeoutMs),
    );
    expect(worker.terminated).toBe(true);
  });

  it("reports a worker error response", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    act(() => worker.respond({ type: "error", requestId: 1, message: "TypeError" }));
    expect(worker.terminated).toBe(false);
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("worker-error");

    rerender(<Probe query="b" text="text" />);
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ kind: "content", sourceRevision: 0, text: "text" }),
      }),
    );
  });

  it("stays idle and does not post a message for an empty query", () => {
    render(<Probe query="" text='{"a":"hello"}' />);

    expect(MockWorker.instances).toHaveLength(0);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("falls back to a synchronous main-thread search when Worker is unavailable", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    render(<Probe query="hello" text='{"a":"hello"}' />);

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-1");
  });

  it("supports regex search via the synchronous fallback when Worker is unavailable", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    render(
      <Probe query="hel+o" text='{"a":"hello"}' options={{ ...defaultOptions, regex: true }} />,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-1");
  });

  it("returns null matches for an invalid regex via the synchronous fallback, matching the worker path", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    render(<Probe query="[" text='{"a":"hello"}' options={{ ...defaultOptions, regex: true }} />);

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
  });

  it("debounces consecutive queries, dispatching only the last one after the window elapses", () => {
    const { rerender } = render(<Probe query="a" text="text" debounceMs={250} />);
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(MockWorker.instances).toHaveLength(0);

    act(() => vi.advanceTimersByTime(100));
    rerender(<Probe query="ab" text="text" debounceMs={250} />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<Probe query="abc" text="text" debounceMs={250} />);
    act(() => vi.advanceTimersByTime(200));
    // 200ms since the last change is still short of the 250ms window.
    expect(MockWorker.instances).toHaveLength(0);

    act(() => vi.advanceTimersByTime(50));
    expect(MockWorker.instances).toHaveLength(1);
    const worker = MockWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ query: "abc", requestId: 1 }),
    );
  });

  it("terminates a superseded search-file worker", () => {
    const file = new File(["{}"], "payload.jsonl");
    const { rerender } = render(<Probe query="a" text="" sourceFile={file} />);

    const staleWorker = MockWorker.instances[0]!;
    expect(staleWorker.postMessage).toHaveBeenCalledWith({
      type: "search-file",
      requestId: 1,
      file,
      query: "a",
      options: defaultOptions,
    });

    rerender(<Probe query="b" text="" sourceFile={file} />);
    expect(staleWorker.terminated).toBe(true);
    const currentWorker = MockWorker.instances[1]!;

    act(() =>
      staleWorker.respond({
        type: "result",
        requestId: 1,
        matches: [matchStub("stale-file")],
      }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("");

    act(() =>
      currentWorker.respond({
        type: "result",
        requestId: 2,
        matches: [matchStub("fresh-file")],
      }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh-file");
  });

  it("terminates the active worker when the hook unmounts", () => {
    const { unmount } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [] }));

    unmount();

    expect(worker.terminated).toBe(true);
  });

  // Asserts against every render React actually committed for the rerender
  // call, not just the state left after `act` finishes flushing passive
  // effects: an effect-based reset can still commit one stale render first
  // and a post-act `screen` assertion would never see it.
  const rendersCommittedDuring = (perform: () => void): RenderLogEntry[] => {
    const startIndex = renderLog.length;
    perform();
    return renderLog.slice(startIndex);
  };

  it("resets to pending immediately on rerender when text changes, never exposing stale matches", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("record-3")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    const committed = rendersCommittedDuring(() =>
      rerender(<Probe query="a" text="different text" sourceRevision={1} />),
    );

    expect(worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          kind: "content",
          sourceRevision: 1,
          text: "different text",
        }),
      }),
    );

    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
    expect(
      committed.some((entry) => entry.status === "complete" && entry.matches === "record-3"),
    ).toBe(false);
  });

  it("resets to pending immediately on rerender when sourceFile changes, never exposing stale matches", () => {
    const fileA = new File(["{}"], "a.jsonl");
    const fileB = new File(["{}"], "b.jsonl");
    const { rerender } = render(<Probe query="a" text="" sourceFile={fileA} />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("record-3")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    const committed = rendersCommittedDuring(() =>
      rerender(<Probe query="a" text="" sourceFile={fileB} sourceRevision={1} />),
    );

    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
    expect(
      committed.some((entry) => entry.status === "complete" && entry.matches === "record-3"),
    ).toBe(false);
  });

  it("resets to pending immediately on rerender when options change, never exposing stale matches", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("record-3")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    const committed = rendersCommittedDuring(() =>
      rerender(
        <Probe query="a" text="text" options={{ ...defaultOptions, caseSensitive: true }} />,
      ),
    );

    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
    expect(
      committed.some((entry) => entry.status === "complete" && entry.matches === "record-3"),
    ).toBe(false);
  });

  it("keeps completed matches on rerender when inputs are unchanged", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("record-3")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    rerender(<Probe query="a" text="text" />);

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-3");
  });

  it("goes idle immediately when the query is cleared after a completed search", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("record-3")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    rerender(<Probe query="" text="text" />);

    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
  });
});
