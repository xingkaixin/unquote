import type { JsonlRecord } from "@unquote/core";
import type { RecordAppend } from "./record-sequence";

export interface StreamPublisherOptions {
  schedule?: (callback: () => void) => number;
  cancelSchedule?: (id: number) => void;
}

export interface StreamPublisher<Stats, Progress extends { done: boolean }> {
  hasPublished(): boolean;
  pushBatch(batch: JsonlRecord[], stats: Stats, progress: Progress): void;
  // Force-publish whatever is pending (called before handling "complete").
  flush(): void;
  // Drop any scheduled publish without emitting (effect cleanup).
  cancel(): void;
}

// Avoid copying a complete snapshot for every small parser-worker batch.
const minimumSnapshotGrowth = 64;

/**
 * Coalesces streamed record batches into animation-frame-throttled emits.
 *
 * The first batch publishes synchronously so results appear immediately;
 * later batches publish after the visible record count grows geometrically.
 * A batch whose progress is done publishes immediately as well.
 * Every emit receives a distinct records snapshot that later batches do not mutate.
 *
 * The scheduler is injectable so tests don't need fake rAF globals.
 */
export const createStreamPublisher = <Stats, Progress extends { done: boolean }>(
  emit: (
    records: JsonlRecord[],
    stats: Stats,
    progress: Progress,
    recordAppend: RecordAppend | null,
  ) => void,
  options: StreamPublisherOptions = {},
): StreamPublisher<Stats, Progress> => {
  const schedule =
    options.schedule ?? ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelSchedule =
    options.cancelSchedule ?? ((id: number) => window.cancelAnimationFrame(id));

  const records: JsonlRecord[] = [];
  let pending: { stats: Stats; progress: Progress } | null = null;
  let frameId: number | null = null;
  let hasPublished = false;
  let lastPublishedRecords: JsonlRecord[] | null = null;

  const hasEnoughRecordsForSnapshot = () => {
    const previousCount = lastPublishedRecords?.length ?? 0;
    return records.length >= Math.max(previousCount + minimumSnapshotGrowth, previousCount * 2);
  };

  const cancelFrame = () => {
    if (frameId === null) {
      return;
    }

    cancelSchedule(frameId);
    frameId = null;
  };

  const publish = () => {
    frameId = null;
    if (!pending) {
      return;
    }

    const snapshot = pending;
    pending = null;
    hasPublished = true;
    const publishedRecords = records.slice();
    const recordAppend =
      lastPublishedRecords === null ? null : { previousRecords: lastPublishedRecords };
    lastPublishedRecords = publishedRecords;
    emit(publishedRecords, snapshot.stats, snapshot.progress, recordAppend);
  };

  return {
    hasPublished: () => hasPublished,
    pushBatch(batch, stats, progress) {
      records.push(...batch);
      pending = { stats, progress };

      if (!hasPublished || progress.done) {
        cancelFrame();
        publish();
        return;
      }

      if (hasEnoughRecordsForSnapshot()) {
        frameId ??= schedule(publish);
      }
    },
    flush() {
      cancelFrame();
      publish();
    },
    cancel: cancelFrame,
  };
};
