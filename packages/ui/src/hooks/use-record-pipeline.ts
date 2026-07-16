import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useMemo, useRef } from "react";
import { createFileOverviewState, updateFileOverview } from "../lib/file-overview";
import type { FileOverview } from "../lib/file-overview";
import { createRecordInsightMapState, updateRecordInsightMap } from "../lib/record-insight";
import type { RecordInsight } from "../lib/record-insight";
import type { QueryInteractionState } from "../lib/query-interaction";
import { filterRecords } from "../lib/tree";
import type { SearchMatch } from "../lib/tree";

export interface RecordPipelineParams {
  result: ParseResult;
  // Search matches from the search worker — covers both in-memory text search
  // and whole-file search, and is null while idle, pending, or errored.
  searchMatches: SearchMatch[] | null;
  recordFilter: QueryInteractionState["recordFilter"];
}

export interface RecordPipeline {
  matches: SearchMatch[] | null;
  recordInsights: Map<string, RecordInsight>;
  recordsById: Map<string, JsonlRecord>;
  visibleRecords: JsonlRecord[];
  visibleStats: { total: number; success: number; failed: number };
  fileOverview: FileOverview;
  visibleMatches: SearchMatch[] | null;
  matchCount: number;
}

const getRecordStats = (records: JsonlRecord[]) => {
  const success = records.filter((record) => record.node || record.deferred).length;
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
  result,
  searchMatches,
  recordFilter,
}: RecordPipelineParams): RecordPipeline => {
  const overviewStateRef = useRef(createFileOverviewState());
  const recordInsightStateRef = useRef(createRecordInsightMapState());

  const matches = searchMatches;

  const recordInsights = useMemo(
    () => updateRecordInsightMap(result.records, recordInsightStateRef.current),
    [result.records],
  );
  const recordsById = useMemo(
    () => new Map(result.records.map((record) => [record.id, record])),
    [result.records],
  );
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matches, recordInsights),
    [matches, recordFilter, recordInsights, result.records],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, result.stats, visibleRecords],
  );
  const fileOverview = useMemo(
    () => updateFileOverview(result.records, overviewStateRef.current),
    [result.records],
  );
  const visibleMatches = useMemo(() => {
    if (!matches) return null;

    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    return matches.filter((match) => visibleRecordIds.has(match.recordId));
  }, [matches, visibleRecords]);
  const matchCount = visibleMatches?.length ?? 0;

  return {
    matches,
    recordInsights,
    recordsById,
    visibleRecords,
    visibleStats,
    fileOverview,
    visibleMatches,
    matchCount,
  };
};
