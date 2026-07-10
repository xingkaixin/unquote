import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchWorkerTimeoutMs, useSearchWorker } from "../src/hooks/use-search-worker";
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

const Probe = ({ query, text }: { query: string; text: string }) => {
  const result = useSearchWorker({ text, sourceFile: null, query, options: defaultOptions });
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
    MockWorker.instances = [];
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("posts a search-text request and applies the completed result", () => {
    render(<Probe query="hello" text='{"a":"hello"}' />);

    const worker = MockWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "search-text",
      requestId: 1,
      text: '{"a":"hello"}',
      query: "hello",
      options: defaultOptions,
    });

    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("A")] }));
    expect(screen.getByTestId("status")).toHaveTextContent("complete");
    expect(screen.getByTestId("record-id")).toHaveTextContent("A");
  });

  it("ignores a stale response once a newer query has been sent", () => {
    const { rerender } = render(<Probe query="a" text="text" />);
    rerender(<Probe query="b" text="text" />);

    const worker = MockWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledTimes(2);

    act(() => worker.respond({ type: "result", requestId: 1, matches: [matchStub("stale")] }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("");

    act(() => worker.respond({ type: "result", requestId: 2, matches: [matchStub("fresh")] }));
    expect(screen.getByTestId("record-id")).toHaveTextContent("fresh");
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

  it("reports a worker error response", () => {
    render(<Probe query="a" text="text" />);
    const worker = MockWorker.instances[0]!;

    act(() => worker.respond({ type: "error", requestId: 1, message: "TypeError" }));
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("worker-error");
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
});
