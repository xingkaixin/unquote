import type { JsonNode, JsonlRecord, ParseResult } from "@unquote/core";
import { materializeNode } from "@unquote/core";
import {
  appendJsonPathSegment,
  appendJqSelectorSegment,
  formatJsonPath,
  formatJqSelector,
  parseTreePath,
} from "./path-codec";
import type { TreePathSegment } from "./path-codec";
import type { RecordInsight } from "./record-insight";

export interface TreeRow {
  id: string;
  recordId: string;
  path: string[];
  pathText: string;
  jsonPath: string;
  jqPath: string;
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

export interface FocusedTreeRows {
  rows: TreeRow[];
  focus: ResolvedTreePath;
}

export type NodeSourceState = "source" | "stringified" | "inside-stringified";

const maxStringValueLabelLength = 512;

const formatStringLabel = (
  value: string,
  maxLength = Number.POSITIVE_INFINITY,
  originalLength = value.length,
) => {
  if (value.length <= maxLength && value.length === originalLength) {
    return JSON.stringify(value);
  }

  return `${JSON.stringify(`${value.slice(0, maxLength)}...`)} (${originalLength} chars)`;
};

const formatValueLabel = (node: JsonNode, maxStringLength?: number) => {
  switch (node.kind) {
    case "object":
      return `{${Object.keys((node.children as Record<string, JsonNode>) ?? {}).length}}`;
    case "array":
      return `[${(node.children as JsonNode[] | undefined)?.length ?? 0}]`;
    case "string":
      return formatStringLabel(
        node.value as string,
        maxStringLength,
        node.meta.valueLength ?? (node.value as string).length,
      );
    case "null":
      return "null";
    default:
      return String(node.value);
  }
};

export const getRenderedNode = (record: JsonlRecord) => record.node;

export const getRenderedRecord = (record: JsonlRecord): JsonlRecord => record;

const pushRows = (
  node: JsonNode,
  rows: TreeRow[],
  expandedStringifiedPaths: Set<string>,
  recordId: string,
  jsonPath = "$",
  jqPath = ".",
  stringifiedAncestors: string[] = [],
  parentKeyLabel = "$",
  depthOffset = 0,
) => {
  const currentChain = node.wasStringified
    ? [...stringifiedAncestors, jsonPath]
    : stringifiedAncestors;
  const sourceState: NodeSourceState = node.wasStringified
    ? "stringified"
    : stringifiedAncestors.length > 0
      ? "inside-stringified"
      : "source";
  const expanded = !node.wasStringified || expandedStringifiedPaths.has(jsonPath);
  const keyLabel = node.path.at(-1) ?? parentKeyLabel;
  rows.push({
    id: `${recordId}:${jsonPath}`,
    recordId,
    path: node.path,
    pathText: jsonPath,
    jsonPath,
    jqPath,
    stringifiedPathChain: [...currentChain],
    sourceState,
    depth: Math.max(0, node.path.length - 1 - depthOffset),
    keyLabel,
    kind: node.kind,
    valueLabel: formatValueLabel(node, maxStringValueLabelLength),
    wasStringified: node.wasStringified,
    expandable: Boolean(node.children),
    expanded,
    node,
  });

  if (!node.children || !expanded) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => {
      const childSegment = { kind: "index", value: String(index) } satisfies TreePathSegment;
      pushRows(
        child,
        rows,
        expandedStringifiedPaths,
        recordId,
        appendJsonPathSegment(jsonPath, childSegment),
        appendJqSelectorSegment(jqPath, childSegment),
        currentChain,
        String(index),
        depthOffset,
      );
    });
    return;
  }

  Object.entries(node.children).forEach(([key, child]) => {
    const childSegment = { kind: "key", value: key } satisfies TreePathSegment;
    pushRows(
      child,
      rows,
      expandedStringifiedPaths,
      recordId,
      appendJsonPathSegment(jsonPath, childSegment),
      appendJqSelectorSegment(jqPath, childSegment),
      currentChain,
      key,
      depthOffset,
    );
  });
};

