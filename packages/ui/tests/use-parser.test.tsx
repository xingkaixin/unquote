import type { ParseResult } from "@unquote/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParser } from "../src/hooks/use-parser";

interface Listener {
  (event: MessageEvent): void;
}

const resultFromRecords = (records: ParseResult["records"]): ParseResult => ({
  format: "jsonl",
  records,
  stats: {
    total: records.length,
    success: records.filter((record) => record.node).length,
    failed: records.filter((record) => !record.node).length,
  },
});

class MockWorker {
  static instances: MockWorker[] = [];
  listener: Listener | null = null;

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
    this.listener = null;
  }

  postMessage(payload: { type: string; requestId: number; input?: string; chunk?: string }) {
    if (payload.type === "start-jsonl") {
      return;
    }

    const input = payload.input ?? payload.chunk ?? "";
    if (input === "first") {
      setTimeout(() => {
        this.listener?.({
          data: {
            type: "complete",
            requestId: payload.requestId,
            result: resultFromRecords([
              {
                id: "record-1",
                lineNumber: 1,
                node: null,
                error: "old",
                summary: "old",
              },
            ]),
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
          records: [
            {
              id: "record-1",
              lineNumber: 1,
              node: null,
              error: "new-1",
              summary: "new-1",
            },
          ],
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
          records: [
            {
              id: "record-2",
              lineNumber: 2,
              node: null,
              error: "new-2",
              summary: "new-2",
            },
          ],
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
          type: "complete",
          requestId: payload.requestId,
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
    }, 0);
  }
}

const Probe = ({ input }: { input: string }) => {
  const { result, progress } = useParser(input, "jsonl");
  return (
    <div>
      <div data-testid="records">{result.records.map((record) => record.summary).join(",")}</div>
      <div data-testid="stats">{result.stats.total}</div>
      <div data-testid="progress">{progress.done ? "done" : "pending"}</div>
    </div>
  );
};

describe("useParser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWorker.instances = [];
    Object.assign(globalThis, { Worker: MockWorker });
  });

  afterEach(() => {
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
  });
});
