import type { JsonlRecord, ParseResult } from "@unquote/core";
import { isParsed } from "@unquote/core";
import { useMemo, useRef } from "react";
import type { FileOverview } from "../lib/file-overview";
import { createRecordDerivationState, updateRecordDerivations } from "../lib/record-derivation";
import { filterRecords } from "../lib/record-filter";
import type { RecordInsight } from "../lib/record-insight";
import type { SearchMatch, SearchResultSet } from "../lib/record-search";
import { isRecordAppendFrom } from "../lib/record-sequence";
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
  recordInsights: Map<string, RecordInsight>;
  recordsById: Map<string, JsonlRecord>;
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
 * its stats, and the file overview. Pure `useMemo` chain — data flows one way,
 * parse → pipeline → interaction callbacks.
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
  const recordsByIdStateRef = useRef<{
    records: JsonlRecord[] | null;
    map: Map<string, JsonlRecord>;
  }>({ records: null, map: new Map() });

  // Insights and the file overview share one traversal per record, so they are
  // derived together rather than as two independent memos.
  const derivations = useMemo(() => {
    const update = updateRecordDerivations(
      result.records,
      derivationStateRef.current,
      recordAppend,
    );
    derivationStateRef.current = update.state;
    return update;
  }, [recordAppend, result.records]);
  const recordInsights = derivations.insights;
  const fileOverview = derivations.overview;
  const recordsById = useMemo(() => {
    const state = recordsByIdStateRef.current;
    const { records } = result;
    const prevRecords = state.records;
    const isRecordAppend = isRecordAppendFrom(prevRecords, records, recordAppend);

    // Copy-on-write keeps the Map returned by a committed render immutable while
    // still avoiding record traversal for the already indexed prefix.
    if (isRecordAppend && prevRecords) {
      const nextMap = new Map(state.map);
      for (let index = prevRecords.length; index < records.length; index += 1) {
        const record = records[index]!;
        nextMap.set(record.id, record);
      }
      state.map = nextMap;
    } else {
      state.map = new Map(records.map((record) => [record.id, record]));
    }

    state.records = records;
    return state.map;
  }, [recordAppend, result.records]);
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, searchResult, recordInsights),
    [recordFilter, recordInsights, result.records, searchResult],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, result.stats, visibleRecords],
  );
  const searchVisibility = useMemo(
    () => createSearchResultVisibility(searchResult, visibleRecords),
    [searchResult, visibleRecords],
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
