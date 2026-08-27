import { parseJsonlRecordLine } from "@unquote/core";
import { readJsonlFileLines, readJsonlRecordsByLine } from "./local-file-reader";
import { measurePerfAsync } from "./perf";
import { buildSearchPattern, createSearchResultCollector } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";
import { hasSameSearch, materializeSearchWindow, requestSearchWindow } from "./search-window";
import type { SearchCache } from "./search-window";

const unsafeRawProbePattern = /[^\x20-\x7e]|["\\/]/;
const numericLabelPattern = /^[\d.eE+-]+$/;
const containerLabelPattern = /^[\d[\]{}]+$/;

const buildRawLineProbe = (
  query: string,
  options: SearchOptions,
  searchPattern: RegExp,
): RegExp | null => {
  if (
    options.syntax !== "text" ||
    unsafeRawProbePattern.test(query) ||
    numericLabelPattern.test(query) ||
    containerLabelPattern.test(query)
  ) {
    return null;
  }

  return new RegExp(searchPattern.source, options.caseSensitive ? "" : "i");
};

const rawLineMayMatch = (line: string, probe: RegExp | null) =>
  !probe || line.includes("\\u") || probe.test(line);

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
    const collector = createSearchResultCollector(pattern, options, windowIndexes);

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
  const requests = requestSearchWindow(cache.result, windowIndexes);
  const records = await readJsonlRecordsByLine(file, new Set(requests.keys()), signal);
  return signal.aborted
    ? null
    : materializeSearchWindow(cache, requests, (line) => records.get(line));
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