export const buildRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: Set<string>,
  focusedPath?: string | null,
) => {
  const renderedRecord = getRenderedRecord(record);
  if (!renderedRecord.node) {
    return [];
  }

  if (focusedPath) {
    const focused = buildFocusedRecordRows(renderedRecord, expandedStringifiedPaths, focusedPath);
    if (focused) {
      return focused.rows;
    }
  }

  const rows: TreeRow[] = [];
  pushRows(renderedRecord.node, rows, expandedStringifiedPaths, record.id);
  return rows;
};

export const buildFocusedRecordRows = (
  record: JsonlRecord,
  expandedStringifiedPaths: Set<string>,
  focusedPath: string,
): FocusedTreeRows | null => {
  const resolved = resolveTreePath([record], focusedPath);
  if (!resolved.ok) {
    return null;
  }

  const rows: TreeRow[] = [];
  const stringifiedAncestors = resolved.target.node.wasStringified
    ? resolved.target.stringifiedPathChain.slice(0, -1)
    : resolved.target.stringifiedPathChain;
  pushRows(
    resolved.target.node,
    rows,
    expandedStringifiedPaths,
    record.id,
    resolved.target.jsonPath,
    resolved.target.jqPath,
    stringifiedAncestors,
    resolved.target.rawKey,
    Math.max(0, resolved.target.node.path.length - 1),
  );

  return { rows, focus: resolved.target };
};

export const materializeRecord = (record: JsonlRecord) => {
  const node = getRenderedNode(record);
  if (!node) {
    return null;
  }

  return materializeNode(node);
};

const collectPaths = (
  node: JsonNode,
  expandedStringifiedPaths: Set<string>,
  output: Set<string>,
  pathText = "$",
) => {
  if (node.wasStringified) {
    output.add(pathText);
  }

  const expanded = !node.wasStringified || expandedStringifiedPaths.has(pathText);
  if (!node.children || !expanded) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => {
      const childSegment = { kind: "index", value: String(index) } satisfies TreePathSegment;
      collectPaths(
        child,
        expandedStringifiedPaths,
        output,
        appendJsonPathSegment(pathText, childSegment),
      );
    });
    return;
  }

  Object.entries(node.children).forEach(([key, child]) => {
    const childSegment = { kind: "key", value: key } satisfies TreePathSegment;
    collectPaths(
      child,
      expandedStringifiedPaths,
      output,
      appendJsonPathSegment(pathText, childSegment),
    );
  });
};

export const collectStringifiedPaths = (
  record: JsonlRecord,
  expandedStringifiedPaths: Set<string>,
) => {
  const node = getRenderedNode(record);
  if (!node) {
    return [];
  }

  const output = new Set<string>();
  collectPaths(node, expandedStringifiedPaths, output);
  return [...output];
};

const containsStringifiedNode = (node: JsonNode): boolean => {
  if (node.wasStringified) {
    return true;
  }

  if (!node.children) {
    return false;
  }

  return Array.isArray(node.children)
    ? node.children.some(containsStringifiedNode)
    : Object.values(node.children).some(containsStringifiedNode);
};

export const recordContainsStringifiedJson = (record: JsonlRecord) =>
  Boolean(record.node && containsStringifiedNode(record.node));

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchMatch {
  recordId: string;
  pathText: string;
  keyRanges: TextRange[];
  valueRanges: TextRange[];
  pathRanges: TextRange[];
  stringifiedPathChain: string[];
}

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  jq: boolean;
}

const findRanges = (text: string, pattern: RegExp): TextRange[] => {
  const ranges: TextRange[] = [];
  const clone = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = clone.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    if (match[0].length === 0) {
      clone.lastIndex++;
    }
  }
  return ranges;
};

