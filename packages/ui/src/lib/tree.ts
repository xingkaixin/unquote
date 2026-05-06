import type { JsonNode, JsonlRecord, ParseResult } from "@unquote/core";
import { materializeNode, restoreNode } from "@unquote/core";

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

export type TreePathSegmentKind = "key" | "index";

export interface TreePathSegment {
  kind: TreePathSegmentKind;
  value: string;
}

export type NodeSourceState = "source" | "stringified" | "inside-stringified";

const safeIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const arrayIndexPattern = /^(0|[1-9]\d*)$/;

const quotePathKey = (key: string) => JSON.stringify(key);

export const formatJsonPath = (segments: TreePathSegment[]) =>
  segments.reduce((path, segment) => {
    if (segment.kind === "index") {
      return `${path}[${segment.value}]`;
    }

    if (safeIdentifierPattern.test(segment.value)) {
      return `${path}.${segment.value}`;
    }

    return `${path}[${quotePathKey(segment.value)}]`;
  }, "$");

export const formatJqSelector = (segments: TreePathSegment[]) => {
  if (segments.length === 0) {
    return ".";
  }

  return segments.reduce((path, segment) => {
    if (segment.kind === "index") {
      return `${path}[${segment.value}]`;
    }

    if (safeIdentifierPattern.test(segment.value)) {
      return path === "." ? `${path}${segment.value}` : `${path}.${segment.value}`;
    }

    return `${path}[${quotePathKey(segment.value)}]`;
  }, ".");
};

const parseDoubleQuotedSegment = (selector: string, start: number) => {
  let cursor = start + 1;
  while (cursor < selector.length) {
    const char = selector[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === '"') {
      try {
        const value = JSON.parse(selector.slice(start, cursor + 1));
        return typeof value === "string" ? { value, next: cursor + 1 } : null;
      } catch {
        return null;
      }
    }
    cursor += 1;
  }

  return null;
};

const parseSingleQuotedSegment = (selector: string, start: number) => {
  let cursor = start + 1;
  let value = "";

  while (cursor < selector.length) {
    const char = selector[cursor];
    if (char === "\\") {
      const escaped = selector[cursor + 1];
      if (!escaped) {
        return null;
      }

      const escapeMap: Record<string, string> = {
        "'": "'",
        '"': '"',
        "\\": "\\",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      value += escapeMap[escaped] ?? escaped;
      cursor += 2;
      continue;
    }

    if (char === "'") {
      return { value, next: cursor + 1 };
    }

    value += char;
    cursor += 1;
  }

  return null;
};

const parseBracketSegment = (selector: string, start: number) => {
  const first = selector[start + 1];
  if (first === '"') {
    const parsed = parseDoubleQuotedSegment(selector, start + 1);
    if (!parsed || selector[parsed.next] !== "]") {
      return null;
    }

    return {
      segment: { kind: "key", value: parsed.value } satisfies TreePathSegment,
      next: parsed.next + 1,
    };
  }

  if (first === "'") {
    const parsed = parseSingleQuotedSegment(selector, start + 1);
    if (!parsed || selector[parsed.next] !== "]") {
      return null;
    }

    return {
      segment: { kind: "key", value: parsed.value } satisfies TreePathSegment,
      next: parsed.next + 1,
    };
  }

  const end = selector.indexOf("]", start + 1);
  if (end === -1) {
    return null;
  }

  const value = selector.slice(start + 1, end).trim();
  if (!arrayIndexPattern.test(value)) {
    return null;
  }

  return {
    segment: { kind: "index", value } satisfies TreePathSegment,
    next: end + 1,
  };
};

export const parseTreePath = (selector: string): TreePathSegment[] | null => {
  const input = selector.trim();
  if (!input) {
    return null;
  }

  let index = 0;
  if (input[0] === "$") {
    index = 1;
  } else if (input[0] !== ".") {
    return null;
  } else if (input.length === 1) {
    return [];
  }

  const segments: TreePathSegment[] = [];
  while (index < input.length) {
    const char = input[index];
    if (char === ".") {
      index += 1;
      if (index >= input.length) {
        return null;
      }

      if (input[index] === "[") {
        continue;
      }

      const start = index;
      while (index < input.length && input[index] !== "." && input[index] !== "[") {
        index += 1;
      }

      const value = input.slice(start, index);
      if (!value) {
        return null;
      }

      segments.push({ kind: "key", value });
      continue;
    }

    if (char === "[") {
      const parsed = parseBracketSegment(input, index);
      if (!parsed) {
        return null;
      }

      segments.push(parsed.segment);
      index = parsed.next;
      continue;
    }

    return null;
  }

  return segments;
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
  pathSegments: TreePathSegment[] = [],
  stringifiedAncestors: string[] = [],
  parentKeyLabel = "$",
) => {
  const jsonPath = formatJsonPath(pathSegments);
  const jqPath = formatJqSelector(pathSegments);
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
      pushRows(
        child,
        rows,
        expandedStringifiedPaths,
        recordId,
        [...pathSegments, { kind: "index", value: String(index) }],
        currentChain,
        String(index),
      ),
    );
    return;
  }

  Object.entries(node.children).forEach(([key, child]) =>
    pushRows(
      child,
      rows,
      expandedStringifiedPaths,
      recordId,
      [...pathSegments, { kind: "key", value: key }],
      currentChain,
      key,
    ),
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
  pathSegments: TreePathSegment[] = [],
) => {
  const pathText = formatJsonPath(pathSegments);
  if (node.wasStringified) {
    output.add(pathText);
  }

  const expanded = !node.wasStringified || expandedStringifiedPaths.has(pathText);
  if (!node.children || !expanded) {
    return;
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) =>
      collectPaths(child, expandedStringifiedPaths, output, [
        ...pathSegments,
        { kind: "index", value: String(index) },
      ]),
    );
    return;
  }

  Object.entries(node.children).forEach(([key, child]) =>
    collectPaths(child, expandedStringifiedPaths, output, [
      ...pathSegments,
      { kind: "key", value: key },
    ]),
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
  pathSegments: TreePathSegment[] = [],
) => {
  const pathText = formatJsonPath(pathSegments);
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
    node.children.forEach((child, index) =>
      searchNode(child, recordId, pattern, currentChain, matches, options, [
        ...pathSegments,
        { kind: "index", value: String(index) },
      ]),
    );
    return;
  }

  Object.entries(node.children).forEach(([key, child]) =>
    searchNode(child, recordId, pattern, currentChain, matches, options, [
      ...pathSegments,
      { kind: "key", value: key },
    ]),
  );
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
    if (!record.node) {
      continue;
    }
    searchNode(record.node, record.id, pattern, [], matches, options);
  }

  return matches;
};

export type RecordFilterMode = "all" | "matches" | "errors" | "nested";

export const filterRecords = (
  records: JsonlRecord[],
  mode: RecordFilterMode,
  matches: SearchMatch[] | null,
) => {
  if (mode === "all") {
    return records;
  }

  if (mode === "matches") {
    const matchedRecordIds = new Set(matches?.map((match) => match.recordId) ?? []);
    return records.filter((record) => matchedRecordIds.has(record.id));
  }

  if (mode === "errors") {
    return records.filter((record) => !record.node);
  }

  return records.filter(recordContainsStringifiedJson);
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
