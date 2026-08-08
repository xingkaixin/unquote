import type { JsonlRecord } from "@unquote/core";
import { reconcileMatchIndex } from "./query-interaction";
import type { SearchMatch, SearchResultSet } from "./record-search";
import { searchResultWindowSize } from "./record-search";

export interface SearchResultProjection {
  activeMatch: SearchMatch | null;
  currentMatchIndex: number;
  matchCount: number;
  requestedWindowIndexes: Float64Array;
  windowMatches: SearchMatch[] | null;
}

export interface SearchResultVisibility {
  globalMatchIndexes: Float64Array | null;
  matchCount: number;
}

const emptyWindowIndexes = new Float64Array();
const emptyVisibility: SearchResultVisibility = {
  globalMatchIndexes: null,
  matchCount: 0,
};

const visitVisibleMatchIndexes = (
  lineNumbers: Float64Array,
  records: readonly JsonlRecord[],
  visit: (globalIndex: number, visibleIndex: number) => void,
) => {
  let visibleIndex = 0;
  let recordIndex = 0;
  for (let globalIndex = 0; globalIndex < lineNumbers.length; globalIndex += 1) {
    const lineNumber = lineNumbers[globalIndex]!;
    while (recordIndex < records.length && records[recordIndex]!.lineNumber < lineNumber) {
      recordIndex += 1;
    }
    if (records[recordIndex]?.lineNumber !== lineNumber) {
      continue;
    }
    visit(globalIndex, visibleIndex);
    visibleIndex += 1;
  }
  return visibleIndex;
};

export const createSearchResultVisibility = (
  result: SearchResultSet | null,
  visibleRecords: readonly JsonlRecord[],
): SearchResultVisibility => {
  if (!result) {
    return emptyVisibility;
  }

  let globalMatchIndexes: number[] | null = null;
  const matchCount = visitVisibleMatchIndexes(
    result.matchLineNumbers,
    visibleRecords,
    (globalIndex, visibleIndex) => {
      if (!globalMatchIndexes && globalIndex !== visibleIndex) {
        globalMatchIndexes = Array.from({ length: visibleIndex }, (_, index) => index);
      }
      globalMatchIndexes?.push(globalIndex);
    },
  );
  return {
    globalMatchIndexes: globalMatchIndexes ? Float64Array.from(globalMatchIndexes) : null,
    matchCount,
  };
};

const findWindowPosition = (indexes: Float64Array, globalIndex: number) => {
  let low = 0;
  let high = indexes.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = indexes[middle]!;
    if (candidate === globalIndex) {
      return middle;
    }
    if (candidate < globalIndex) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return -1;
};

const globalMatchIndexAt = (visibility: SearchResultVisibility, visibleIndex: number) =>
  visibility.globalMatchIndexes?.[visibleIndex] ?? visibleIndex;

const isGlobalMatchVisible = (visibility: SearchResultVisibility, globalIndex: number) =>
  visibility.globalMatchIndexes
    ? findWindowPosition(visibility.globalMatchIndexes, globalIndex) >= 0
    : globalIndex >= 0 && globalIndex < visibility.matchCount;

export const projectSearchResult = (
  result: SearchResultSet | null,
  visibility: SearchResultVisibility,
  currentIndex: number,
): SearchResultProjection => {
  if (!result) {
    return {
      activeMatch: null,
      currentMatchIndex: 0,
      matchCount: 0,
      requestedWindowIndexes: emptyWindowIndexes,
      windowMatches: null,
    };
  }

  const { matchCount } = visibility;
  const currentMatchIndex = reconcileMatchIndex(currentIndex, matchCount);
  if (matchCount === 0) {
    return {
      activeMatch: null,
      currentMatchIndex,
      matchCount,
      requestedWindowIndexes: emptyWindowIndexes,
      windowMatches: [],
    };
  }

  const precedingMatches = Math.floor(searchResultWindowSize / 4);
  const windowStart = Math.max(
    0,
    Math.min(currentMatchIndex - precedingMatches, matchCount - searchResultWindowSize),
  );
  const windowEnd = Math.min(matchCount, windowStart + searchResultWindowSize);
  const requestedWindowIndexes = new Float64Array(windowEnd - windowStart);
  for (let visibleIndex = windowStart; visibleIndex < windowEnd; visibleIndex += 1) {
    requestedWindowIndexes[visibleIndex - windowStart] = globalMatchIndexAt(
      visibility,
      visibleIndex,
    );
  }

  const activeGlobalIndex = globalMatchIndexAt(visibility, currentMatchIndex);
  const activeWindowPosition = findWindowPosition(result.window.matchIndexes, activeGlobalIndex);
  const windowMatches = result.window.matches.filter((_, index) => {
    const globalIndex = result.window.matchIndexes[index];
    return globalIndex !== undefined && isGlobalMatchVisible(visibility, globalIndex);
  });

  return {
    activeMatch: result.window.matches[activeWindowPosition] ?? null,
    currentMatchIndex,
    matchCount,
    requestedWindowIndexes,
    windowMatches,
  };
};