const searchNode = (
  node: JsonNode,
  recordId: string,
  pattern: RegExp,
  stringifiedAncestors: string[],
  matches: SearchMatch[],
  options: SearchOptions,
  pathText = "$",
) => {
  const currentChain = node.wasStringified
    ? [...stringifiedAncestors, pathText]
    : stringifiedAncestors;

  const keyLabel = node.path.at(-1) ?? "$";
  const valueLabel = formatValueLabel(node);

  const keyRanges = findRanges(keyLabel, pattern);
  const valueRanges = findRanges(valueLabel, pattern);
  const pathRanges = options.jq ? findRanges(pathText, pattern) : [];

  if (keyRanges.length > 0 || valueRanges.length > 0 || pathRanges.length > 0) {
    matches.push({
      recordId,
      pathText,
      keyRanges,
      valueRanges,
      pathRanges,
      stringifiedPathChain: [...currentChain],
    });
  }

  if (!node.children) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => {
      const childSegment = { kind: "index", value: String(index) } satisfies TreePathSegment;
      searchNode(
        child,
        recordId,
        pattern,
        currentChain,
        matches,
        options,
        appendJsonPathSegment(pathText, childSegment),
      );
    });
    return;
  }

  Object.entries(node.children).forEach(([key, child]) => {
    const childSegment = { kind: "key", value: key } satisfies TreePathSegment;
    searchNode(
      child,
      recordId,
      pattern,
      currentChain,
      matches,
      options,
      appendJsonPathSegment(pathText, childSegment),
    );
  });
};

export const buildSearchPattern = (query: string, options: SearchOptions): RegExp | null => {
  if (!query) {
    return null;
  }

  const flags = options.caseSensitive ? "g" : "gi";

  if (options.regex) {
    try {
      return new RegExp(query, flags);
    } catch {
      return null;
    }
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, flags);
};

export const searchRecords = (
  records: JsonlRecord[],
  query: string,
  options: SearchOptions,
): SearchMatch[] | null => {
  const pattern = buildSearchPattern(query, options);
  if (!pattern) {
    return null;
  }

  const matches: SearchMatch[] = [];
  for (const record of records) {
    matches.push(...searchRecord(record, pattern, options));
  }

  return matches;
};

export const searchRecord = (
  record: JsonlRecord,
  pattern: RegExp,
  options: SearchOptions,
): SearchMatch[] => {
  if (!record.node) {
    return [];
  }

  const matches: SearchMatch[] = [];
  searchNode(record.node, record.id, pattern, [], matches, options);
  return matches;
};

export type RecordFilterMode =
  | "all"
  | "matches"
  | "errors"
  | "nested"
  | "tool"
  | "message"
  | "events";

export const filterRecords = (
  records: JsonlRecord[],
  mode: RecordFilterMode,
  matches: SearchMatch[] | null,
  insights: ReadonlyMap<string, RecordInsight> = new Map(),
) => {
  if (mode === "all") {
    return records;
  }

  if (mode === "matches") {
    const matchedRecordIds = new Set(matches?.map((match) => match.recordId) ?? []);
    return records.filter((record) => matchedRecordIds.has(record.id));
  }

  if (mode === "errors") {
    return records.filter(
      (record) => (!record.node && !record.deferred) || insights.get(record.id)?.kind === "error",
    );
  }

  if (mode === "nested") {
    return records.filter(recordContainsStringifiedJson);
  }

  if (mode === "tool") {
    return records.filter((record) => insights.get(record.id)?.kind === "tool");
  }

  if (mode === "message") {
    return records.filter((record) => insights.get(record.id)?.kind === "message");
  }

  if (mode === "events") {
    return records.filter((record) => insights.get(record.id)?.kind === "event");
  }

  return records;
};

export interface ResolvedTreePath {
  recordId: string;
  recordLine: number;
  node: JsonNode;
  path: string[];
  pathText: string;
  jsonPath: string;
  jqPath: string;
  rawKey: string;
  kind: JsonNode["kind"];
  sourceState: NodeSourceState;
  stringifiedPathChain: string[];
  sourceLine?: number;
}

export type ResolveTreePathResult =
  | { ok: true; target: ResolvedTreePath }
  | { ok: false; reason: "invalid" | "not-found" };

