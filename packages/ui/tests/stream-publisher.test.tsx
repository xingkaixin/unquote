import { describe, expect, it, vi } from "vitest";
import type { JsonlRecord } from "@unquote/core";
import { createStreamPublisher } from "../src/lib/stream-publisher";

interface TestProgress {
  done: boolean;
}

const makeRecord = (lineNumber: number): JsonlRecord => ({
  id: `record-${lineNumber}`,
  lineNumber,
  node: null,
  summary: `line ${lineNumber}`,
});

// Manual scheduler standing in for requestAnimationFrame.
const makeScheduler = () => {
  const frames = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule: (callback: () => void) => {
      const id = nextId;
      nextId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelSchedule: (id: number) => {
      frames.delete(id);
    },
    runFrame: () => {
      const entries = [...frames.entries()];
      frames.clear();
      for (const [, callback] of entries) {
        callback();
      }
    },
    pendingCount: () => frames.size,
  };
};

describe("createStreamPublisher", () => {
  it("publishes the first batch synchronously and coalesces later ones per frame", () => {
    const scheduler = makeScheduler();
    const emit = vi.fn();
    const publisher = createStreamPublisher<number, TestProgress>(emit, scheduler);

    publisher.pushBatch([makeRecord(1)], 1, { done: false });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(publisher.hasPublished()).toBe(true);

    publisher.pushBatch([makeRecord(2)], 2, { done: false });
    publisher.pushBatch([makeRecord(3)], 3, { done: false });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runFrame();
    expect(emit).toHaveBeenCalledTimes(2);
    // Records accumulate across batches; the snapshot is the latest one.
    const [records, stats] = emit.mock.calls[1]!;
    expect((records as JsonlRecord[]).map((record) => record.lineNumber)).toEqual([1, 2, 3]);
    expect(stats).toBe(3);
  });

  it("publishes immediately when the batch progress is done", () => {
    const scheduler = makeScheduler();
    const emit = vi.fn();
    const publisher = createStreamPublisher<number, TestProgress>(emit, scheduler);

    publisher.pushBatch([makeRecord(1)], 1, { done: false });
    publisher.pushBatch([makeRecord(2)], 2, { done: true });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("flush force-publishes pending data before completion", () => {
    const scheduler = makeScheduler();
    const emit = vi.fn();
    const publisher = createStreamPublisher<number, TestProgress>(emit, scheduler);

    publisher.pushBatch([makeRecord(1)], 1, { done: false });
    publisher.pushBatch([makeRecord(2)], 2, { done: false });
    expect(emit).toHaveBeenCalledTimes(1);

    publisher.flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(scheduler.pendingCount()).toBe(0);

    // Nothing pending: flush is a no-op.
    publisher.flush();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the scheduled publish without emitting", () => {
    const scheduler = makeScheduler();
    const emit = vi.fn();
    const publisher = createStreamPublisher<number, TestProgress>(emit, scheduler);

    publisher.pushBatch([makeRecord(1)], 1, { done: false });
    publisher.pushBatch([makeRecord(2)], 2, { done: false });
    publisher.cancel();

    scheduler.runFrame();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
