import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fileSearchDebounceMs,
  hydratedFileRecordLimit,
  readJsonlRecordsByLine,
  searchJsonlFile,
} from "../lib/local-file-source";
import type { SearchMatch, SearchOptions } from "../lib/local-file-source";

export interface LocalFileSource {
  hydratedRecords: ReadonlyMap<number, JsonlRecord>;
  hydrateRecord: (record: JsonlRecord) => void;
  fileMatches: SearchMatch[] | null;
  isSearchComplete: boolean;
  getFullRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
}

interface CompletedFileSearch {
  sourceFile: File;
  query: string;
  options: SearchOptions;
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
 * Owns the three source-access concerns that leaked out of `UnquoteApp`:
 *  - deferred-record hydration cache (with in-flight de-dup + LRU eviction)
 *  - whole-file search (debounced + abortable) over raw lines, so matches
 *    still cover strings the worker truncated during transfer
 *  - full-record resolution for copy / export
 *
 * The app passes its memoized `searchOptions`; a stable identity keeps the
 * search effect from re-firing on unrelated renders.
 */
export const useLocalFileSource = (
  sourceFile: File | null,
  searchQuery: string,
  searchOptions: SearchOptions,
  // Called when a file read fails (hydration or whole-file search), so the
  // caller can surface it. Read through a ref: identity is not a dependency.
  onError: (error: unknown) => void,
): LocalFileSource => {
  const [hydratedFileRecords, setHydratedFileRecords] = useState<Map<number, JsonlRecord>>(
    new Map(),
  );
  const [debouncedFileSearchQuery, setDebouncedFileSearchQuery] = useState("");
  const [fileSearchMatches, setFileSearchMatches] = useState<SearchMatch[] | null>(null);
  const [completedFileSearch, setCompletedFileSearch] = useState<CompletedFileSearch | null>(null);
  const fileSearchAbortRef = useRef<AbortController | null>(null);
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

  // Debounce the file search: wait `fileSearchDebounceMs` after the query or
  // source settles before kicking off a read, and abort any in-flight search.
  useEffect(() => {
    fileSearchAbortRef.current?.abort();
    if (!sourceFile || !searchQuery) {
      setDebouncedFileSearchQuery("");
      setFileSearchMatches(null);
      setCompletedFileSearch(null);
      return;
    }

    setFileSearchMatches(null);
    setCompletedFileSearch(null);
    const timeoutId = window.setTimeout(() => {
      setDebouncedFileSearchQuery(searchQuery);
    }, fileSearchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, sourceFile]);

  // Run the abortable whole-file search once the debounced query is set.
  useEffect(() => {
    if (!sourceFile || !debouncedFileSearchQuery) {
      setFileSearchMatches(null);
      return;
    }

    const controller = new AbortController();
    fileSearchAbortRef.current = controller;
    setFileSearchMatches(null);
    setCompletedFileSearch(null);
    void searchJsonlFile(sourceFile, debouncedFileSearchQuery, searchOptions, controller.signal)
      .then((nextMatches) => {
        if (!controller.signal.aborted) {
          setFileSearchMatches(nextMatches);
          setCompletedFileSearch({
            sourceFile,
            query: debouncedFileSearchQuery,
            options: searchOptions,
          });
        }
      })
      .catch((error) => {
        // A real I/O failure must not read as "no matches" — surface it.
        if (!controller.signal.aborted) {
          setFileSearchMatches(null);
          setCompletedFileSearch(null);
          onErrorRef.current(error);
        }
      });

    return () => {
      controller.abort();
      if (fileSearchAbortRef.current === controller) {
        fileSearchAbortRef.current = null;
      }
    };
  }, [debouncedFileSearchQuery, searchOptions, sourceFile]);

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
          while (next.size > hydratedFileRecordLimit) {
            const oldest = next.keys().next().value;
            if (typeof oldest !== "number") {
              break;
            }
            next.delete(oldest);
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
    fileMatches: fileSearchMatches,
    isSearchComplete:
      completedFileSearch?.sourceFile === sourceFile &&
      completedFileSearch.query === searchQuery &&
      completedFileSearch.options.regex === searchOptions.regex &&
      completedFileSearch.options.caseSensitive === searchOptions.caseSensitive &&
      completedFileSearch.options.jq === searchOptions.jq,
    getFullRecords,
  };
};
