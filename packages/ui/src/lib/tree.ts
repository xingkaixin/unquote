import type { JsonNode, JsonlRecord, ParseResult } from "@unquote/core";
import { hasJsonNodeChildren, isParsed, isStringifiedNode, materializeNode } from "@unquote/core";
import { getPreviewNestedFieldKeys, getPreviewPath } from "./record-preview";
import { formatJsonPath, formatJqSelector, parseTreePath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";
import { formatJsonValueLabel, walkJsonNode, walkRawJsonValue } from "./json-walk";
import type { JsonValueWalkContext } from "./json-walk";
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

interface FocusedTreeRows {
  rows: TreeRow[];
  focus: ResolvedTreePath;
}

type NodeSourceState = "source" | "stringified" | "inside-stringified";

const maxStringValueLabelLength = 512;

const pushRows = (
  node: JsonNode,
  rows: TreeRow[],
  expandedStringifiedPaths: ReadonlySet<string>,
  recordId: string,
  jsonPath = "$",
  jqPath = ".",
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
        jqPath: ctx.jqPath,
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
    { jsonPath, jqPath, stringifiedAncestors },
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
    resolved.target.jqPath,
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
  // JSON — the same source recordContainsStringifiedJson reads. Deeper levels
  // surface once the record hydrates and the walk below takes over.
  if (record.status === "preview" && record.preview) {
    return getPreviewNestedFieldKeys(record.preview).map(getPreviewPath);
  }

  if (!isParsed(record)) {
    return [];
  }

  const output = new Set<string>();
  collectPaths(record.node, expandedStringifiedPaths, output);
  return [...output];
};

const containsStringifiedNode = (node: JsonNode): boolean => {
  if (isStringifiedNode(node)) {
    return true;
  }

  if (!hasJsonNodeChildren(node)) {
    return false;
  }

  return Array.isArray(node.children)
    ? node.children.some(containsStringifiedNode)
    : Object.values(node.children).some(containsStringifiedNode);
};

const recordContainsStringifiedJson = (record: JsonlRecord) =>
  record.status === "preview" && record.preview
    ? getPreviewNestedFieldKeys(record.preview).length > 0
    : isParsed(record) && containsStringifiedNode(record.node);

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
  walkJsonNode(node, (ctx) => addSearchMatch(ctx, recordId, pattern, options, matches), {
    jsonPath: pathText,
    stringifiedAncestors,
  });
};

const addSearchMatch = (
  context: JsonValueWalkContext<unknown>,
  recordId: string,
  pattern: RegExp,
  options: SearchOptions,
  matches: SearchMatch[],
) => {
  const keyLabel = context.pathSegments.at(-1)?.value ?? "$";
  const valueLabel = formatJsonValueLabel(context);
  const keyRanges = findRanges(keyLabel, pattern);
  const valueRanges = findRanges(valueLabel, pattern);
  const pathRanges = options.jq ? findRanges(context.jsonPath, pattern) : [];

  if (keyRanges.length > 0 || valueRanges.length > 0 || pathRanges.length > 0) {
    matches.push({
      recordId,
      pathText: context.jsonPath,
      keyRanges,
      valueRanges,
      pathRanges,
      stringifiedPathChain: [...context.stringifiedChain],
    });
  }
};

export const searchJsonValue = (
  value: unknown,
  recordId: string,
  pattern: RegExp,
  options: SearchOptions,
): SearchMatch[] => {
  const matches: SearchMatch[] = [];
  walkRawJsonValue(value, (ctx) => addSearchMatch(ctx, recordId, pattern, options, matches));
  return matches;
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
    for (const match of searchRecord(record, pattern, options)) {
      matches.push(match);
    }
  }

  return matches;
};

const searchRecord = (
  record: JsonlRecord,
  pattern: RegExp,
  options: SearchOptions,
): SearchMatch[] => {
  if (!isParsed(record)) {
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
      (record) => !isParsed(record) || insights.get(record.id)?.kind === "error",
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
  const sourceState: NodeSourceState = isStringifiedNode(node)
    ? "stringified"
    : stringifiedPathChain.length > 0
      ? "inside-stringified"
      : "source";
  const path = ["$", ...pathSegments.map((segment) => segment.value)];

  return {
    recordId: record.id,
    recordLine: record.lineNumber,
    node,
    path,
    pathText: jsonPath,
    jsonPath,
    jqPath,
    rawKey: pathSegments.at(-1)?.value ?? "$",
    kind: node.kind,
    sourceState,
    stringifiedPathChain: [...stringifiedPathChain],
    sourceLine: record.lineNumber,
  };
};

const resolvePathInRecord = (
  record: JsonlRecord,
  requestedSegments: TreePathSegment[],
): ResolvedTreePath | null => {
  if (!isParsed(record)) {
    return null;
  }

  let node = record.node;
  const actualSegments: TreePathSegment[] = [];
  let stringifiedPathChain = isStringifiedNode(node) ? [formatJsonPath(actualSegments)] : [];

  for (const requested of requestedSegments) {
    if (!hasJsonNodeChildren(node)) {
      return null;
    }

    if (node.kind === "array") {
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

    if (isStringifiedNode(node)) {
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
