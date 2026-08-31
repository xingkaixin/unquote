import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  largeFileSearchWorkerTimeoutMs,
  searchWorkerTimeoutMs,
  useSearchWorker,
} from "../src/hooks/use-search-worker";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import type { LocalFileAccess } from "../src/lib/local-file-source";
import { mainThreadWorkBudgetBytes } from "../src/lib/main-thread-budget";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import type {
  SearchMatch,
  SearchOptions,
  SearchResultSet,
  SearchResultWindow,
} from "../src/lib/record-search";
import { MockWorkerEvents } from "./helpers/mock-worker-events";

const defaultOptions: SearchOptions = { syntax: "text", caseSensitive: false };

const matchStub = (recordId: string): SearchMatch => ({
  recordId,
  pathText: "$",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

const resultStub = (recordId?: string): SearchResultSet => ({
  total: recordId ? 1 : 0,
  matchLineNumbers: recordId ? Float64Array.from([1]) : new Float64Array(),
  window: {
    matchIndexes: recordId ? Float64Array.from([0]) : new Float64Array(),
    matches: recordId ? [matchStub(recordId)] : [],
  },
});

const windowStub = (matchIndex: number, recordId: string): SearchResultWindow => ({
  matchIndexes: Float64Array.from([matchIndex]),
  matches: [matchStub(recordId)],
});

const indexedResultStub = (matchIndex: number, recordId: string): SearchResultSet => ({
  total: 200,
  matchLineNumbers: Float64Array.from({ length: 200 }, (_, index) => index + 1),
  window: windowStub(matchIndex, recordId),
});

class MockWorker extends MockWorkerEvents {
  static instances: MockWorker[] = [];
  static failConstruction = false;
  static failPostMessage = false;
  terminated = false;
  postMessage = vi.fn(() => {
    if (MockWorker.failPostMessage) {
      throw new DOMException("payload could not be cloned", "DataCloneError");
    }
  });

  constructor(..._args: unknown[]) {
    super();
    if (MockWorker.failConstruction) {
      throw new Error("worker script failed to load");
    }
    MockWorker.instances.push(this);
  }

  terminate() {
    this.terminated = true;
    this.clearListeners();
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
  result: SearchResultSet | null;
}
let renderLog: RenderLogEntry[] = [];

const Probe = ({
  query,
  text,
  sourceFile = null,
  sourceRevision = 0,
  debounceMs = 0,
  options = defaultOptions,
  access,
  windowIndexes,
}: {
  query: string;
  text: string;
  sourceFile?: File | null;
  sourceRevision?: number;
  debounceMs?: number;
  options?: SearchOptions;
  access?: LocalFileAccess;
  windowIndexes?: Float64Array;
}) => {
  const source = useMemo(() => {
    const sourceAccess = access ?? (sourceFile ? createLocalFileAccess(sourceFile) : null);
    return sourceAccess
      ? createStreamingFileSourceRevision(sourceRevision, sourceAccess, "jsonl")
      : createTextSourceRevision(sourceRevision, text, "auto");
  }, [access, sourceFile, sourceRevision, text]);
  const result = useSearchWorker({
    source,
    query,
    options,
    debounceMs,
  });
  renderLog.push({
    query,
    text,
    sourceFile,
    status: result.status,
    matches: result.result?.window.matches[0]?.recordId ?? "",
    result: result.result,
  });
  return (
    <div>
      <div data-testid="status">{result.status}</div>
      <div data-testid="error-kind">{result.errorKind ?? ""}</div>
      <div data-testid="record-id">{result.result?.window.matches[0]?.recordId ?? ""}</div>
      {windowIndexes ? (
        <button type="button" onClick={() => result.requestWindow(windowIndexes)}>
          Load window
        </button>
      ) : null}
    </div>
  );
};

describe("useSearchWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performance.clearMeasures("unquote:search:request");
    MockWorker.instances = [];
    MockWorker.failConstruction = false;
    MockWorker.failPostMessage = false;
    renderLog = [];
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("A") }));
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
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("first") }));

    rerender(<Probe query="b" text="text" />);

    expect(MockWorker.instances).toHaveLength(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "search-text",
      requestId: 2,
      source: { kind: "cached", sourceRevision: 0 },
      query: "b",
      options: defaultOptions,
    });
    act(() => worker.respond({ type: "result", requestId: 2, result: resultStub("second") }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("second");
  });

  it.each(["pending", "error"] as const)(
    "ignores window requests while the search is %s",
    (status) => {
      render(<Probe query="a" text="text" windowIndexes={Float64Array.from([128])} />);
      const worker = MockWorker.instances[0]!;
      if (status === "error") {
        act(() => worker.respond({ type: "error", requestId: 1, message: "TypeError" }));
      }

      fireEvent.click(screen.getByRole("button", { name: "Load window" }));

      expect(MockWorker.instances).toHaveLength(1);
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      expect(worker.terminated).toBe(false);
      expect(screen.getByTestId("status")).toHaveTextContent(status);
      if (status === "pending") {
        act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("first") }));
        expect(screen.getByTestId("status")).toHaveTextContent("complete");
        expect(screen.getByTestId("record-id")).toHaveTextContent("first");
      }
    },
  );

  it("loads a requested window immediately while retaining the completed search index", async () => {
    render(
      <Probe
        query="a"
        text='{"value":"a"}'
        debounceMs={250}
        windowIndexes={Float64Array.from([128])}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(250));
    const worker = MockWorker.instances[0]!;
    const initialResult = indexedResultStub(0, "first");
    act(() => worker.respond({ type: "result", requestId: 1, result: initialResult }));

    fireEvent.click(screen.getByRole("button", { name: "Load window" }));

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "search-text",
      requestId: 2,
      source: { kind: "cached", sourceRevision: 0 },
      query: "a",
      options: defaultOptions,
      windowIndexes: Float64Array.from([128]),
    });
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("first");

    const nextWindow = windowStub(128, "next");
    act(() => worker.respond({ type: "window", requestId: 2, window: nextWindow }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("next");
    expect(renderLog.at(-1)?.result?.matchLineNumbers).toBe(initialResult.matchLineNumbers);
    expect(renderLog.at(-1)?.result?.total).toBe(initialResult.total);
    expect(renderLog.at(-1)?.result?.window).toBe(nextWindow);
  });

  it("applies only the latest requested window without replacing the search index", () => {
    const { rerender } = render(
      <Probe query="a" text="text" windowIndexes={Float64Array.from([128])} />,
    );
    const staleWorker = MockWorker.instances[0]!;
    const initialResult = indexedResultStub(0, "first");
    act(() => staleWorker.respond({ type: "result", requestId: 1, result: initialResult }));
    fireEvent.click(screen.getByRole("button", { name: "Load window" }));

    rerender(<Probe query="a" text="text" windowIndexes={Float64Array.from([129])} />);
    fireEvent.click(screen.getByRole("button", { name: "Load window" }));
    const currentWorker = MockWorker.instances.at(-1)!;
    expect(staleWorker.terminated).toBe(true);

    act(() =>
      currentWorker.respond({ type: "window", requestId: 2, window: windowStub(128, "stale") }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("first");

    act(() =>
      currentWorker.respond({ type: "window", requestId: 3, window: windowStub(129, "latest") }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("latest");
    expect(renderLog.at(-1)?.result?.matchLineNumbers).toBe(initialResult.matchLineNumbers);
    expect(renderLog.at(-1)?.result?.window.matchIndexes).toEqual(Float64Array.from([129]));
  });

  it.each([
    ["query", "b", "text", 0],
    ["source", "a", "different text", 1],
  ])("ignores a previous window after the %s changes", (_label, query, text, sourceRevision) => {
    const { rerender } = render(
      <Probe query="a" text="text" windowIndexes={Float64Array.from([128])} />,
    );
    const staleWorker = MockWorker.instances[0]!;
    act(() =>
      staleWorker.respond({ type: "result", requestId: 1, result: indexedResultStub(0, "old") }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load window" }));

    rerender(<Probe query={query} text={text} sourceRevision={sourceRevision} />);
    const currentWorker = MockWorker.instances.at(-1)!;
    expect(staleWorker.terminated).toBe(true);
    act(() =>
      currentWorker.respond({ type: "window", requestId: 2, window: windowStub(128, "stale") }),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(screen.getByTestId("record-id")).toBeEmptyDOMElement();

    const currentResult = resultStub("fresh");
    act(() => currentWorker.respond({ type: "result", requestId: 3, result: currentResult }));
    act(() =>
      staleWorker.respond({ type: "window", requestId: 2, window: windowStub(128, "stale") }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh");
    expect(renderLog.at(-1)?.result?.matchLineNumbers).toBe(currentResult.matchLineNumbers);
  });

  it.each(["b", ""])(
    "requests a fresh index when returning from query %j to an old window request",
    (intermediateQuery) => {
      const { rerender } = render(
        <Probe query="a" text="text" windowIndexes={Float64Array.from([128])} />,
      );
      const worker = MockWorker.instances[0]!;
      act(() =>
        worker.respond({ type: "result", requestId: 1, result: indexedResultStub(0, "first-a") }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Load window" }));
      act(() =>
        worker.respond({ type: "window", requestId: 2, window: windowStub(128, "next-a") }),
      );

      rerender(<Probe query={intermediateQuery} text="text" />);
      if (intermediateQuery) {
        act(() => worker.respond({ type: "result", requestId: 3, result: resultStub("first-b") }));
      }
      rerender(<Probe query="a" text="text" />);

      expect(worker.postMessage).toHaveBeenLastCalledWith({
        type: "search-text",
        requestId: 4,
        source: { kind: "cached", sourceRevision: 0 },
        query: "a",
        options: defaultOptions,
      });
      act(() =>
        worker.respond({ type: "result", requestId: 4, result: indexedResultStub(0, "fresh-a") }),
      );
      expect(screen.getByTestId("status")).toHaveTextContent("complete");
      expect(screen.getByTestId("record-id")).toHaveTextContent("fresh-a");
    },
  );

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

    act(() => staleWorker.respond({ type: "result", requestId: 1, result: resultStub("stale") }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("");

    act(() => currentWorker.respond({ type: "result", requestId: 2, result: resultStub("fresh") }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh");
  });

  it("terminates the active worker when the query is cleared", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    rerender(<Probe query="" text="text" />);

    expect(worker.terminated).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("terminates a regex worker and reports a timeout when no response arrives", async () => {
    render(
      <Probe query="^(a+)+$" text="aaaaaaaa!" options={{ ...defaultOptions, syntax: "regex" }} />,
    );
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
    act(() => worker.respond({ type: "result", requestId: 2, result: resultStub("recovered") }));
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

  it("falls back to a main-thread search when the worker cannot be constructed", () => {
    MockWorker.failConstruction = true;

    render(<Probe query="hello" text='{"a":"hello"}' />);

    expect(MockWorker.instances).toHaveLength(0);
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-1");
  });

  it("refuses a regex fallback when the worker cannot be constructed", () => {
    MockWorker.failConstruction = true;
    const parse = vi.spyOn(JSON, "parse");

    render(
      <Probe
        query="^(a+)+$"
        text='{"a":"aaaaaaaa!"}'
        options={{ ...defaultOptions, syntax: "regex" }}
      />,
    );

    expect(MockWorker.instances).toHaveLength(0);
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("regex-without-worker");
    parse.mockRestore();
  });

  it("reports a worker error when the request cannot be posted", () => {
    MockWorker.failPostMessage = true;
    const parse = vi.spyOn(JSON, "parse");

    render(<Probe query="a" text="text" options={{ ...defaultOptions, syntax: "regex" }} />);

    expect(MockWorker.instances[0]?.terminated).toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("worker-error");
    parse.mockRestore();
  });

  it.each([
    ["an uncaught worker error", (worker: MockWorker) => worker.fail()],
    ["an undeserializable message", (worker: MockWorker) => worker.failDeserialization()],
  ])("reports %s before the timeout elapses", (_label, provokeFailure) => {
    render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    act(() => provokeFailure(worker));

    expect(worker.terminated).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("worker-error");
  });

  it("re-sends the source text to a fresh worker after an uncaught error", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    act(() => MockWorker.instances[0]!.fail());

    rerender(<Probe query="b" text="text" />);

    expect(MockWorker.instances).toHaveLength(2);
    const recovered = MockWorker.instances[1]!;
    expect(recovered.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ kind: "content", sourceRevision: 0, text: "text" }),
      }),
    );

    act(() => recovered.respond({ type: "result", requestId: 2, result: resultStub("fresh") }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh");
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

  it("retains the search index when the main-thread memory fallback loads a window", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const text = Array.from({ length: 200 }, () => '{"value":"needle"}').join("\n");
    render(<Probe query="needle" text={text} windowIndexes={Float64Array.from([128])} />);
    const initialIndex = renderLog.at(-1)?.result?.matchLineNumbers;
    expect(initialIndex).toHaveLength(200);

    fireEvent.click(screen.getByRole("button", { name: "Load window" }));

    expect(screen.getByTestId("record-id")).toHaveTextContent("record-129");
    expect(renderLog.at(-1)?.result?.matchLineNumbers).toBe(initialIndex);
  });

  it("retains the search index when the main-thread file fallback loads a window", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const initialResult = indexedResultStub(0, "first");
    const nextResult = indexedResultStub(128, "next");
    const search = vi.fn().mockResolvedValueOnce(initialResult).mockResolvedValueOnce(nextResult);
    const access = { ...createLocalFileAccess(new File(["{}"], "payload.jsonl")), search };
    render(
      <Probe query="needle" text="" access={access} windowIndexes={Float64Array.from([128])} />,
    );
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Load window" }));
    await act(async () => undefined);

    expect(screen.getByTestId("record-id")).toHaveTextContent("next");
    expect(renderLog.at(-1)?.result?.matchLineNumbers).toBe(initialResult.matchLineNumbers);
    expect(renderLog.at(-1)?.result?.window).toBe(nextResult.window);
  });

  it("refuses regex search before entering the synchronous fallback", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const parse = vi.spyOn(JSON, "parse");

    render(
      <Probe
        query="^(a+)+$"
        text='{"a":"aaaaaaaa!"}'
        options={{ ...defaultOptions, syntax: "regex" }}
      />,
    );

    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("regex-without-worker");
    parse.mockRestore();
  });

  it("keeps regex search on the interruptible worker path", () => {
    render(
      <Probe query="[" text='{"a":"hello"}' options={{ ...defaultOptions, syntax: "regex" }} />,
    );

    const worker = MockWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "[",
        options: { ...defaultOptions, syntax: "regex" },
      }),
    );

    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub() }));

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

  it("ignores an aborted fallback file search while the next query is debouncing", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const file = new File(["{}"], "payload.jsonl");
    let resolveSearch: ((result: SearchResultSet | null) => void) | undefined;
    let searchSignal: AbortSignal | undefined;
    const access: LocalFileAccess = {
      ...createLocalFileAccess(file),
      search: vi.fn((_query, _options, signal) => {
        searchSignal = signal;
        return new Promise<SearchResultSet | null>((resolve) => {
          resolveSearch = resolve;
        });
      }),
    };
    const { rerender } = render(<Probe query="old" text="" access={access} debounceMs={250} />);
    await act(() => vi.advanceTimersByTimeAsync(250));

    rerender(<Probe query="new" text="" access={access} debounceMs={250} />);
    expect(searchSignal?.aborted).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("pending");

    await act(async () => {
      resolveSearch?.(null);
      await Promise.resolve();
    });

    expect(screen.getByTestId("status")).toHaveTextContent("pending");
  });

  it("terminates a superseded search-file worker", () => {
    const file = new File(["{}"], "payload.jsonl");
    const { rerender } = render(<Probe query="a" text="" sourceFile={file} />);

    const staleWorker = MockWorker.instances[0]!;
    expect(staleWorker.postMessage).toHaveBeenCalledWith({
      type: "search-file",
      requestId: 1,
      sourceRevision: 0,
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
        result: resultStub("stale-file"),
      }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("");

    act(() =>
      currentWorker.respond({
        type: "result",
        requestId: 2,
        result: resultStub("fresh-file"),
      }),
    );
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh-file");
  });

  it("terminates the active worker when the hook unmounts", () => {
    const { unmount } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub() }));

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
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));
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
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));
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

  it("resets to pending immediately when the query changes, never exposing stale matches", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));

    const committed = rendersCommittedDuring(() => rerender(<Probe query="b" text="text" />));

    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
    expect(
      committed.some((entry) => entry.status === "complete" && entry.matches === "record-3"),
    ).toBe(false);
  });

  it("resets to pending immediately on rerender when options change, never exposing stale matches", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));
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
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    rerender(<Probe query="a" text="text" />);

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-3");
  });

  it("goes idle immediately when the query is cleared after a completed search", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;
    act(() => worker.respond({ type: "result", requestId: 1, result: resultStub("record-3") }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");

    rerender(<Probe query="" text="text" />);

    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("record-id")).toHaveTextContent("");
  });

  it("refuses an oversized in-memory search rather than blocking the main thread", () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const parse = vi.spyOn(JSON, "parse");
    const text = `{"pad":"${"x".repeat(mainThreadWorkBudgetBytes)}"}`;

    render(<Probe query="pad" text={text} />);

    // Neither the synchronous parse nor the search is entered.
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("too-large");
    parse.mockRestore();
  });

  it.each([
    ["a plain query", "hello", defaultOptions],
    ["a jq path query", "$.a", { ...defaultOptions, syntax: "jq" as const }],
  ])("searches %s within the budget", (_label, query, options) => {
    Reflect.deleteProperty(globalThis, "Worker");

    render(<Probe query={query} text='{"a":"hello"}' options={options} />);

    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("record-1");
  });

  it("still searches an oversized input through the worker", () => {
    const text = `{"pad":"${"x".repeat(mainThreadWorkBudgetBytes)}"}`;

    render(<Probe query="pad" text={text} />);

    expect(MockWorker.instances).toHaveLength(1);
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
  });

  it("keeps a file-backed search on its chunked path regardless of size", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const file = new File(["{}"], "big.jsonl");
    Object.defineProperty(file, "size", { value: mainThreadWorkBudgetBytes * 4 });
    const search = vi.fn().mockResolvedValue(resultStub("from-file"));
    const access = { ...createLocalFileAccess(file), search };

    render(<Probe query="a" text="" access={access} />);
    await act(async () => undefined);

    expect(search).toHaveBeenCalledOnce();
    expect(screen.getByTestId("record-id")).toHaveTextContent("from-file");
  });

  it("refuses a regex fallback before calling a file-backed search", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const file = new File(["{}"], "payload.jsonl");
    const search = vi.fn().mockResolvedValue(resultStub("from-file"));
    const access = { ...createLocalFileAccess(file), search };

    render(
      <Probe
        query="^(a+)+$"
        text=""
        access={access}
        options={{ ...defaultOptions, syntax: "regex" }}
      />,
    );
    await act(async () => undefined);

    expect(search).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("regex-without-worker");
  });
});
