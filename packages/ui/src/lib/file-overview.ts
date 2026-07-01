import type { JsonNode, JsonlRecord } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";
import { walkJsonNode } from "./json-walk";

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

export type FileOverviewCache = Map<
  string,
  {
    record: JsonlRecord;
    summary: RecordOverviewSummary;
  }
>;

export interface FileOverviewState {
  records: JsonlRecord[] | null;
  processedLength: number;
  cache: FileOverviewCache;
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

const normalizeKey = (key: string) => key.replace(/[-_\s]/g, "").toLowerCase();

const classifyOverviewField = (
  key: string,
  pathSegments: TreePathSegment[],
): OverviewField | null => {
  const normalized = normalizeKey(key);
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

  return pathSegments.slice(0, -1).some((segment) => /tool|function/i.test(segment.value))
    ? "tool"
    : null;
};

const getFieldValue = (node: JsonNode) => {
  if (node.kind === "object" || node.kind === "array") {
    return null;
  }

  return node.kind === "string" ? (node.value as string) : String(node.value);
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
    const value = field ? getFieldValue(ctx.node) : null;
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

const addSummaryToState = (state: FileOverviewState, summary: RecordOverviewSummary) => {
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

const addRecordToState = (state: FileOverviewState, record: JsonlRecord) => {
  if (record.node || record.deferred) {
    state.success += 1;
  }
  const cached = state.cache.get(record.id);
  const summary = cached?.record === record ? cached.summary : summarizeRecord(record);
  state.cache.set(record.id, { record, summary });
  addSummaryToState(state, summary);
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
  records: null,
  processedLength: 0,
  cache: new Map(),
  ...createEmptyFileOverviewState(),
});

export const createFileOverview = (
  records: JsonlRecord[],
  cache?: FileOverviewCache,
): FileOverview => {
  const state: FileOverviewState = {
    records,
    processedLength: 0,
    cache: cache ?? new Map(),
    ...createEmptyFileOverviewState(),
  };
  const liveRecordIds = new Set<string>();

  for (const record of records) {
    liveRecordIds.add(record.id);
    addRecordToState(state, record);
  }

  if (cache) {
    for (const recordId of cache.keys()) {
      if (!liveRecordIds.has(recordId)) {
        cache.delete(recordId);
      }
    }
  }

  return toFileOverview(state, records.length);
};

export const updateFileOverview = (
  records: JsonlRecord[],
  state: FileOverviewState,
): FileOverview => {
  if (state.records !== records || state.processedLength > records.length) {
    state.records = records;
    state.processedLength = 0;
    state.cache.clear();
    Object.assign(state, createEmptyFileOverviewState());
  }

  for (let index = state.processedLength; index < records.length; index += 1) {
    addRecordToState(state, records[index]!);
  }
  state.processedLength = records.length;

  return toFileOverview(state, records.length);
};
