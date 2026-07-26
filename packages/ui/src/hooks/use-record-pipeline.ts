import type { JsonlRecord, ParseResult } from "@unquote/core";
import { isParsed } from "@unquote/core";
import { useMemo, useRef } from "react";
import type { FileOverview } from "../lib/file-overview";
import { hasUnchangedArrayPrefix } from "../lib/partial-record-cache";
import { createRecordDerivationState, updateRecordDerivations } from "../lib/record-derivation";
import { filterRecords } from "../lib/record-filter";
import type { RecordInsight } from "../lib/record-insight";
import type { SearchMatch } from "../lib/record-search";
import type { QueryInteractionState } from "../lib/query-interaction";
import type { SourceRevision } from "../lib/source-revision";

export interface RecordPipelineParams {
  sourceRevision: SourceRevision;
  result: ParseResult;
  // Search matches from the search worker — covers both in-memory text search
  // and whole-file search, and is null while idle, pending, or errored.
  searchMatches: SearchMatch[] | null;
  recordFilter: QueryInteractionState["recordFilter"];
}

export interface RecordPipeline {
  sourceRevision: SourceRevision;
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
  searchMatches,
  recordFilter,
}: RecordPipelineParams): RecordPipeline => {
  const derivationStateRef = useRef(createRecordDerivationState());
  const recordsByIdStateRef = useRef<{
    records: JsonlRecord[] | null;
    map: Map<string, JsonlRecord>;
  }>({ records: null, map: new Map() });

  const matches = searchMatches;

  // Insights and the file overview share one traversal per record, so they are
  // derived together rather than as two independent memos.
  const derivations = useMemo(
    () => updateRecordDerivations(result.records, derivationStateRef.current),
    [result.records],
  );
  const recordInsights = derivations.insights;
  const fileOverview = derivations.overview;
  const recordsById = useMemo(() => {
    const state = recordsByIdStateRef.current;
    const { records } = result;
    const prevRecords = state.records;
    const hasUnchangedPrefix =
      prevRecords !== null && hasUnchangedArrayPrefix(prevRecords, records);

    // Streaming appends reuse the same Map instance so downstream consumers
    // relying on referential stability (like the stream publisher's array
    // reuse) don't see a spurious change on every animation frame.
    if (hasUnchangedPrefix && prevRecords) {
      for (let index = prevRecords.length; index < records.length; index += 1) {
        const record = records[index]!;
        state.map.set(record.id, record);
      }
    } else {
      state.map = new Map(records.map((record) => [record.id, record]));
    }

    state.records = records;
    return state.map;
  }, [result.records]);
  const visibleRecords = useMemo(
    () => filterRecords(result.records, recordFilter, matches, recordInsights),
    [matches, recordFilter, recordInsights, result.records],
  );
  const visibleStats = useMemo(
    () => (recordFilter === "all" ? result.stats : getRecordStats(visibleRecords)),
    [recordFilter, result.stats, visibleRecords],
  );
  const visibleMatches = useMemo(() => {
    if (!matches) return null;

    const visibleRecordIds = new Set(visibleRecords.map((record) => record.id));
    return matches.filter((match) => visibleRecordIds.has(match.recordId));
  }, [matches, visibleRecords]);
  const matchCount = visibleMatches?.length ?? 0;

  return {
    sourceRevision,
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
