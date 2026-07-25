import type { JsonlRecord } from "@unquote/core";
import type { TreePathSegment } from "./path-codec";
import type { ContainerCandidate } from "./field-extraction";
import { walkRecordFields } from "./field-extraction";
import { isToolContext, normalizeKey } from "./record-fields";
import { createPartialRecordCache, updatePartialRecordCache } from "./partial-record-cache";
import type { PartialRecordCache } from "./partial-record-cache";

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
  timestamp?: string;
  level?: string;
  status?: string;
  role?: string;
  event?: string;
  tool?: string;
  error?: string;
  message?: string;
}

export interface RecordInsightMapState {
  cache: PartialRecordCache<RecordInsight | null>;
  insights: Map<string, RecordInsight>;
}

const maxInsightValueLength = 160;
const maxInsightTitleLength = 96;
const maxKeyPathCount = 8;
const errorLikePattern =
  /(^|[-_\s.])(error|exception|failed|failure|fatal|panic|timeout)([-_\s.]|$)/i;
const agentsInstructionsPattern = /(^|\n)\s*#\s*AGENTS\.md instructions\b/i;

const truncateText = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

// Keys inspected for a container's fallback text when it has no usable
// primitive value of its own (e.g. `{"error": {"message": "boom"}}`). This is
// insight-specific display logic, so it lives here rather than in the shared
// field-extraction traversal.
const errorContainerFallbackKeys = ["message", "msg", "name", "type", "code"];

const getErrorContainerFallback = (candidate: ContainerCandidate) => {
  const detail = candidate.getChildValue(errorContainerFallbackKeys);
  if (detail) {
    return detail;
  }

  return candidate.kind === "array" ? "error array" : "error object";
};

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
const isInstructionsText = (value: string) => agentsInstructionsPattern.test(value);

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

const addPrimitiveInsightHits = (
  hits: RecordInsightHit[],
  key: string,
  value: string,
  pathText: string,
  pathSegments: TreePathSegment[],
) => {
  const field = classifyInsightField(key, pathSegments);
  if (!field) {
    return;
  }

  addHit(hits, field, key, value, pathText);
  if (
    (field === "level" || field === "status" || field === "message") &&
    isErrorLikeValue(value) &&
    !isInstructionsText(value)
  ) {
    addHit(hits, "error", key, value, pathText);
  }
};

// Shared with file-overview via field-extraction.ts: walkRecordFields owns
// the node/preview traversal, this module only classifies the keys it
// yields and derives its own error-fallback display text (see
// getErrorContainerFallback above).
const collectInsightHits = (record: JsonlRecord) => {
  const hits: RecordInsightHit[] = [];
  const metrics = walkRecordFields(record, {
    onField: ({ key, pathSegments, pathText, primitiveValue }) => {
      if (primitiveValue !== null) {
        addPrimitiveInsightHits(hits, key, primitiveValue, pathText, pathSegments);
      }
    },
    onContainer: (candidate) => {
      if (classifyInsightField(candidate.key, candidate.pathSegments) === "error") {
        addHit(
          hits,
          "error",
          candidate.key,
          getErrorContainerFallback(candidate),
          candidate.pathText,
        );
      }
    },
  });

  return { hits, nestedJsonCount: metrics.nestedCount, maxDepth: metrics.maxDepth };
};

const pathSeparator = ".".charCodeAt(0);

const getPathDepth = (pathText: string) => {
  let depth = 0;
  for (let index = 0; index < pathText.length; index += 1) {
    if (pathText.charCodeAt(index) === pathSeparator) {
      depth += 1;
    }
  }
  return depth;
};

// Counting separators replaces `split(".").length`: both sides of the
// comparison shift by the same constant, so the ordering is unchanged and no
// array is allocated per comparison.
const compareHits = (left: RecordInsightHit, right: RecordInsightHit) =>
  getPathDepth(left.pathText) - getPathDepth(right.pathText) ||
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

const compareFieldHits = (
  field: RecordInsightField,
  left: RecordInsightHit,
  right: RecordInsightHit,
) =>
  field === "error"
    ? getErrorHitPriority(left) - getErrorHitPriority(right) || compareHits(left, right)
    : compareHits(left, right);

// One pass keeping the minimum per field, replacing eight filter+sort passes
// over the same array. The strict `<` keeps the previous stable sort's
// tie-break: among equal hits the earliest one wins.
const pickBestHits = (hits: RecordInsightHit[]) => {
  const best = new Map<RecordInsightField, RecordInsightHit>();

  for (const hit of hits) {
    const current = best.get(hit.field);
    if (!current || compareFieldHits(hit.field, hit, current) < 0) {
      best.set(hit.field, hit);
    }
  }

  return best;
};

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

const createRecordInsightFromHits = (
  record: JsonlRecord,
  hits: RecordInsightHit[],
  metrics: { nestedJsonCount: number; maxDepth: number },
): RecordInsight => {
  const best = pickBestHits(hits);
  const timestamp = best.get("timestamp")?.value;
  const level = best.get("level")?.value;
  const status = best.get("status")?.value;
  const role = best.get("role")?.value;
  const event = best.get("event")?.value;
  const tool = best.get("tool")?.value;
  const error = best.get("error")?.value;
  const message = best.get("message")?.value;
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

  return {
    recordId: record.id,
    lineNumber: record.lineNumber,
    kind,
    title,
    nestedJsonCount: metrics.nestedJsonCount,
    maxDepth: metrics.maxDepth,
    keyPaths,
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

export const createRecordInsight = (record: JsonlRecord): RecordInsight | null => {
  if (!record.node) {
    return null;
  }

  const { hits, nestedJsonCount, maxDepth } = collectInsightHits(record);
  return createRecordInsightFromHits(record, hits, { nestedJsonCount, maxDepth });
};

export const createRecordInsightMap = (records: JsonlRecord[]) => {
  const insights = new Map<string, RecordInsight>();
  for (const record of records) {
    const insight = createRecordInsight(record);
    if (insight) {
      insights.set(record.id, insight);
    }
  }
  return insights;
};

export const createRecordInsightMapState = (): RecordInsightMapState => ({
  cache: createPartialRecordCache(),
  insights: new Map(),
});

export const updateRecordInsightMap = (records: JsonlRecord[], state: RecordInsightMapState) => {
  const { rebuilt, processed } = updatePartialRecordCache(
    records,
    state.cache,
    createRecordInsight,
  );
  if (rebuilt) {
    state.insights = new Map();
  }
  for (const { record, value } of processed) {
    if (value) {
      state.insights.set(record.id, value);
    } else {
      state.insights.delete(record.id);
    }
  }
  return state.insights;
};