export type ResolveTreePathMatchesResult =
  | { ok: true; targets: ResolvedTreePath[] }
  | { ok: false; reason: "invalid" | "not-found" };

const getRecordSearchOrder = (records: JsonlRecord[], preferredRecordId?: string) => {
  if (!preferredRecordId) {
    return records;
  }

  const preferred = records.filter((record) => record.id === preferredRecordId);
  return preferred.concat(records.filter((record) => record.id !== preferredRecordId));
};

const createResolvedTreePath = (
  record: JsonlRecord,
  node: JsonNode,
  pathSegments: TreePathSegment[],
  stringifiedPathChain: string[],
): ResolvedTreePath => {
  const jsonPath = formatJsonPath(pathSegments);
  const jqPath = formatJqSelector(pathSegments);
  const sourceState: NodeSourceState = node.wasStringified
    ? "stringified"
    : stringifiedPathChain.length > 0
      ? "inside-stringified"
      : "source";
  const sourceLine = node.meta.sourceLine;

  return {
    recordId: record.id,
    recordLine: record.lineNumber,
    node,
    path: node.path,
    pathText: jsonPath,
    jsonPath,
    jqPath,
    rawKey: pathSegments.at(-1)?.value ?? "$",
    kind: node.kind,
    sourceState,
    stringifiedPathChain: [...stringifiedPathChain],
    ...(typeof sourceLine === "number" ? { sourceLine } : {}),
  };
};

const resolvePathInRecord = (
  record: JsonlRecord,
  requestedSegments: TreePathSegment[],
): ResolvedTreePath | null => {
  if (!record.node) {
    return null;
  }

  let node = record.node;
  const actualSegments: TreePathSegment[] = [];
  let stringifiedPathChain = node.wasStringified ? [formatJsonPath(actualSegments)] : [];

  for (const requested of requestedSegments) {
    if (!node.children) {
      return null;
    }

    if (Array.isArray(node.children)) {
      if (requested.kind !== "index") {
        return null;
      }

      const index = Number(requested.value);
      if (!Number.isSafeInteger(index)) {
        return null;
      }

      const child = node.children[index];
      if (!child) {
        return null;
      }

      node = child;
      actualSegments.push({ kind: "index", value: String(index) });
    } else {
      if (requested.kind !== "key") {
        return null;
      }

      const child = node.children[requested.value];
      if (!child) {
        return null;
      }

      node = child;
      actualSegments.push({ kind: "key", value: requested.value });
    }

    if (node.wasStringified) {
      stringifiedPathChain = [...stringifiedPathChain, formatJsonPath(actualSegments)];
    }
  }

  return createResolvedTreePath(record, node, actualSegments, stringifiedPathChain);
};

export const resolveTreePath = (
  records: JsonlRecord[],
  selector: string,
  preferredRecordId?: string,
): ResolveTreePathResult => {
  const requestedSegments = parseTreePath(selector);
  if (!requestedSegments) {
    return { ok: false, reason: "invalid" };
  }

  for (const record of getRecordSearchOrder(records, preferredRecordId)) {
    const target = resolvePathInRecord(record, requestedSegments);
    if (target) {
      return { ok: true, target };
    }
  }

  return { ok: false, reason: "not-found" };
};

export const resolveTreePathMatches = (
  records: JsonlRecord[],
  selector: string,
): ResolveTreePathMatchesResult => {
  const requestedSegments = parseTreePath(selector);
  if (!requestedSegments) {
    return { ok: false, reason: "invalid" };
  }

  const targets: ResolvedTreePath[] = [];
  for (const record of records) {
    const target = resolvePathInRecord(record, requestedSegments);
    if (target) {
      targets.push(target);
    }
  }

  return targets.length > 0 ? { ok: true, targets } : { ok: false, reason: "not-found" };
};

export const hasJsonlRecords = (result: ParseResult | null) =>
  Boolean(result && result.format === "jsonl" && result.records.length > 1);
