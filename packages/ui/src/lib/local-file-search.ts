import { parseJsonlRecordLine } from "@unquote/core";
import { readJsonlFileLines, readJsonlRecordsByLine } from "./local-file-reader";
import { measurePerfAsync } from "./perf";
import {
  buildSearchPattern,
  createSearchResultCollector,
  normalizeSearchWindowIndexes,
  searchRecords,
} from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";

interface FileSearchCache {
  query: string;
  options: SearchOptions;
  result: SearchResultSet;
}

interface RequestedLineMatches {
  firstGlobalIndex: number;
  globalIndexes: number[];
}

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

const hasSameSearch = (cache: FileSearchCache, query: string, options: SearchOptions) =>
  cache.query === query &&
  cache.options.syntax === options.syntax &&
  cache.options.caseSensitive === options.caseSensitive;

const firstMatchIndexForLine = (lineNumbers: Float64Array, lineNumber: number) => {
  let low = 0;
  let high = lineNumbers.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lineNumbers[middle]! < lineNumber) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const materializeSearchWindow = async (
  file: File,
  cache: FileSearchCache,
  signal: AbortSignal,
  windowIndexes: ArrayLike<number>,
): Promise<SearchResultSet | null> => {
  const requestedIndexes = normalizeSearchWindowIndexes(windowIndexes)!;
  const requestedByLine = new Map<number, RequestedLineMatches>();
  for (const globalIndex of requestedIndexes) {
    const lineNumber = cache.result.matchLineNumbers[globalIndex];
    if (lineNumber === undefined) {
      continue;
    }
    const request = requestedByLine.get(lineNumber) ?? {
      firstGlobalIndex: firstMatchIndexForLine(cache.result.matchLineNumbers, lineNumber),
      globalIndexes: [],
    };
    request.globalIndexes.push(globalIndex);
    requestedByLine.set(lineNumber, request);
  }

  const records = await readJsonlRecordsByLine(file, new Set(requestedByLine.keys()), signal);
  if (signal.aborted) {
    return null;
  }

  const materialized: {
    globalIndex: number;
    match: SearchResultSet["window"]["matches"][number];
  }[] = [];
  for (const [lineNumber, request] of requestedByLine) {
    const record = records.get(lineNumber);
    if (!record) {
      continue;
    }
    const localIndexes = Float64Array.from(
      request.globalIndexes.map((globalIndex) => globalIndex - request.firstGlobalIndex),
    );
    const localResult = searchRecords([record], cache.query, cache.options, localIndexes);
    if (!localResult) {
      continue;
    }
    localResult.window.matches.forEach((match, index) => {
      const localIndex = localResult.window.matchIndexes[index];
      if (localIndex !== undefined) {
        materialized.push({ globalIndex: request.firstGlobalIndex + localIndex, match });
      }
    });
  }
  materialized.sort((left, right) => left.globalIndex - right.globalIndex);

  return {
    total: cache.result.total,
    matchLineNumbers: cache.result.matchLineNumbers,
    window: {
      matchIndexes: Float64Array.from(materialized.map(({ globalIndex }) => globalIndex)),
      matches: materialized.map(({ match }) => match),
    },
  };
};

export const createLocalFileSearch = (file: File) => {
  let cache: FileSearchCache | null = null;

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
            materializeSearchWindow(file, cachedSearch, signal, windowIndexes),
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
