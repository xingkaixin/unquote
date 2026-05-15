import type { JsonNode, JsonlRecord } from "@unquote/core";
import { formatJsonPath } from "./tree";
import type { TreePathSegment } from "./tree";

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

const walkNode = (
  node: JsonNode,
  summary: RecordOverviewSummary,
  pathSegments: TreePathSegment[] = [],
) => {
  const pathText = formatJsonPath(pathSegments);
  summary.maxDepth = Math.max(summary.maxDepth, node.meta.depth);
  if (node.wasStringified) {
    summary.hasNestedJson = true;
    addCount(summary.nestedPaths, pathText);
  }

  if (!node.children) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) =>
      walkNode(child, summary, [...pathSegments, { kind: "index", value: String(index) }]),
    );
    return;
  }

  Object.entries(node.children).forEach(([key, child]) => {
    const childPathSegments = [...pathSegments, { kind: "key" as const, value: key }];
    const field = classifyOverviewField(key, childPathSegments);
    const value = field ? getFieldValue(child) : null;
    if (field && value !== null) {
      addFieldValue(summary.fieldValues, {
        field,
        pathText: formatJsonPath(childPathSegments),
        value,
      });
    }
    walkNode(child, summary, childPathSegments);
  });
};

const summarizeRecord = (record: JsonlRecord): RecordOverviewSummary => {
  const summary: RecordOverviewSummary = {
    hasNestedJson: false,
    maxDepth: 0,
    nestedPaths: new Map(),
    fieldValues: new Map(),
  };

  if (!record.node) {
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

  walkNode(record.node, summary);
  return summary;
};

const sortCountItems = <T extends { count: number }>(items: T[], getLabel: (item: T) => string) =>
  items.sort(
    (left, right) => right.count - left.count || getLabel(left).localeCompare(getLabel(right)),
  );

export const createFileOverview = (
  records: JsonlRecord[],
  cache?: FileOverviewCache,
): FileOverview => {
  const nestedPathCounts = new Map<string, number>();
  const fieldValues = new Map<string, OverviewFieldValue>();
  const errors: OverviewError[] = [];
  const liveRecordIds = new Set<string>();
  let success = 0;
  let nestedRecords = 0;
  let maxDepth = 0;

  for (const record of records) {
    liveRecordIds.add(record.id);
    if (record.node) {
      success += 1;
    }
    const cached = cache?.get(record.id);
    const summary = cached?.record === record ? cached.summary : summarizeRecord(record);
    cache?.set(record.id, { record, summary });

    if (summary.hasNestedJson) {
      nestedRecords += 1;
    }
    maxDepth = Math.max(maxDepth, summary.maxDepth);
    for (const [pathText, count] of summary.nestedPaths) {
      addCount(nestedPathCounts, pathText, count);
    }
    for (const item of summary.fieldValues.values()) {
      addFieldValue(fieldValues, item, item.count);
    }
    if (summary.error) {
      errors.push(summary.error);
    }
  }

  if (cache) {
    for (const recordId of cache.keys()) {
      if (!liveRecordIds.has(recordId)) {
        cache.delete(recordId);
      }
    }
  }

  const topNestedPaths = sortCountItems(
    [...nestedPathCounts.entries()].map(([pathText, count]) => ({ pathText, count })),
    (item) => item.pathText,
  ).slice(0, topNestedPathLimit);
  const topFieldValues = sortCountItems(
    [...fieldValues.values()],
    (item) => `${item.field}:${item.pathText}:${item.value}`,
  ).slice(0, topFieldValueLimit);

  return {
    total: records.length,
    success,
    failed: records.length - success,
    nestedRecords,
    maxDepth,
    topNestedPaths,
    topFieldValues,
    errors,
  };
};
