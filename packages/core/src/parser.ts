import type { JsonNode, JsonlRecord, ParseErrorMeta, ParseOptions, ParseResult } from "./types";
import { DEFAULT_MAX_DEPTH, extractSummary, getJsonKind, parseJson, probeJsonl } from "./utils";

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

export const parseJsonlRecordLine = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): JsonlRecord => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  try {
    return createRecord(parseJson(line), lineNumber, maxDepth);
  } catch (error) {
    const errorMeta = getParseErrorMeta(line, error, lineNumber - 1);
    return {
      id: `record-${lineNumber}`,
      lineNumber,
      node: null,
      error: getErrorMessage(error),
      errorMeta,
      rawLine: line,
      summary: line.slice(0, 72),
    };
  }
};

// Strict pass: every non-empty line must parse, otherwise the whole input is
// not (clean) JSONL. Returns a full result only for >1 records, mirroring the
// auto-detection rule that a single line is treated as plain JSON.
const parseStrictJsonlResult = (input: string, maxDepth: number): ParseResult | null => {
  const records: JsonlRecord[] = [];

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    const record = parseJsonlRecordLine(line, index + 1, { maxDepth });
    if (!record.node) {
      return null;
    }

    records.push(record);
  }

  return records.length > 1 ? buildJsonlResult(records) : null;
};

// Loose pass: keep every line, failed ones become error records.
const parseLooseJsonlRecords = (input: string, maxDepth: number): JsonlRecord[] => {
  const records: JsonlRecord[] = [];

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    records.push(parseJsonlRecordLine(line, index + 1, { maxDepth }));
  }

  return records;
};

const buildJsonlResult = (records: JsonlRecord[]): ParseResult => {
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

const parseSingleJsonResult = (input: string, maxDepth: number): ParseResult => {
  try {
    const parsed = parseJson(input);
    return {
      format: "json",
      records: [createRecord(parsed, 1, maxDepth)],
      stats: { total: 1, success: 1, failed: 0 },
    };
  } catch (error) {
    const errorMeta = getParseErrorMeta(input, error);
    return {
      format: "json",
      records: [
        {
          id: "record-1",
          lineNumber: 1,
          node: null,
          error: getErrorMessage(error),
          errorMeta,
          rawLine: errorMeta.rawLine,
          summary: "Parse error",
        },
      ],
      stats: { total: 1, success: 0, failed: 1 },
    };
  }
};

export const detectFormat = (input: string): "json" | "jsonl" =>
  probeJsonl(input).isLikelyJsonl ? "jsonl" : "json";

export const parseInput = (input: string, options: ParseOptions = {}): ParseResult => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (!input.trim()) {
    return {
      format: options.forcedFormat ?? detectFormat(input),
      records: [],
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  if (options.forcedFormat === "json") {
    return parseSingleJsonResult(input, maxDepth);
  }

  if (options.forcedFormat === "jsonl") {
    return buildJsonlResult(parseLooseJsonlRecords(input, maxDepth));
  }

  // Auto: strict JSONL → single JSON → loose JSONL → the JSON error result.
  const strict = parseStrictJsonlResult(input, maxDepth);
  if (strict) {
    return strict;
  }

  const single = parseSingleJsonResult(input, maxDepth);
  if (single.stats.success > 0) {
    return single;
  }

  const loose = parseLooseJsonlRecords(input, maxDepth);
  if (loose.length > 1 && loose.some((record) => record.node)) {
    return buildJsonlResult(loose);
  }

  return single;
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
  paths.some(
    (candidate) =>
      candidate.length === path.length &&
      candidate.every((segment, index) => segment === path[index]),
  );

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown parse error";

const getMessagePosition = (message: string) => {
  const match = /position\s+(\d+)/i.exec(message);
  return match ? Number(match[1]) : null;
};

const getUnexpectedTokenPosition = (input: string, message: string) => {
  const match = /Unexpected token '([^']+)'/i.exec(message);
  const token = match?.[1];
  if (!token) {
    return null;
  }

  const index = input.indexOf(token);
  return index >= 0 ? index : null;
};

const getMessageLineColumn = (message: string) => {
  const match = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (!match) {
    return null;
  }

  return {
    line: Number(match[1]),
    column: Number(match[2]),
  };
};

const getLineColumnAtPosition = (input: string, position: number) => {
  const safePosition = Math.max(0, Math.min(position, input.length));
  const before = input.slice(0, safePosition);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
};

const contextLineLength = 160;
const contextLineRadius = 80;

const getContextLine = (line: string, column?: number) => {
  if (line.length <= contextLineLength) {
    return { text: line, column };
  }

  if (typeof column !== "number") {
    return { text: `${line.slice(0, contextLineLength - 3)}...`, column };
  }

  const zeroColumn = Math.max(0, column - 1);
  const start = Math.min(
    Math.max(0, zeroColumn - contextLineRadius),
    Math.max(0, line.length - contextLineLength),
  );
  const end = Math.min(line.length, start + contextLineLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";

  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    column: column - start + prefix.length,
  };
};

const getErrorContext = (input: string, line: number, column: number, lineOffset: number) => {
  const lines = input.split(/\r?\n/);
  const start = Math.max(1, line - 1);
  const end = Math.min(lines.length, line + 1);
  const numberWidth = String(end + lineOffset).length;
  const context: string[] = [];

  for (let current = start; current <= end; current += 1) {
    const displayLine = current + lineOffset;
    const snippet = getContextLine(lines[current - 1] ?? "", current === line ? column : undefined);
    context.push(`${String(displayLine).padStart(numberWidth, " ")} | ${snippet.text}`);

    if (current === line) {
      context.push(
        `${" ".repeat(numberWidth)} | ${" ".repeat(Math.max(0, (snippet.column ?? column) - 1))}^`,
      );
    }
  }

  return context.join("\n");
};

const getParseErrorMeta = (input: string, error: unknown, lineOffset = 0): ParseErrorMeta => {
  const message = getErrorMessage(error);
  const position = getMessagePosition(message) ?? getUnexpectedTokenPosition(input, message);
  const lineColumn =
    getMessageLineColumn(message) ?? getLineColumnAtPosition(input, position ?? input.length);
  const rawLine = input.split(/\r?\n/)[lineColumn.line - 1] ?? "";

  return {
    line: lineColumn.line + lineOffset,
    column: lineColumn.column,
    rawLine,
    context: getErrorContext(input, lineColumn.line, lineColumn.column, lineOffset),
  };
};
