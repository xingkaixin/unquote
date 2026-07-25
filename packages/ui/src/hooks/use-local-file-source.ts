import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hydratedFileRecordLimit, readJsonlRecordsByLine } from "../lib/local-file-source";

export interface LocalFileSource {
  hydratedRecords: ReadonlyMap<number, JsonlRecord>;
  hydrateRecord: (record: JsonlRecord) => void;
  getFullRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
}

interface HydrationGeneration {
  sourceFile: File | null;
  controller: AbortController;
  inFlightLines: Set<number>;
  // Lines queued by `hydrateRecord` calls in the current tick; merged into a
  // single scan when the microtask flush runs. Lives on the generation (not a
  // standalone ref) so a source switch discards any not-yet-flushed batch too.
  pendingLines: Set<number>;
  flushScheduled: boolean;
}

const createHydrationGeneration = (sourceFile: File | null): HydrationGeneration => ({
  sourceFile,
  controller: new AbortController(),
  inFlightLines: new Set(),
  pendingLines: new Set(),
  flushScheduled: false,
});

/**
 * Deep module for local JSONL file source access.
 *
 * Owns the source-access concerns that leaked out of `UnquoteApp`:
 *  - deferred-record hydration cache (with in-flight de-dup + FIFO eviction)
 *  - full-record resolution for copy / export
 *
 * Whole-file search has moved to `useSearchWorker`, which reads the file
 * directly for search rather than routing through this hook.
 */
export const useLocalFileSource = (
  sourceFile: File | null,
  // Called when a hydration read fails, so the caller can surface it. Read
  // through a ref: identity is not a dependency.
  onError: (error: unknown) => void,
): LocalFileSource => {
  const [hydratedFileRecords, setHydratedFileRecords] = useState<Map<number, JsonlRecord>>(
    new Map(),
  );
  const hydrationGenerationRef = useRef<HydrationGeneration>(createHydrationGeneration(sourceFile));
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Replace the whole hydration generation before browser events can request
  // records from a newly committed source.
  useLayoutEffect(() => {
    const previous = hydrationGenerationRef.current;
    if (previous.sourceFile === sourceFile) {
      return;
    }

    previous.controller.abort();
    hydrationGenerationRef.current = createHydrationGeneration(sourceFile);
    setHydratedFileRecords(new Map());
  }, [sourceFile]);

  useEffect(
    () => () => {
      hydrationGenerationRef.current.controller.abort();
    },
    [],
  );

  // Runs once per tick per generation: collects every line queued by
  // `hydrateRecord` since the last flush and resolves them with one scan
  // instead of one per record.
  const flushHydrationGeneration = useCallback((generation: HydrationGeneration) => {
    generation.flushScheduled = false;
    if (hydrationGenerationRef.current !== generation || generation.controller.signal.aborted) {
      generation.pendingLines.clear();
      return;
    }

    const batch = generation.pendingLines;
    generation.pendingLines = new Set();
    if (batch.size === 0 || !generation.sourceFile) {
      return;
    }

    for (const lineNumber of batch) {
      generation.inFlightLines.add(lineNumber);
    }

    void readJsonlRecordsByLine(generation.sourceFile, batch, generation.controller.signal)
      .then((records) => {
        if (hydrationGenerationRef.current !== generation || generation.controller.signal.aborted) {
          return;
        }

        setHydratedFileRecords((current) => {
          if (hydrationGenerationRef.current !== generation) {
            return current;
          }

          let next = current;
          for (const lineNumber of batch) {
            const hydrated = records.get(lineNumber);
            if (!hydrated || next.has(lineNumber)) {
              continue;
            }
            if (next === current) {
              next = new Map(current);
            }
            next.set(lineNumber, hydrated);
          }
          // Eviction is FIFO, not LRU: `Map.keys()` yields insertion order and
          // the cache is only written on hydration, never on read, so a
          // repeatedly viewed record does not move to the back. That is a
          // deliberate trade — making it a true LRU would mean touching the
          // cache from the read path, which is a pure lookup today and would
          // otherwise re-render the whole record list on every scroll. Under
          // one-directional scrolling the two policies agree; the cost of the
          // difference is one extra scan when scrolling back past the limit,
          // after which the record is re-inserted at the back.
          while (next.size > hydratedFileRecordLimit) {
            const firstInserted = next.keys().next().value;
            if (typeof firstInserted !== "number") {
              break;
            }
            next.delete(firstInserted);
          }
          return next;
        });
      })
      .catch((error) => {
        if (
          hydrationGenerationRef.current === generation &&
          !generation.controller.signal.aborted
        ) {
          onErrorRef.current(error);
        }
      })
      .finally(() => {
        if (hydrationGenerationRef.current === generation) {
          // Clearing the in-flight marks also lets failed lines retry when
          // they scroll back into view.
          for (const lineNumber of batch) {
            generation.inFlightLines.delete(lineNumber);
          }
        }
      });
  }, []);

  const hydrateRecord = useCallback(
    (record: JsonlRecord) => {
      if (!sourceFile || !record.deferred) {
        return;
      }

      const lineNumber = record.lineNumber;
      const generation = hydrationGenerationRef.current;
      if (
        generation.sourceFile !== sourceFile ||
        hydratedFileRecords.has(lineNumber) ||
        generation.inFlightLines.has(lineNumber) ||
        generation.pendingLines.has(lineNumber)
      ) {
        return;
      }

      generation.pendingLines.add(lineNumber);
      if (!generation.flushScheduled) {
        generation.flushScheduled = true;
        queueMicrotask(() => flushHydrationGeneration(generation));
      }
    },
    [hydratedFileRecords, sourceFile, flushHydrationGeneration],
  );

  const getFullRecords = useCallback(
    async (records: JsonlRecord[]) => {
      if (!sourceFile) {
        return records;
      }

      const fullRecords = await readJsonlRecordsByLine(
        sourceFile,
        new Set(records.map((record) => record.lineNumber)),
      );
      return records.map((record) => fullRecords.get(record.lineNumber) ?? record);
    },
    [sourceFile],
  );

  return {
    hydratedRecords: hydratedFileRecords,
    hydrateRecord,
    getFullRecords,
  };
};
