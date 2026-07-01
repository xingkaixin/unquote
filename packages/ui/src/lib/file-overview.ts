import type { JsonNode, JsonlRecord } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";
import { walkJsonNode } from "./json-walk";
import { getPrimitiveValue, isToolContext, normalizeKey } from "./record-fields";
import { createPartialRecordCache, updatePartialRecordCache } from "./partial-record-cache";
import type { PartialRecordCache } from "./partial-record-cache";

export type OverviewField = "event" | "type" | "tool";

export interface OverviewNestedPath {
  pathText: string;
  count: number;
}

export interface OverviewFieldValue {
  field: OverviewField;
  pathText: string;
  value: string;
  count: number;
}

export interface OverviewError {
  recordId: string;
  lineNumber: number;
  message: string;
  summary: string;
}

export interface FileOverview {
  total: number;
  success: number;
  failed: number;
  nestedRecords: number;
  maxDepth: number;
  topNestedPaths: OverviewNestedPath[];
  topFieldValues: OverviewFieldValue[];
  errors: OverviewError[];
}

interface RecordOverviewSummary {
  hasNestedJson: boolean;
  maxDepth: number;
  nestedPaths: Map<string, number>;
  fieldValues: Map<string, OverviewFieldValue>;
  error?: OverviewError;
}

export interface FileOverviewState {
  cache: PartialRecordCache<RecordOverviewSummary>;
  nestedPathCounts: Map<string, number>;
  fieldValues: Map<string, OverviewFieldValue>;
  errors: OverviewError[];
  success: number;
  nestedRecords: number;
  maxDepth: number;
}

const topNestedPathLimit = 6;
const topFieldValueLimit = 8;

const addCount = (counts: Map<string, number>, key: string, count = 1) => {
  counts.set(key, (counts.get(key) ?? 0) + count);
};

const classifyOverviewField = (
  key: string,
  pathSegments: TreePathSegment[],
): OverviewField | null => {
  const normalized = normalizeKey(key, false);
  if (normalized === "event" || normalized === "action") {
    return "event";
  }
  if (normalized === "type") {
    return "type";
  }
  if (normalized === "tool" || normalized === "toolname") {
    return "tool";
  }
  if (normalized !== "name") {
    return null;
  }

  return isToolContext(pathSegments.slice(0, -1)) ? "tool" : null;
};

const fieldValueKey = (item: Omit<OverviewFieldValue, "count">) =>
  `${item.field}\u0000${item.pathText}\u0000${item.value}`;

const addFieldValue = (
  values: Map<string, OverviewFieldValue>,
  item: Omit<OverviewFieldValue, "count">,
  count = 1,
) => {
  const key = fieldValueKey(item);
  const current = values.get(key);
  if (current) {
    current.count += count;
    return;
  }

  values.set(key, { ...item, count });
};

const walkNode = (root: JsonNode, summary: RecordOverviewSummary) => {
  walkJsonNode(root, (ctx) => {
    summary.maxDepth = Math.max(summary.maxDepth, ctx.node.meta.depth);
    if (ctx.node.wasStringified) {
      summary.hasNestedJson = true;
      addCount(summary.nestedPaths, ctx.jsonPath);
    }

    const lastSegment = ctx.pathSegments.at(-1);
    if (lastSegment?.kind !== "key") {
      return;
    }

    const field = classifyOverviewField(lastSegment.value, ctx.pathSegments);
    const value = field ? getPrimitiveValue(ctx.node) : null;
    if (field && value !== null) {
      addFieldValue(summary.fieldValues, { field, pathText: ctx.jsonPath, value });
    }
  });
};

const summarizeRecord = (record: JsonlRecord): RecordOverviewSummary => {
  const summary: RecordOverviewSummary = {
    hasNestedJson: false,
    maxDepth: 0,
    nestedPaths: new Map(),
    fieldValues: new Map(),
  };

  if (!record.node && !record.deferred) {
    return {
      ...summary,
      error: {
        recordId: record.id,
        lineNumber: record.lineNumber,
        message: record.error ?? "Parse failed",
        summary: record.summary,
      },
    };
  }

  if (!record.node) {
    return summary;
  }

  walkNode(record.node, summary);
  return summary;
};

const sortCountItems = <T extends { count: number }>(items: T[], getLabel: (item: T) => string) =>
  items.sort(
    (left, right) => right.count - left.count || getLabel(left).localeCompare(getLabel(right)),
  );

const createEmptyFileOverviewState = (): Omit<
  FileOverviewState,
  "records" | "processedLength" | "cache"
> => ({
  nestedPathCounts: new Map(),
  fieldValues: new Map(),
  errors: [],
  success: 0,
  nestedRecords: 0,
  maxDepth: 0,
});

const addSummaryToState = (
  state: FileOverviewState,
  record: JsonlRecord,
  summary: RecordOverviewSummary,
) => {
  if (record.node || record.deferred) {
    state.success += 1;
  }
  if (summary.hasNestedJson) {
    state.nestedRecords += 1;
  }
  state.maxDepth = Math.max(state.maxDepth, summary.maxDepth);
  for (const [pathText, count] of summary.nestedPaths) {
    addCount(state.nestedPathCounts, pathText, count);
  }
  for (const item of summary.fieldValues.values()) {
    addFieldValue(state.fieldValues, item, item.count);
  }
  if (summary.error) {
    state.errors.push(summary.error);
  }
};

const toFileOverview = (state: FileOverviewState, total: number): FileOverview => {
  const topNestedPaths = sortCountItems(
    [...state.nestedPathCounts.entries()].map(([pathText, count]) => ({ pathText, count })),
    (item) => item.pathText,
  ).slice(0, topNestedPathLimit);
  const topFieldValues = sortCountItems(
    [...state.fieldValues.values()],
    (item) => `${item.field}:${item.pathText}:${item.value}`,
  ).slice(0, topFieldValueLimit);

  return {
    total,
    success: state.success,
    failed: total - state.success,
    nestedRecords: state.nestedRecords,
    maxDepth: state.maxDepth,
    topNestedPaths,
    topFieldValues,
    errors: state.errors,
  };
};

export const createFileOverviewState = (): FileOverviewState => ({
  cache: createPartialRecordCache(),
  ...createEmptyFileOverviewState(),
});

export const createFileOverview = (records: JsonlRecord[]): FileOverview => {
  const state: FileOverviewState = {
    cache: createPartialRecordCache(),
    ...createEmptyFileOverviewState(),
  };
  for (const record of records) {
    addSummaryToState(state, record, summarizeRecord(record));
  }
  return toFileOverview(state, records.length);
};

export const updateFileOverview = (
  records: JsonlRecord[],
  state: FileOverviewState,
): FileOverview => {
  const { rebuilt, processed } = updatePartialRecordCache(records, state.cache, summarizeRecord);
  if (rebuilt) {
    Object.assign(state, createEmptyFileOverviewState());
  }
  for (const { record, value } of processed) {
    addSummaryToState(state, record, value);
  }
  return toFileOverview(state, records.length);
};
