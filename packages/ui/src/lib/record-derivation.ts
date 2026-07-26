import type { JsonlRecord } from "@unquote/core";
import { walkRecordFields } from "./field-extraction";
import {
  addSummaryToFileOverview,
  createFileOverviewAggregate,
  createOverviewCollector,
  summarizeUnwalkableRecord,
  toFileOverview,
} from "./file-overview";
import type { FileOverview, FileOverviewAggregate, RecordOverviewSummary } from "./file-overview";
import { createInsightCollector } from "./record-insight";
import type { RecordInsight } from "./record-insight";
import { createPartialRecordCache, updatePartialRecordCache } from "./partial-record-cache";
import type { PartialRecordCache } from "./partial-record-cache";
import type { RecordAppend } from "./record-sequence";

// Record insight and file overview both need every field of every record.
// Running them as two independent pipelines walked each record's tree twice;
// this module walks it once and hands each candidate to both collectors.
export interface RecordDerivation {
  insight: RecordInsight | null;
  overview: RecordOverviewSummary;
}

export interface RecordDerivationState {
  cache: PartialRecordCache;
  insights: Map<string, RecordInsight>;
  overview: FileOverviewAggregate;
}

export const deriveRecord = (record: JsonlRecord): RecordDerivation => {
  // A Failed Record has no tree to walk and contributes only its error summary.
  const unwalkableOverview = summarizeUnwalkableRecord(record);
  if (unwalkableOverview) {
    return { insight: null, overview: unwalkableOverview };
  }

  const insightCollector = createInsightCollector();
  const overviewCollector = createOverviewCollector();
  const metrics = walkRecordFields(record, {
    // Overview aggregates nested-JSON counts per path; insight only needs the
    // scalar count, which the same metrics object already carries.
    trackNestedPaths: true,
    onField: (candidate) => {
      insightCollector.onField(candidate);
      overviewCollector.onField(candidate);
    },
    onContainer: insightCollector.onContainer,
  });

  return {
    insight: insightCollector.build(record, metrics),
    overview: overviewCollector.build(metrics),
  };
};

export const createRecordDerivationState = (): RecordDerivationState => ({
  cache: createPartialRecordCache(),
  insights: new Map(),
  overview: createFileOverviewAggregate(),
});

export const updateRecordDerivations = (
  records: JsonlRecord[],
  state: RecordDerivationState,
  recordAppend: RecordAppend | null = null,
): { insights: Map<string, RecordInsight>; overview: FileOverview } => {
  const { rebuilt, processed } = updatePartialRecordCache(
    records,
    state.cache,
    deriveRecord,
    recordAppend,
  );
  if (rebuilt) {
    state.insights = new Map();
    state.overview = createFileOverviewAggregate();
  }

  for (const { record, value } of processed) {
    if (value.insight) {
      state.insights.set(record.id, value.insight);
    } else {
      state.insights.delete(record.id);
    }
    addSummaryToFileOverview(state.overview, record, value.overview);
  }

  return { insights: state.insights, overview: toFileOverview(state.overview, records.length) };
};
