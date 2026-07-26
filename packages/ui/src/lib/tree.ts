import type { JsonNode, JsonlRecord } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode, materializeNode } from "@unquote/core";
import { getPreviewPath } from "./record-preview";
import { formatJsonValueLabel, maxStringValueLabelLength, walkJsonNode } from "./json-walk";
import { resolveTreePath } from "./tree-path";
import type { NodeSourceState, ResolvedTreePath } from "./tree-path";

export interface TreeRow {
  id: string;
  recordId: string;
  path: string[];
  pathText: string;
  jsonPath: string;
  stringifiedPathChain: string[];
  sourceState: NodeSourceState;
  depth: number;
  keyLabel: string;
  kind: JsonNode["kind"];
  valueLabel: string;
  wasStringified: boolean;
  expandable: boolean;
  expanded: boolean;
  node: JsonNode;
}

interface FocusedTreeRows {
  rows: TreeRow[];
  focus: ResolvedTreePath;
}

const pushRows = (
  node: JsonNode,
  rows: TreeRow[],
  expandedStringifiedPaths: ReadonlySet<string>,
  recordId: string,
  jsonPath = "$",
  stringifiedAncestors: string[] = [],
  parentKeyLabel = "$",
  depthOffset = 0,
) => {
  walkJsonNode(
    node,
    (ctx) => {
      const wasStringified = isStringifiedNode(ctx.node);
      const sourceState: NodeSourceState = wasStringified
        ? "stringified"
        : ctx.stringifiedChain.length > 0
          ? "inside-stringified"
          : "source";
      const expanded = !wasStringified || expandedStringifiedPaths.has(ctx.jsonPath);
      const path = ["$", ...ctx.pathSegments.map((segment) => segment.value)];
      rows.push({
        id: `${recordId}:${ctx.jsonPath}`,
        recordId,
        path,
        pathText: ctx.jsonPath,
        jsonPath: ctx.jsonPath,
        stringifiedPathChain: [...ctx.stringifiedChain],
        sourceState,
        depth: Math.max(0, ctx.pathSegments.length - depthOffset),
        keyLabel: ctx.pathSegments.at(-1)?.value ?? parentKeyLabel,
        kind: ctx.node.kind,
        valueLabel: formatJsonValueLabel(ctx, maxStringValueLabelLength),
        wasStringified,
        expandable: hasJsonNodeChildren(ctx.node),
        expanded,
        node: ctx.node,
      });
      return expanded;
    },
    { jsonPath, stringifiedAncestors },
  );
};

export const buildRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: ReadonlySet<string>,
  focusedPath?: string | null,
) => {
  if (!isParsed(record)) {
    return [];
  }

  if (focusedPath) {
    const focused = buildFocusedRecordRows(record, expandedStringifiedPaths, focusedPath);
    if (focused) {
      return focused.rows;
    }
  }

  const rows: TreeRow[] = [];
  pushRows(record.node, rows, expandedStringifiedPaths, record.id);
  return rows;
};

const buildFocusedRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: ReadonlySet<string>,
  focusedPath: string,
): FocusedTreeRows | null => {
  const resolved = resolveTreePath([record], focusedPath);
  if (!resolved.ok) {
    return null;
  }

  const rows: TreeRow[] = [];
  const stringifiedAncestors = isStringifiedNode(resolved.target.node)
    ? resolved.target.stringifiedPathChain.slice(0, -1)
    : resolved.target.stringifiedPathChain;
  pushRows(
    resolved.target.node,
    rows,
    expandedStringifiedPaths,
    record.id,
    resolved.target.jsonPath,
    stringifiedAncestors,
    resolved.target.rawKey,
    Math.max(0, resolved.target.path.length - 1),
  );

  return { rows, focus: resolved.target };
};

export const materializeRecord = (record: JsonlRecord) => {
  if (!isParsed(record)) {
    return null;
  }

  return materializeNode(record.node);
};

const collectPaths = (
  node: JsonNode,
  expandedStringifiedPaths: ReadonlySet<string>,
  output: Set<string>,
  pathText = "$",
) => {
  walkJsonNode(
    node,
    (ctx) => {
      if (isStringifiedNode(ctx.node)) {
        output.add(ctx.jsonPath);
      }
      return !isStringifiedNode(ctx.node) || expandedStringifiedPaths.has(ctx.jsonPath);
    },
    { jsonPath: pathText },
  );
};

export const collectStringifiedPaths = (
  record: JsonlRecord,
  expandedStringifiedPaths: ReadonlySet<string>,
) => {
  // A Preview Record's projected node carries no children, so walking it finds
  // nothing. Its preview already records which top-level fields hold nested
  // JSON. Deeper levels surface once the Full Record resolves and the walk below
  // takes over.
  if (record.status === "preview" && record.preview) {
    return (record.preview.nestedFieldKeys ?? []).map(getPreviewPath);
  }

  if (!isParsed(record)) {
    return [];
  }

  const output = new Set<string>();
  collectPaths(record.node, expandedStringifiedPaths, output);
  return [...output];
};
