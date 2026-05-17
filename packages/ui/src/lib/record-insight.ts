import type { JsonNode, JsonlRecord } from "@unquote/core";
import { formatJsonPath } from "./tree";
import type { TreePathSegment } from "./tree";

export type RecordInsightKind = "error" | "tool" | "message" | "event";

export type RecordInsightField =
  | "timestamp"
  | "level"
  | "status"
  | "role"
  | "event"
  | "tool"
  | "error"
  | "message";

export interface RecordInsightHit {
  field: RecordInsightField;
  key: string;
  value: string;
  pathText: string;
}

export interface RecordInsight {
  recordId: string;
  lineNumber: number;
  kind: RecordInsightKind;
  title: string;
  nestedJsonCount: number;
  maxDepth: number;
  keyPaths: string[];
  filterText: string;
  timestamp?: string;
  level?: string;
  status?: string;
  role?: string;
  event?: string;
  tool?: string;
  error?: string;
  message?: string;
}

export type RecordInsightCache = Map<
  string,
  {
    record: JsonlRecord;
    insight: RecordInsight | null;
  }
>;

export interface RecordInsightMapState {
  records: JsonlRecord[] | null;
  processedLength: number;
  cache: RecordInsightCache;
  insights: Map<string, RecordInsight>;
}

const maxInsightValueLength = 160;
const maxInsightTitleLength = 96;
const maxKeyPathCount = 8;
const errorLikePattern =
  /(^|[-_\s.])(error|exception|failed|failure|fatal|panic|timeout)([-_\s.]|$)/i;

const normalizeKey = (key: string) => key.replace(/[-_\s.]/g, "").toLowerCase();

const truncateText = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

const getPrimitiveValue = (node: JsonNode) => {
  if (node.kind === "object" || node.kind === "array") {
    return null;
  }

  return node.kind === "string" ? (node.value as string) : String(node.value);
};

const getDirectChildValue = (node: JsonNode, keys: string[]) => {
  if (node.kind !== "object" || !node.children || Array.isArray(node.children)) {
    return null;
  }

  for (const [key, child] of Object.entries(node.children)) {
    if (keys.includes(normalizeKey(key))) {
      const value = getPrimitiveValue(child);
      if (value) {
        return value;
      }
    }
  }

  return null;
};

const getErrorValue = (node: JsonNode) => {
  const primitive = getPrimitiveValue(node);
  if (primitive !== null) {
    return primitive;
  }

  const detail = getDirectChildValue(node, ["message", "msg", "name", "type", "code"]);
  if (detail) {
    return detail;
  }

  return node.kind === "array" ? "error array" : "error object";
};

const isToolContext = (segments: TreePathSegment[]) =>
  segments.some((segment) => /tool|function/i.test(segment.value));

const classifyInsightField = (
  key: string,
  pathSegments: TreePathSegment[],
): RecordInsightField | null => {
  const normalized = normalizeKey(key);

  if (
    normalized === "timestamp" ||
    normalized === "time" ||
    normalized === "ts" ||
    normalized === "createdat" ||
    normalized === "created" ||
    normalized === "date" ||
    normalized === "datetime" ||
    normalized === "occurredat"
  ) {
    return "timestamp";
  }

  if (normalized === "level" || normalized === "severity") {
    return "level";
  }

  if (normalized === "status" || normalized === "state") {
    return "status";
  }

  if (normalized === "role" || normalized === "speaker" || normalized === "author") {
    return "role";
  }

  if (
    normalized === "event" ||
    normalized === "type" ||
    normalized === "action" ||
    normalized === "operation"
  ) {
    return "event";
  }

  if (normalized === "tool" || normalized === "toolname" || normalized === "functionname") {
    return "tool";
  }

  if (normalized === "error" || normalized === "exception" || normalized === "err") {
    return "error";
  }

  if (
    normalized === "message" ||
    normalized === "msg" ||
    normalized === "content" ||
    normalized === "text" ||
    normalized === "summary"
  ) {
    return "message";
  }

  if (normalized === "name") {
    return isToolContext(pathSegments.slice(0, -1)) ? "tool" : "event";
  }

  return null;
};

const isErrorLikeValue = (value: string) => errorLikePattern.test(value);

const addHit = (
  hits: RecordInsightHit[],
  field: RecordInsightField,
  key: string,
  value: string,
  pathText: string,
) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  hits.push({
    field,
    key,
    value: truncateText(trimmed, maxInsightValueLength),
    pathText,
  });
};

const walkNode = (
  node: JsonNode,
  hits: RecordInsightHit[],
  metrics: { nestedJsonCount: number; maxDepth: number },
  pathSegments: TreePathSegment[] = [],
) => {
  metrics.maxDepth = Math.max(metrics.maxDepth, node.meta.depth);
  if (node.wasStringified) {
    metrics.nestedJsonCount += 1;
  }

  if (!node.children || Array.isArray(node.children)) {
    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) =>
        walkNode(child, hits, metrics, [...pathSegments, { kind: "index", value: String(index) }]),
      );
    }
    return;
  }

  Object.entries(node.children).forEach(([key, child]) => {
    const childPathSegments = [...pathSegments, { kind: "key" as const, value: key }];
    const pathText = formatJsonPath(childPathSegments);
    const field = classifyInsightField(key, childPathSegments);
    const primitiveValue = getPrimitiveValue(child);

    if (field === "error") {
      addHit(hits, "error", key, getErrorValue(child), pathText);
    } else if (field && primitiveValue !== null) {
      addHit(hits, field, key, primitiveValue, pathText);
      if (
        (field === "level" || field === "status" || field === "message") &&
        isErrorLikeValue(primitiveValue)
      ) {
        addHit(hits, "error", key, primitiveValue, pathText);
      }
    }

    walkNode(child, hits, metrics, childPathSegments);
  });
};

