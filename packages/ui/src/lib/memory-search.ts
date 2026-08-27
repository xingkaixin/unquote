import type { JsonlRecord } from "@unquote/core";
import { searchRecords } from "./record-search";
import type { SearchOptions, SearchResultSet } from "./record-search";
import { hasSameSearch, materializeSearchWindow, requestSearchWindow } from "./search-window";
import type { SearchCache } from "./search-window";

const recordForLine = (records: JsonlRecord[], lineNumber: number) => {
  let low = 0;
  let high = records.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const record = records[middle]!;
    if (record.lineNumber === lineNumber) {
      return record;
    }
    if (record.lineNumber < lineNumber) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return undefined;
};

/** Owns one query's bounded result for immutable records in source-line order. */
export const createMemorySearch = (records: JsonlRecord[]) => {
  let cache: SearchCache | null = null;
  return (
    query: string,
    options: SearchOptions,
    windowIndexes?: ArrayLike<number>,
  ): SearchResultSet | null => {
    const cached = cache;
    if (cached && hasSameSearch(cached, query, options)) {
      return windowIndexes
        ? materializeSearchWindow(
            cached,
            requestSearchWindow(cached.result, windowIndexes),
            (line) => recordForLine(records, line),
          )
        : cached.result;
    }
    const result = searchRecords(records, query, options, windowIndexes);
    cache = result ? { query, options: { ...options }, result } : null;
    return result;
  };
};
