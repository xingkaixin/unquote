import type { JsonlRecord } from "@unquote/core";
import { normalizeSearchWindowIndexes, searchRecords } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";

export interface SearchCache {
  query: string;
  options: SearchOptions;
  result: SearchResultSet;
}

interface RequestedLineMatches {
  firstGlobalIndex: number;
  globalIndexes: number[];
}

export const hasSameSearch = (cache: SearchCache, query: string, options: SearchOptions) =>
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

export const requestSearchWindow = (result: SearchResultSet, windowIndexes: ArrayLike<number>) => {
  const requestedIndexes = normalizeSearchWindowIndexes(windowIndexes)!;
  const requestedByLine = new Map<number, RequestedLineMatches>();
  for (const globalIndex of requestedIndexes) {
    const lineNumber = result.matchLineNumbers[globalIndex];
    if (lineNumber === undefined) {
      continue;
    }
    const request = requestedByLine.get(lineNumber) ?? {
      firstGlobalIndex: firstMatchIndexForLine(result.matchLineNumbers, lineNumber),
      globalIndexes: [],
    };
    request.globalIndexes.push(globalIndex);
    requestedByLine.set(lineNumber, request);
  }

  return requestedByLine;
};

export const materializeSearchWindow = (
  cache: SearchCache,
  requestedByLine: Map<number, RequestedLineMatches>,
  resolveRecord: (lineNumber: number) => JsonlRecord | undefined,
): SearchResultSet => {
  const materialized: {
    globalIndex: number;
    match: SearchResultSet["window"]["matches"][number];
  }[] = [];
  for (const [lineNumber, request] of requestedByLine) {
    const record = resolveRecord(lineNumber);
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
