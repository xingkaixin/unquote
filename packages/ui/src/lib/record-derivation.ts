import type { JsonlRecord } from "@unquote/core";
import { walkRecordFields } from "./field-extraction";
import {
  addSummaryToFileOverview,
  createFileOverviewAggregate,
  summarizeUnwalkableRecord,
  toFileOverview,
  toRecordOverviewSummary,
} from "./file-overview";
import type { FileOverview, FileOverviewAggregate, RecordOverviewSummary } from "./file-overview";
import { createInsightCollector } from "./record-insight";
import type { RecordInsight } from "./record-insight";
import { createPartialRecordCache, updatePartialRecordCache } from "./partial-record-cache";
import type { PartialRecordCache } from "./partial-record-cache";
import type { RecordAppend } from "./record-sequence";

// Record insight and file overview both describe the same record tree. Running
// them as two independent pipelines walked it twice; this module walks it once,
// feeding the insight collector and reading the overview off the same metrics.
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
  const metrics = walkRecordFields(record, {
    onField: insightCollector.onField,
    onContainer: insightCollector.onContainer,
  });

  return {
    insight: insightCollector.build(record, metrics),
    overview: toRecordOverviewSummary(metrics),
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
): {
  state: RecordDerivationState;
  insights: Map<string, RecordInsight>;
  overview: FileOverview;
} => {
  const { cache, rebuilt, processed } = updatePartialRecordCache(
    records,
    state.cache,
    deriveRecord,
    recordAppend,
  );
  const insights = rebuilt ? new Map<string, RecordInsight>() : new Map(state.insights);
  const overview = rebuilt ? createFileOverviewAggregate() : { ...state.overview };

  for (const { record, value } of processed) {
    if (value.insight) {
      insights.set(record.id, value.insight);
    } else {
      insights.delete(record.id);
    }
    addSummaryToFileOverview(overview, record, value.overview);
  }

  return {
    state: { cache, insights, overview },
    insights,
    overview: toFileOverview(overview, records.length),
  };
};
