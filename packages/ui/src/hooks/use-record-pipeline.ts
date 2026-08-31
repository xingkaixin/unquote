import type { JsonlRecord, ParseResult } from "@unquote/core";
import { isParsed } from "@unquote/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { FileOverview } from "../lib/file-overview";
import { createRecordDerivationState, updateRecordDerivations } from "../lib/record-derivation";
import type { RecordInsights, RecordLookup } from "../lib/record-derivation";
import { filterRecords } from "../lib/record-filter";
import type { SearchMatch, SearchResultSet } from "../lib/record-search";
import type { RecordAppend } from "../lib/record-sequence";
import type { QueryInteractionState } from "../lib/query-interaction";
import { createSearchResultVisibility, projectSearchResult } from "../lib/search-result";
import type { SourceRevision } from "../lib/source-revision";

export interface RecordPipelineParams {
  sourceRevision: SourceRevision;
  result: ParseResult;
  // The bounded result set covers both in-memory and whole-file search, and is
  // null while search is idle, pending, or errored.
  searchResult: SearchResultSet | null;
  currentMatchIndex?: number;
  recordFilter: QueryInteractionState["recordFilter"];
  recordAppend?: RecordAppend | null;
}

export interface RecordPipeline {
  sourceRevision: SourceRevision;
  activeSearchMatch: SearchMatch | null;
  currentMatchIndex: number;
  recordInsights: RecordInsights;
  recordsById: RecordLookup;
  visibleRecords: JsonlRecord[];
  visibleRecordAppend: RecordAppend | null;
  visibleStats: { total: number; success: number; failed: number };
  fileOverview: FileOverview;
  visibleMatches: SearchMatch[] | null;
  matchCount: number;
  requestedSearchWindowIndexes: Float64Array;
}

const getRecordStats = (records: JsonlRecord[]) => {
  const success = records.filter(isParsed).length;
  return {
    total: records.length,
    success,
    failed: records.length - success,
  };
};

/**
 * Derives everything the app renders from the parse result and the current
 * query state: search matches, record insights, the filtered visible set with
 * its stats, and the file overview. Data flows one way: parse → pipeline →
 * interaction callbacks.
 */
export const useRecordPipeline = ({
  sourceRevision,
  result,
  searchResult,
  currentMatchIndex = 0,
  recordFilter,
  recordAppend = null,
}: RecordPipelineParams): RecordPipeline => {
  const derivationStateRef = useRef(createRecordDerivationState());

  // Insights and the file overview share one traversal per record, so they are
  // derived together rather than as two independent memos.
  const derivations = useMemo(() => {
    return updateRecordDerivations(result.records, derivationStateRef.current, recordAppend);
  }, [recordAppend, result.records]);
  const recordInsights = derivations.insights;
  const fileOverview = derivations.overview;
  const recordsById = derivations.recordsById;

  useLayoutEffect(() => {
    derivationStateRef.current = derivations.state;
  }, [derivations.state]);
  const matchLineNumbers = searchResult?.matchLineNumbers ?? null;
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matchLineNumbers, recordInsights),
    [recordFilter, recordInsights, result.records, matchLineNumbers],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, result.stats, visibleRecords],
  );
  const searchVisibility = useMemo(
    () => createSearchResultVisibility(matchLineNumbers, visibleRecords),
    [matchLineNumbers, visibleRecords],
  );
  const searchProjection = useMemo(
    () => projectSearchResult(searchResult, searchVisibility, currentMatchIndex),
    [currentMatchIndex, searchResult, searchVisibility],
  );
  const visibleRecordAppend = recordFilter === "all" ? recordAppend : null;

  return {
    sourceRevision,
    activeSearchMatch: searchProjection.activeMatch,
    currentMatchIndex: searchProjection.currentMatchIndex,
    recordInsights,
    recordsById,
    visibleRecords,
    visibleRecordAppend,
    visibleStats,
    fileOverview,
    visibleMatches: searchProjection.windowMatches,
    matchCount: searchProjection.matchCount,
    requestedSearchWindowIndexes: searchProjection.requestedWindowIndexes,
  };
};
