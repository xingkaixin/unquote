import type { JsonlRecord } from "@unquote/core";
import { isParsed } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";
import { walkRecordFields } from "./field-extraction";
import { isToolContext, normalizeKey } from "./record-fields";
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
  topNestedPaths: OverviewNestedPath[];
  topFieldValues: OverviewFieldValue[];
  dirtyNestedPaths: Set<string>;
  dirtyFieldValues: Set<string>;
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

const summarizeRecord = (record: JsonlRecord): RecordOverviewSummary => {
  const empty: RecordOverviewSummary = {
    hasNestedJson: false,
    maxDepth: 0,
    nestedPaths: new Map(),
    fieldValues: new Map(),
  };

  if (!isParsed(record)) {
    return {
      ...empty,
      error: {
        recordId: record.id,
        lineNumber: record.lineNumber,
        message: record.error ?? "Parse failed",
        summary: record.summary,
      },
    };
  }

  if (!record.node) {
    return empty;
  }

  const fieldValues = new Map<string, OverviewFieldValue>();
  const metrics = walkRecordFields(record, {
    trackNestedPaths: true,
    onField: ({ key, pathSegments, pathText, primitiveValue }) => {
      const field = classifyOverviewField(key, pathSegments);
      if (field && primitiveValue !== null) {
        addFieldValue(fieldValues, { field, pathText, value: primitiveValue });
      }
    },
  });

  return {
    hasNestedJson: metrics.nestedPaths.size > 0,
    maxDepth: metrics.maxDepth,
    nestedPaths: metrics.nestedPaths,
    fieldValues,
  };
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
  topNestedPaths: [],
  topFieldValues: [],
  dirtyNestedPaths: new Set(),
  dirtyFieldValues: new Set(),
});

const addSummaryToState = (
  state: FileOverviewState,
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
  for (const [pathText, count] of summary.nestedPaths) {
    addCount(state.nestedPathCounts, pathText, count);
    state.dirtyNestedPaths.add(pathText);
  }
  for (const item of summary.fieldValues.values()) {
    addFieldValue(state.fieldValues, item, item.count);
    state.dirtyFieldValues.add(fieldValueKey(item));
  }
  if (summary.error) {
    state.errors.push(summary.error);
  }
};

const toFileOverview = (state: FileOverviewState, total: number): FileOverview => {
  const nestedPathCandidates = new Set([
    ...state.topNestedPaths.map((item) => item.pathText),
    ...state.dirtyNestedPaths,
  ]);
  state.topNestedPaths = sortCountItems(
    [...nestedPathCandidates].map((pathText) => ({
      pathText,
      count: state.nestedPathCounts.get(pathText) ?? 0,
    })),
    (item) => item.pathText,
  ).slice(0, topNestedPathLimit);
  state.dirtyNestedPaths.clear();

  const fieldValueCandidates = new Set([
    ...state.topFieldValues.map(fieldValueKey),
    ...state.dirtyFieldValues,
  ]);
  state.topFieldValues = sortCountItems(
    [...fieldValueCandidates]
      .map((key) => state.fieldValues.get(key))
      .filter((item): item is OverviewFieldValue => Boolean(item)),
    (item) => `${item.field}:${item.pathText}:${item.value}`,
  ).slice(0, topFieldValueLimit);
  state.dirtyFieldValues.clear();

  return {
    total,
    success: state.success,
    failed: total - state.success,
    nestedRecords: state.nestedRecords,
    maxDepth: state.maxDepth,
    topNestedPaths: state.topNestedPaths,
    topFieldValues: state.topFieldValues,
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
