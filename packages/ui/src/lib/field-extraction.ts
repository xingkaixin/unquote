import { hasJsonNodeChildren, isStringifiedNode } from "@unquote/core";
import type { JsonNode, JsonlRecord, JsonlRecordPreview } from "@unquote/core";
import { getPreviewMaxDepth, getPreviewPath, getPreviewPathSegments } from "./record-preview";
import type { TreePathSegment } from "./path-codec";
import { walkJsonNode } from "./json-walk";
import { getPrimitiveValue, normalizeKey } from "./record-fields";

// Shared traversal for record-insight / file-overview field extraction. Both
// consumers classify keys differently (their own field enums, tables, and
// `name`-fallback rules), so this module only owns the "walk the record and
// hand back key/value candidates" plumbing, not the classification itself.

export interface FieldCandidate {
  key: string;
  // Walk-scoped for parsed nodes; copy before retaining the candidate.
  pathSegments: readonly TreePathSegment[];
  pathText: string;
  // null for object/array nodes; see ContainerCandidate for those.
  primitiveValue: string | null;
}

export interface ContainerCandidate {
  key: string;
  // Walk-scoped for parsed nodes; copy before retaining the candidate.
  pathSegments: readonly TreePathSegment[];
  pathText: string;
  kind: "object" | "array";
  // Returns the primitive value of the first direct child whose normalized
  // key is in `keys`, or null if none matches. Preview containers carry no
  // child data to inspect, so this always returns null for them. Consumers
  // own what they do with a miss (e.g. record-insight's error fallback
  // label); this module only exposes the data access.
  getChildValue: (keys: string[]) => string | null;
}

export interface FieldExtractionMetrics {
  maxDepth: number;
  nestedCount: number;
  precision: "exact" | "lower-bound";
}

export interface WalkRecordFieldsOptions {
  onField?: (candidate: FieldCandidate) => void;
  onContainer?: (candidate: ContainerCandidate) => void;
}

const getDirectChildValue = (node: JsonNode, keys: string[]) => {
  if (node.kind !== "object" || !hasJsonNodeChildren(node)) {
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

const walkNodeBranch = (
  root: JsonNode,
  metrics: FieldExtractionMetrics,
  onField?: (candidate: FieldCandidate) => void,
  onContainer?: (candidate: ContainerCandidate) => void,
) => {
  walkJsonNode(root, (ctx) => {
    metrics.maxDepth = Math.max(metrics.maxDepth, ctx.pathSegments.length);
    if (isStringifiedNode(ctx.node)) {
      metrics.nestedCount += 1;
    }

    const lastSegment = ctx.pathSegments.at(-1);
    if (lastSegment?.kind !== "key") {
      return;
    }

    const key = lastSegment.value;
    const primitiveValue = getPrimitiveValue(ctx.node);
    onField?.({ key, pathSegments: ctx.pathSegments, pathText: ctx.jsonPath, primitiveValue });

    if (onContainer && (ctx.node.kind === "object" || ctx.node.kind === "array")) {
      onContainer({
        key,
        pathSegments: ctx.pathSegments,
        pathText: ctx.jsonPath,
        kind: ctx.node.kind,
        getChildValue: (keys) => getDirectChildValue(ctx.node, keys),
      });
    }

    // Metrics collection and candidate dispatch must never prune the walk:
    // maxDepth/nestedCount depend on visiting every descendant regardless of
    // classification, so this visitor always implicitly returns `undefined`.
  });
};

const walkPreviewBranch = (
  preview: JsonlRecordPreview,
  metrics: FieldExtractionMetrics,
  onField?: (candidate: FieldCandidate) => void,
  onContainer?: (candidate: ContainerCandidate) => void,
) => {
  metrics.maxDepth = getPreviewMaxDepth(preview);
  metrics.nestedCount = (preview.nestedFieldKeys ?? []).length;

  for (const [key, value] of Object.entries(preview.fields)) {
    onField?.({
      key,
      pathSegments: getPreviewPathSegments(key),
      pathText: getPreviewPath(key),
      primitiveValue: getPrimitiveValue(value),
    });
  }

  if (onContainer) {
    for (const [key, kind] of Object.entries(preview.containers ?? {})) {
      onContainer({
        key,
        pathSegments: getPreviewPathSegments(key),
        pathText: getPreviewPath(key),
        kind,
        getChildValue: () => null,
      });
    }
  }
};

export const walkRecordFields = (
  record: JsonlRecord,
  options: WalkRecordFieldsOptions,
): FieldExtractionMetrics => {
  const metrics: FieldExtractionMetrics = {
    maxDepth: 0,
    nestedCount: 0,
    precision: record.status === "preview" ? "lower-bound" : "exact",
  };

  if (record.status === "preview" && record.preview) {
    walkPreviewBranch(record.preview, metrics, options.onField, options.onContainer);
  } else if (record.status !== "failed") {
    walkNodeBranch(record.node, metrics, options.onField, options.onContainer);
  }

  return metrics;
};
