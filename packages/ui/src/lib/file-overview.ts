import type { JsonlRecord } from "@unquote/core";
import { isParsed } from "@unquote/core";
import { walkRecordFields } from "./field-extraction";
import type { FieldExtractionMetrics } from "./field-extraction";

export interface FileOverview {
  total: number;
  success: number;
  failed: number;
  nestedRecords: number;
  maxDepth: number;
}

export interface RecordOverviewSummary {
  hasNestedJson: boolean;
  maxDepth: number;
}

// The running aggregate across every record seen so far. record-derivation.ts
// owns the incremental cache that decides which records still need summarizing.
export interface FileOverviewAggregate {
  success: number;
  nestedRecords: number;
  maxDepth: number;
}

const emptyRecordOverviewSummary = (): RecordOverviewSummary => ({
  hasNestedJson: false,
  maxDepth: 0,
});

// Records with no tree of their own never reach the traversal, so their
// summary is decided up front; the failed count comes from the parse stats.
export const summarizeUnwalkableRecord = (record: JsonlRecord): RecordOverviewSummary | null =>
  isParsed(record) ? null : emptyRecordOverviewSummary();

export const toRecordOverviewSummary = (
  metrics: FieldExtractionMetrics,
): RecordOverviewSummary => ({
  hasNestedJson: metrics.nestedCount > 0,
  maxDepth: metrics.maxDepth,
});

export const createFileOverviewAggregate = (): FileOverviewAggregate => ({
  success: 0,
  nestedRecords: 0,
  maxDepth: 0,
});

export const addSummaryToFileOverview = (
  state: FileOverviewAggregate,
  record: JsonlRecord,
  summary: RecordOverviewSummary,
) => {
  if (isParsed(record)) {
    state.success += 1;
  }
  if (summary.hasNestedJson) {
    state.nestedRecords += 1;
  }
  state.maxDepth = Math.max(state.maxDepth, summary.maxDepth);
};

export const toFileOverview = (state: FileOverviewAggregate, total: number): FileOverview => ({
  total,
  success: state.success,
  failed: total - state.success,
  nestedRecords: state.nestedRecords,
  maxDepth: state.maxDepth,
});

export const createFileOverview = (records: JsonlRecord[]): FileOverview => {
  const aggregate = createFileOverviewAggregate();
  for (const record of records) {
    const summary =
      summarizeUnwalkableRecord(record) ?? toRecordOverviewSummary(walkRecordFields(record, {}));
    addSummaryToFileOverview(aggregate, record, summary);
  }
  return toFileOverview(aggregate, records.length);
};
