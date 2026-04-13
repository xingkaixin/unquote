import type { JsonNode, JsonlRecord, ParseResult } from "@unquote/core";
import { materializeNode, restoreNode } from "@unquote/core";

export interface TreeRow {
  id: string;
  recordId: string;
  path: string[];
  pathText: string;
  depth: number;
  keyLabel: string;
  kind: JsonNode["kind"];
  valueLabel: string;
  wasStringified: boolean;
  expandable: boolean;
  expanded: boolean;
  node: JsonNode;
}

const stringifyPath = (path: string[]) => {
  const [, ...rest] = path;
  if (rest.length === 0) {
    return "$";
  }

  return rest.reduce((accumulator, segment) => {
    const numeric = /^\d+$/.test(segment);
    return numeric ? `${accumulator}[${segment}]` : `${accumulator}.${segment}`;
  }, "$");
};

const formatValueLabel = (node: JsonNode) => {
  switch (node.kind) {
    case "object":
      return `{${Object.keys((node.children as Record<string, JsonNode>) ?? {}).length}}`;
    case "array":
      return `[${(node.children as JsonNode[] | undefined)?.length ?? 0}]`;
    case "string":
      return JSON.stringify(node.value);
    case "null":
      return "null";
    default:
      return String(node.value);
  }
};

export const getRenderedNode = (record: JsonlRecord, restoredRecordIds: Set<string>) => {
  if (!record.node) {
    return null;
  }

  return restoredRecordIds.has(record.id) ? restoreNode(record.node) : record.node;
};

const pushRows = (
  node: JsonNode,
  rows: TreeRow[],
  expandedStringifiedPaths: Set<string>,
  recordId: string,
  parentKeyLabel = "$",
) => {
  const pathText = stringifyPath(node.path);
  const expanded = !node.wasStringified || expandedStringifiedPaths.has(pathText);
  const keyLabel = node.path.at(-1) ?? parentKeyLabel;
  rows.push({
    id: `${recordId}:${pathText}`,
    recordId,
    path: node.path,
    pathText,
    depth: Math.max(0, node.path.length - 1),
    keyLabel,
    kind: node.kind,
    valueLabel: formatValueLabel(node),
    wasStringified: node.wasStringified,
    expandable: Boolean(node.children),
    expanded,
    node,
  });

  if (!node.children || !expanded) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) =>
      pushRows(child, rows, expandedStringifiedPaths, recordId, String(index)),
    );
    return;
  }

  Object.entries(node.children).forEach(([key, child]) =>
    pushRows(child, rows, expandedStringifiedPaths, recordId, key),
  );
};

export const buildRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: Set<string>,
  restoredRecordIds: Set<string>,
) => {
  const node = getRenderedNode(record, restoredRecordIds);
  if (!node) {
    return [];
  }

  const rows: TreeRow[] = [];
  pushRows(node, rows, expandedStringifiedPaths, record.id);
  return rows;
};

export const materializeRecord = (record: JsonlRecord, restoredRecordIds: Set<string>) => {
  const node = getRenderedNode(record, restoredRecordIds);
  if (!node) {
    return null;
  }

  return materializeNode(node);
};

const collectPaths = (
  node: JsonNode,
  expandedStringifiedPaths: Set<string>,
  output: Set<string>,
) => {
  const pathText = stringifyPath(node.path);
  if (node.wasStringified) {
    output.add(pathText);
  }

  const expanded = !node.wasStringified || expandedStringifiedPaths.has(pathText);
  if (!node.children || !expanded) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectPaths(child, expandedStringifiedPaths, output));
    return;
  }

  Object.values(node.children).forEach((child) =>
    collectPaths(child, expandedStringifiedPaths, output),
  );
};

export const collectStringifiedPaths = (
  record: JsonlRecord,
  expandedStringifiedPaths: Set<string>,
  restoredRecordIds: Set<string>,
) => {
  const node = getRenderedNode(record, restoredRecordIds);
  if (!node) {
    return [];
  }

  const output = new Set<string>();
  collectPaths(node, expandedStringifiedPaths, output);
  return [...output];
};

export const hasJsonlRecords = (result: ParseResult | null) =>
  Boolean(result && result.format === "jsonl" && result.records.length > 1);