const compareHits = (left: RecordInsightHit, right: RecordInsightHit) =>
  left.pathText.split(".").length - right.pathText.split(".").length ||
  left.value.length - right.value.length ||
  left.pathText.localeCompare(right.pathText);

const getErrorHitPriority = (hit: RecordInsightHit) => {
  const key = normalizeKey(hit.key);
  if (key === "error" || key === "exception" || key === "err") {
    return 0;
  }
  if (key === "message" || key === "msg" || key === "content" || key === "text") {
    return 1;
  }
  if (key === "level" || key === "severity" || key === "status" || key === "state") {
    return 2;
  }
  return 3;
};

const pickHit = (hits: RecordInsightHit[], field: RecordInsightField) =>
  hits
    .filter((hit) => hit.field === field)
    .sort((left, right) =>
      field === "error"
        ? getErrorHitPriority(left) - getErrorHitPriority(right) || compareHits(left, right)
        : compareHits(left, right),
    )[0];

const getKind = (values: {
  event: string | undefined;
  role: string | undefined;
  tool: string | undefined;
  error: string | undefined;
  message: string | undefined;
}) => {
  if (values.error) {
    return "error";
  }

  if (values.tool || (values.event && /tool|function/i.test(values.event))) {
    return "tool";
  }

  if (values.role && /assistant|model|agent/i.test(values.role)) {
    return "message";
  }

  if (values.message) {
    return "message";
  }

  return "event";
};

const getTitle = (
  summary: string,
  values: {
    kind: RecordInsightKind;
    event: string | undefined;
    role: string | undefined;
    tool: string | undefined;
    error: string | undefined;
    message: string | undefined;
    status: string | undefined;
    level: string | undefined;
  },
) => {
  if (values.kind === "error") {
    return truncateText(
      values.error ?? values.status ?? values.level ?? "Error",
      maxInsightTitleLength,
    );
  }

  if (values.kind === "tool") {
    return truncateText(
      [values.event, values.tool].filter(Boolean).join(" - "),
      maxInsightTitleLength,
    );
  }

  if (values.kind === "message") {
    return truncateText(
      [values.role, values.message].filter(Boolean).join(" - "),
      maxInsightTitleLength,
    );
  }

  return truncateText(
    values.event ?? values.status ?? values.level ?? summary,
    maxInsightTitleLength,
  );
};

const unique = (values: string[]) => [...new Set(values)];

export const createRecordInsight = (record: JsonlRecord): RecordInsight | null => {
  if (!record.node) {
    return null;
  }

  const hits: RecordInsightHit[] = [];
  const metrics = { nestedJsonCount: 0, maxDepth: 0 };
  walkNode(record.node, hits, metrics);

  const timestamp = pickHit(hits, "timestamp")?.value;
  const level = pickHit(hits, "level")?.value;
  const status = pickHit(hits, "status")?.value;
  const role = pickHit(hits, "role")?.value;
  const event = pickHit(hits, "event")?.value;
  const tool = pickHit(hits, "tool")?.value;
  const error = pickHit(hits, "error")?.value;
  const message = pickHit(hits, "message")?.value;
  const kind = getKind({ event, role, tool, error, message });
  const title = getTitle(record.summary, {
    kind,
    event,
    role,
    tool,
    error,
    message,
    status,
    level,
  });
  const keyPaths = unique(hits.map((hit) => hit.pathText)).slice(0, maxKeyPathCount);
  const filterText = [
    kind,
    title,
    record.summary,
    timestamp,
    level,
    status,
    role,
    event,
    tool,
    error,
    message,
    ...hits.flatMap((hit) => [hit.key, hit.pathText, hit.value]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return {
    recordId: record.id,
    lineNumber: record.lineNumber,
    kind,
    title,
    nestedJsonCount: metrics.nestedJsonCount,
    maxDepth: metrics.maxDepth,
    keyPaths,
    filterText,
    ...(timestamp ? { timestamp } : {}),
    ...(level ? { level } : {}),
    ...(status ? { status } : {}),
    ...(role ? { role } : {}),
    ...(event ? { event } : {}),
    ...(tool ? { tool } : {}),
    ...(error ? { error } : {}),
    ...(message ? { message } : {}),
  };
};

export const createRecordInsightMap = (records: JsonlRecord[], cache?: RecordInsightCache) => {
  const insights = new Map<string, RecordInsight>();
  const liveRecordIds = new Set<string>();

  for (const record of records) {
    liveRecordIds.add(record.id);
    const cached = cache?.get(record.id);
    const insight = cached?.record === record ? cached.insight : createRecordInsight(record);
    cache?.set(record.id, { record, insight });
    if (insight) {
      insights.set(record.id, insight);
    }
  }

  if (cache) {
    for (const recordId of cache.keys()) {
      if (!liveRecordIds.has(recordId)) {
        cache.delete(recordId);
      }
    }
  }

  return insights;
};

export const createRecordInsightMapState = (): RecordInsightMapState => ({
  records: null,
  processedLength: 0,
  cache: new Map(),
  insights: new Map(),
});

export const updateRecordInsightMap = (
  records: JsonlRecord[],
  state: RecordInsightMapState,
) => {
  if (state.records === records && state.processedLength <= records.length) {
    for (let index = state.processedLength; index < records.length; index += 1) {
      const record = records[index]!;
      const insight = createRecordInsight(record);
      state.cache.set(record.id, { record, insight });
      if (insight) {
        state.insights.set(record.id, insight);
      }
    }
    state.processedLength = records.length;
    return state.insights;
  }

  state.records = records;
  state.processedLength = records.length;
  state.insights = createRecordInsightMap(records, state.cache);
  return state.insights;
};
