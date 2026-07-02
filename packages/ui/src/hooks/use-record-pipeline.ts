import type { JsonlRecord, ParseResult } from "@unquote/core";
import { useMemo, useRef } from "react";
import { createFileOverviewState, updateFileOverview } from "../lib/file-overview";
import type { FileOverview } from "../lib/file-overview";
import { measurePerfFn } from "../lib/perf";
import { createRecordInsightMapState, updateRecordInsightMap } from "../lib/record-insight";
import type { RecordInsight } from "../lib/record-insight";
import type { QueryInteractionState } from "../lib/query-interaction";
import { filterRecords, searchRecords } from "../lib/tree";
import type { SearchMatch, SearchOptions } from "../lib/tree";

export interface RecordPipelineParams {
  result: ParseResult;
  recordsVersion: number;
  sourceFile: File | null;
  // Whole-file matches from the local-file source; used instead of in-memory
  // search whenever a streamed file is attached.
  fileMatches: SearchMatch[] | null;
  searchQuery: string;
  searchOptions: SearchOptions;
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
  recordsVersion,
  sourceFile,
  fileMatches,
  searchQuery,
  searchOptions,
  recordFilter,
}: RecordPipelineParams): RecordPipeline => {
  const overviewStateRef = useRef(createFileOverviewState());
  const recordInsightStateRef = useRef(createRecordInsightMapState());

  const inMemoryMatches = useMemo(() => {
    if (!searchQuery || sourceFile) return null;
    return measurePerfFn("search:memory", () =>
      searchRecords(result.records, searchQuery, searchOptions),
    );
  }, [recordsVersion, result.records, searchOptions, searchQuery, sourceFile]);

  const matches = sourceFile && searchQuery ? fileMatches : inMemoryMatches;

  const recordInsights = useMemo(
    () => updateRecordInsightMap(result.records, recordInsightStateRef.current),
    [recordsVersion, result.records],
  );
  const recordsById = useMemo(
    () => new Map(result.records.map((record) => [record.id, record])),
    [recordsVersion, result.records],
  );
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matches, recordInsights),
    [matches, recordFilter, recordInsights, recordsVersion, result.records],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, recordsVersion, result.stats, visibleRecords],
  );
  const fileOverview = useMemo(
    () => updateFileOverview(result.records, overviewStateRef.current),
    [recordsVersion, result.records],
  );
  const visibleMatches = useMemo(() => {
    if (!matches) return null;

    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    return matches.filter((match) => visibleRecordIds.has(match.recordId));
  }, [matches, recordsVersion, visibleRecords]);
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
