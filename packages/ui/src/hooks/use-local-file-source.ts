import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const hydratingFileLinesRef = useRef<Set<number>>(new Set());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Drop the hydration cache whenever a different source is attached.
  useEffect(() => {
    setHydratedFileRecords(new Map());
    hydratingFileLinesRef.current.clear();
  }, [sourceFile]);

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

  const hydrateRecord = useCallback(
    (record: JsonlRecord) => {
      if (!sourceFile || !record.deferred) {
        return;
      }

      const lineNumber = record.lineNumber;
      if (hydratedFileRecords.has(lineNumber) || hydratingFileLinesRef.current.has(lineNumber)) {
        return;
      }

      hydratingFileLinesRef.current.add(lineNumber);
      void readJsonlRecordsByLine(sourceFile, new Set([lineNumber]))
        .then((records) => {
          const hydrated = records.get(lineNumber);
          if (!hydrated) {
            return;
          }

          setHydratedFileRecords((current) => {
            if (current.has(lineNumber)) {
              return current;
            }

            const next = new Map(current);
            next.set(lineNumber, hydrated);
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
          onErrorRef.current(error);
        })
        .finally(() => {
          // Clearing the in-flight mark also lets a failed line retry when it
          // scrolls back into view.
          hydratingFileLinesRef.current.delete(lineNumber);
        });
    },
    [hydratedFileRecords, sourceFile],
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
