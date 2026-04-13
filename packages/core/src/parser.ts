import type { JsonNode, JsonlRecord, ParseOptions, ParseResult } from "./types";
import { DEFAULT_MAX_DEPTH, extractSummary, getJsonKind, isLikelyJsonl, parseJson } from "./utils";

const toNode = (
  value: unknown,
  path: string[],
  depth: number,
  maxDepth: number,
  wasStringified = false,
  rawString?: string,
  recordId?: string,
  sourceLine?: number,
): JsonNode => {
  const kind = getJsonKind(value);
  const meta = {
    depth,
    expandable: false,
    restorable: wasStringified,
    ...(recordId ? { recordId } : {}),
    ...(typeof sourceLine === "number" ? { sourceLine } : {}),
  };

  if (kind === "object") {
    const objectValue = value as Record<string, unknown>;
    const children = Object.fromEntries(
      Object.entries(objectValue).map(([key, childValue]) => [
        key,
        buildNode(childValue, [...path, key], depth + 1, maxDepth, recordId, sourceLine),
      ]),
    );

    return {
      kind,
      value,
      path,
      wasStringified,
      ...(rawString ? { rawString } : {}),
      children,
      meta: { ...meta, expandable: true },
    };
  }

  if (kind === "array") {
    const arrayValue = value as unknown[];
    const children = arrayValue.map((childValue, index) =>
      buildNode(childValue, [...path, String(index)], depth + 1, maxDepth, recordId, sourceLine),
    );

    return {
      kind,
      value,
      path,
      wasStringified,
      ...(rawString ? { rawString } : {}),
      children,
      meta: { ...meta, expandable: true },
    };
  }

  return {
    kind,
    value,
    path,
    wasStringified,
    ...(rawString ? { rawString } : {}),
    meta,
  };
};

const maybeExpandString = (
  value: string,
  path: string[],
  depth: number,
  maxDepth: number,
  recordId?: string,
  sourceLine?: number,
) => {
  if (depth > maxDepth) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = parseJson(trimmed);
    return toNode(parsed, path, depth, maxDepth, true, value, recordId, sourceLine);
  } catch {
    return null;
  }
};

export const buildNode = (
  value: unknown,
  path: string[],
  depth: number,
  maxDepth: number,
  recordId?: string,
  sourceLine?: number,
): JsonNode => {
  if (typeof value === "string") {
    const expanded = maybeExpandString(value, path, depth, maxDepth, recordId, sourceLine);
    if (expanded) {
      return expanded;
    }
  }

  return toNode(value, path, depth, maxDepth, false, undefined, recordId, sourceLine);
};

const createRecord = (value: unknown, lineNumber: number, maxDepth: number): JsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = buildNode(value, ["$"], 0, maxDepth, id, lineNumber);

  return {
    id,
    lineNumber,
    node,
    summary: extractSummary(value),
  };
};

const parseJsonlRecords = (input: string, maxDepth: number, strict = false) => {
  const records: JsonlRecord[] = [];

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(createRecord(parseJson(line), index + 1, maxDepth));
    } catch (error) {
      if (strict) {
        return null;
      }

      records.push({
        id: `record-${index + 1}`,
        lineNumber: index + 1,
        node: null,
        error: getErrorMessage(error),
        summary: line.slice(0, 72),
      });
    }
  }

  return records;
};

export const detectFormat = (input: string): "json" | "jsonl" => {
  if (isLikelyJsonl(input)) {
    return "jsonl";
  }

  return "json";
};

export const parseInput = (input: string, options: ParseOptions = {}): ParseResult => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const normalized = input.trim();
  const format = options.forcedFormat ?? "json";

  if (!normalized) {
    return {
      format: options.forcedFormat ?? detectFormat(input),
      records: [],
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  if (!options.forcedFormat) {
    const jsonlRecords = parseJsonlRecords(input, maxDepth, true);
    if (jsonlRecords && jsonlRecords.length > 1) {
      return {
        format: "jsonl",
        records: jsonlRecords,
        stats: { total: jsonlRecords.length, success: jsonlRecords.length, failed: 0 },
      };
    }
  }

  if (format === "json" || !options.forcedFormat) {
    try {
      const parsed = parseJson(input);
      return {
        format: "json",
        records: [createRecord(parsed, 1, maxDepth)],
        stats: { total: 1, success: 1, failed: 0 },
      };
    } catch (error) {
      return {
        format,
        records: [
          {
            id: "record-1",
            lineNumber: 1,
            node: null,
            error: getErrorMessage(error),
            summary: "Parse error",
          },
        ],
        stats: { total: 1, success: 0, failed: 1 },
      };
    }
  }

  const records = parseJsonlRecords(input, maxDepth) ?? [];
  const success = records.filter((record) => record.node).length;
  return {
    format: "jsonl",
    records,
    stats: {
      total: records.length,
      success,
      failed: records.length - success,
    },
  };
};

export const restoreNode = (node: JsonNode, paths?: string[][]): JsonNode => {
  const shouldRestore = node.wasStringified && (!paths || matchesPath(node.path, paths));

  if (shouldRestore) {
    return toNode(
      node.rawString ?? JSON.stringify(node.value),
      node.path,
      node.meta.depth,
      DEFAULT_MAX_DEPTH,
    );
  }

  if (node.kind === "object" && node.children && !Array.isArray(node.children)) {
    const children = Object.fromEntries(
      Object.entries(node.children).map(([key, child]) => [key, restoreNode(child, paths)]),
    );
    return { ...node, children };
  }

  if (node.kind === "array" && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map((child) => restoreNode(child, paths)),
    };
  }

  return node;
};

export const expandNode = (node: JsonNode, options: ParseOptions = {}) => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  return buildNode(
    node.value,
    node.path,
    node.meta.depth,
    maxDepth,
    node.meta.recordId,
    node.meta.sourceLine,
  );
};

export const formatResult = (result: ParseResult, options: { indent?: number } = {}) => {
  const indent = options.indent ?? 2;
  if (result.format === "json") {
    const record = result.records[0];
    return JSON.stringify(record?.node ? materializeNode(record.node) : null, null, indent);
  }

  return result.records
    .map((record) => {
      if (!record.node) {
        return `/* line ${record.lineNumber}: ${record.error ?? "Parse error"} */`;
      }

      return JSON.stringify(materializeNode(record.node), null, indent);
    })
    .join("\n");
};

export const materializeNode = (node: JsonNode): unknown => {
  if (node.kind === "object" && node.children && !Array.isArray(node.children)) {
    return Object.fromEntries(
      Object.entries(node.children).map(([key, child]) => [key, materializeNode(child)]),
    );
  }

  if (node.kind === "array" && Array.isArray(node.children)) {
    return node.children.map((child) => materializeNode(child));
  }

  return node.value;
};

const matchesPath = (path: string[], paths: string[][]) =>
  paths.some((candidate) => candidate.join(".") === path.join("."));

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown parse error";
