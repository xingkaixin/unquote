import type { JsonlRecord } from "@unquote/core";

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

/**
 * Coalesces streamed record batches into animation-frame-throttled emits.
 *
 * The first batch publishes synchronously so results appear immediately;
 * later batches only stash a snapshot and are flushed once per frame. A
 * batch whose progress is done publishes immediately as well.
 *
 * The scheduler is injectable so tests don't need fake rAF globals.
 */
export const createStreamPublisher = <Stats, Progress extends { done: boolean }>(
  emit: (records: JsonlRecord[], stats: Stats, progress: Progress) => void,
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
    emit(records, snapshot.stats, snapshot.progress);
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

      frameId ??= schedule(publish);
    },
    flush() {
      cancelFrame();
      publish();
    },
    cancel: cancelFrame,
  };
};
