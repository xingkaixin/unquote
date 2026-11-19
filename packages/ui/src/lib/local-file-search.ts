import { parseJsonlRecordLine } from "@unquote/core";
import { readJsonlFileLines, readJsonlRecordsByLine } from "./local-file-reader";
import { measurePerfAsync } from "./perf";
import { buildSearchPattern, createSearchResultCollector } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";
import { hasSameSearch, materializeSearchWindow, requestSearchWindow } from "./search-window";
import type { SearchCache } from "./search-window";

const unsafeRawProbePattern = /[^\x20-\x7e]|["\\/]/;

const containerBracketPattern = /[[\]{}]/;

const digitsOnlyPattern = /^\d+$/;

interface RawLineProbe {
  pattern: RegExp | null;
  exactSubstring: string | null;
  // Minimum line length at which a synthetic container count (`{N}`/`[N]`) could
  // contain the query as a substring. `Infinity` means container labels can never match.
  minSyntheticContainerLineLength: number;
}

const minContainerCountForDigits = (digits: string) => {
  if (digits === "0") {
    return 0;
  }
  return digits.startsWith("0") ? Number(`1${digits}`) : Number(digits);
};

const buildRawLineProbe = (
  query: string,
  options: SearchOptions,
  searchPattern: RegExp,
): RawLineProbe | null => {
  if (
    options.syntax !== "text" ||
    unsafeRawProbePattern.test(query) ||
    containerBracketPattern.test(query)
  ) {
    return null;
  }

  const minSyntheticContainerLineLength = digitsOnlyPattern.test(query)
    ? minContainerCountForDigits(query)
    : Number.POSITIVE_INFINITY;

  return options.caseSensitive
    ? { pattern: null, exactSubstring: query, minSyntheticContainerLineLength }
    : {
        pattern: new RegExp(searchPattern.source, "i"),
        exactSubstring: null,
        minSyntheticContainerLineLength,
      };
};

const rawLineMayMatch = (line: string, probe: RawLineProbe | null) =>
  !probe ||
  line.length >= probe.minSyntheticContainerLineLength ||
  line.includes("\\u") ||
  (probe.exactSubstring !== null ? line.includes(probe.exactSubstring) : probe.pattern!.test(line));

const searchJsonlFile = async (
  file: File,
  query: string,
  options: SearchOptions,
  signal: AbortSignal,
  windowIndexes?: ArrayLike<number>,
): Promise<SearchResultSet | null> =>
  measurePerfAsync("search:file", async () => {
    const pattern = buildSearchPattern(query, options);
    if (!pattern) {
      return null;
    }
    const rawLineProbe = buildRawLineProbe(query, options, pattern);
    const collector = createSearchResultCollector(pattern, options, windowIndexes, query);

    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (signal.aborted) {
          return false;
        }

        if (line.trim() && rawLineMayMatch(line, rawLineProbe)) {
          try {
            collector.addRecord(parseJsonlRecordLine(line, lineNumber));
          } catch {
            // Invalid lines have no record tree and therefore cannot produce a search match.
            return;
          }
        }
      },
      signal,
    );

    return signal.aborted ? null : collector.finish();
  });

const readSearchWindow = async (
  file: File,
  cache: SearchCache,
  signal: AbortSignal,
  windowIndexes: ArrayLike<number>,
): Promise<SearchResultSet | null> => {
  if (signal.aborted) {
    return null;
  }
  const requests = requestSearchWindow(cache.result, windowIndexes);
  try {
    const records = await readJsonlRecordsByLine(file, new Set(requests.keys()), signal);
    return signal.aborted
      ? null
      : materializeSearchWindow(cache, requests, (line) => records.get(line));
  } catch (error) {
    if (signal.aborted) {
      return null;
    }
    throw error;
  }
};

export const createLocalFileSearch = (file: File) => {
  let cache: SearchCache | null = null;

  return async (
    query: string,
    options: SearchOptions,
    signal: AbortSignal,
    windowIndexes?: ArrayLike<number>,
  ): Promise<SearchResultSet | null> => {
    const cachedSearch = cache;
    if (cachedSearch && hasSameSearch(cachedSearch, query, options)) {
      return windowIndexes
        ? measurePerfAsync("search:file", () =>
            readSearchWindow(file, cachedSearch, signal, windowIndexes),
          )
        : cachedSearch.result;
    }

    const result = await searchJsonlFile(file, query, options, signal, windowIndexes);
    if (result && !signal.aborted) {
      cache = { query, options: { ...options }, result };
    }
    return result;
  };
};
