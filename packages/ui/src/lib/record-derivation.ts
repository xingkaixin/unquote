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
  recordIndexes: Map<string, number>;
  insightsById: Map<string, RecordInsight>;
  overview: FileOverviewAggregate;
}

export interface RecordLookup {
  readonly size: number;
  get(recordId: string): JsonlRecord | undefined;
  has(recordId: string): boolean;
}

export interface RecordInsights {
  get(recordId: string): RecordInsight | undefined;
}

const recordAt = (
  records: readonly JsonlRecord[],
  recordIndexes: ReadonlyMap<string, number>,
  recordId: string,
) => {
  const index = recordIndexes.get(recordId);
  const record = index === undefined ? undefined : records[index];
  return record?.id === recordId ? record : undefined;
};

const createRecordLookup = (
  records: readonly JsonlRecord[],
  recordIndexes: ReadonlyMap<string, number>,
): RecordLookup => ({
  size: records.length,
  get: (recordId) => recordAt(records, recordIndexes, recordId),
  has: (recordId) => recordAt(records, recordIndexes, recordId) !== undefined,
});

const createRecordInsights = (
  records: readonly JsonlRecord[],
  recordIndexes: ReadonlyMap<string, number>,
  insightsById: ReadonlyMap<string, RecordInsight>,
): RecordInsights => ({
  get: (recordId) =>
    recordAt(records, recordIndexes, recordId) ? insightsById.get(recordId) : undefined,
});

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
  recordIndexes: new Map(),
  insightsById: new Map(),
  overview: createFileOverviewAggregate(),
});

export const updateRecordDerivations = (
  records: JsonlRecord[],
  state: RecordDerivationState,
  recordAppend: RecordAppend | null = null,
): {
  state: RecordDerivationState;
  recordsById: RecordLookup;
  insights: RecordInsights;
  overview: FileOverview;
} => {
  const { cache, rebuilt, processed } = updatePartialRecordCache(
    records,
    state.cache,
    deriveRecord,
    recordAppend,
  );
  // Shared append-only indexes avoid copying history. Each returned lookup is
  // bounded by its own records array, so older render snapshots cannot see a suffix.
  const recordIndexes = rebuilt ? new Map<string, number>() : state.recordIndexes;
  const insightsById = rebuilt ? new Map<string, RecordInsight>() : state.insightsById;
  const overview = rebuilt ? createFileOverviewAggregate() : { ...state.overview };

  const firstProcessedIndex = records.length - processed.length;
  for (let offset = 0; offset < processed.length; offset += 1) {
    const { record, value } = processed[offset]!;
    recordIndexes.set(record.id, firstProcessedIndex + offset);
    if (value.insight) {
      insightsById.set(record.id, value.insight);
    } else {
      insightsById.delete(record.id);
    }
    addSummaryToFileOverview(overview, record, value.overview);
  }

  return {
    state: { cache, recordIndexes, insightsById, overview },
    recordsById: createRecordLookup(records, recordIndexes),
    insights: createRecordInsights(records, recordIndexes, insightsById),
    overview: toFileOverview(overview, records.length),
  };
};
