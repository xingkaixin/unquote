import { readJsonlFileLines, readJsonlRecordsByLine } from "./local-file-reader";
import { measurePerfAsync } from "./perf";
import { buildSearchPattern, createSearchResultCollector } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";
import { hasSameSearch, materializeSearchWindow, requestSearchWindow } from "./search-window";
import type { SearchCache } from "./search-window";

const unsafeRawProbePattern = /[^\x20-\x7e]|["\\/]/;

const containerBracketPattern = /[[\]{}]/;

const digitsOnlyPattern = /^\d+$/;

const isBlankLine = (line: string) => {
  if (line.length === 0) {
    return true;
  }
  const first = line.charCodeAt(0);
  return (first <= 32 || first >= 0x80) && line.trim().length === 0;
};

const buildRawLineProbe = (
  query: string,
  options: SearchOptions,
  searchPattern: RegExp,
): ((line: string) => boolean) | null => {
  if (
    options.syntax !== "text" ||
    unsafeRawProbePattern.test(query) ||
    containerBracketPattern.test(query)
  ) {
    return null;
  }

  // Minimum line length where a synthetic container count (`{N}`/`[N]`) could contain `query`.
  const minLineLength = digitsOnlyPattern.test(query)
    ? query === "0"
      ? 0
      : Number(query.startsWith("0") ? `1${query}` : query)
    : Number.POSITIVE_INFINITY;
  const matcher = options.caseSensitive ? query : new RegExp(searchPattern.source, "i");
  return (line) =>
    line.length >= minLineLength ||
    line.includes(query) ||
    line.includes("\\u") ||
    (typeof matcher !== "string" && matcher.test(line));
};

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
    const rawLineMayMatch = buildRawLineProbe(query, options, pattern);
    const collector = createSearchResultCollector(pattern, options, windowIndexes, query);

    await readJsonlFileLines(
      file,
      (line, lineNumber) => {
        if (signal.aborted) {
          return false;
        }

        if (!isBlankLine(line) && (!rawLineMayMatch || rawLineMayMatch(line))) {
          collector.addRawJsonLine(line, lineNumber);
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
