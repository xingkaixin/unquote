import type {
  FormatOptions,
  FailedJsonlRecord,
  FullJsonNode,
  FullJsonlRecord,
  JsonNode,
  JsonlRecord,
  JsonlRecordPreview,
  JsonPrimitive,
  ParseErrorMeta,
  ParseOptions,
  ParseResult,
  PreviewJsonlRecord,
  PreviewJsonNode,
} from "./types.js";
import { isFailedRecord, isParsed } from "./records.js";
import { DEFAULT_MAX_DEPTH, extractSummary, getJsonKind, parseJson, probeJsonl } from "./utils.js";

const maxPreviewStringLength = 160;

const toNode = (
  value: unknown,
  depth: number,
  maxDepth: number,
  rawString?: string,
): FullJsonNode => {
  const source = rawString === undefined ? {} : { rawString };

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    if (depth >= maxDepth) {
      return {
        kind: "object",
        value: objectValue,
        truncated: true,
        ...source,
      };
    }

    const children = Object.fromEntries(
      Object.entries(objectValue).map(([key, childValue]) => [
        key,
        buildNode(childValue, depth + 1, maxDepth),
      ]),
    );

    return {
      kind: "object",
      children,
      ...source,
    };
  }

  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      return {
        kind: "array",
        value,
        truncated: true,
        ...source,
      };
    }

    const children = value.map((childValue) => buildNode(childValue, depth + 1, maxDepth));

    return {
      kind: "array",
      children,
      ...source,
    };
  }

  if (value === null) {
    return { kind: "null", value, ...source };
  }
  if (typeof value === "string") {
    return { kind: "string", value, ...source };
  }
  if (typeof value === "number") {
    return { kind: "number", value, ...source };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value, ...source };
  }

  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
};

const maybeExpandString = (value: string, depth: number, maxDepth: number) => {
  if (depth > maxDepth) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = parseJson(trimmed);
    return toNode(parsed, depth, maxDepth, value);
  } catch {
    return null;
  }
};

const buildNode = (value: unknown, depth: number, maxDepth: number): FullJsonNode => {
  if (typeof value === "string") {
    const expanded = maybeExpandString(value, depth, maxDepth);
    if (expanded) {
      return expanded;
    }
  }

  return toNode(value, depth, maxDepth);
};

const createRecord = (value: unknown, lineNumber: number, maxDepth: number): FullJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = buildNode(value, 0, maxDepth);

  return {
    status: "full",
    id,
    lineNumber,
    node,
    summary: extractSummary(value),
  };
};

const appendNestedFieldKey = (nestedFieldKeys: string | string[] | undefined, key: string) => {
  if (!nestedFieldKeys) {
    return key;
  }

  return Array.isArray(nestedFieldKeys) ? [...nestedFieldKeys, key] : [nestedFieldKeys, key];
};

const truncatePreviewString = (value: string) =>
  value.length > maxPreviewStringLength ? value.slice(0, maxPreviewStringLength) : value;

const projectPreviewNode = (node: FullJsonNode): PreviewJsonNode => {
  if (node.rawString !== undefined) {
    const valueLength = node.rawString.length;
    return {
      kind: "string",
      value: truncatePreviewString(node.rawString),
      stringifiedPreview: true,
      ...(valueLength > maxPreviewStringLength ? { valueLength } : {}),
    };
  }

  if (node.kind === "object") {
    const childCount =
      node.children === undefined
        ? Object.keys(node.value).length
        : Object.keys(node.children).length;
    return { kind: "object", childCount, preview: true };
  }

  if (node.kind === "array") {
    const childCount = node.children === undefined ? node.value.length : node.children.length;
    return { kind: "array", childCount, preview: true };
  }

  if (node.kind === "string") {
    const valueLength = node.value.length;
    return {
      kind: "string",
      value: truncatePreviewString(node.value),
      ...(valueLength > maxPreviewStringLength ? { valueLength } : {}),
    };
  }

  return node;
};

const createRecordPreview = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const fields: JsonlRecordPreview["fields"] = {};
  const containers: NonNullable<JsonlRecordPreview["containers"]> = {};
  let nestedFieldKeys: string | string[] | undefined;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const kind = getJsonKind(child);
    if (kind === "object" || kind === "array") {
      containers[key] = kind;
      continue;
    }

    fields[key] =
      typeof child === "string" ? truncatePreviewString(child) : (child as JsonPrimitive);
    if (typeof child === "string" && buildNode(child, 1, 1).rawString !== undefined) {
      nestedFieldKeys = appendNestedFieldKey(nestedFieldKeys, key);
    }
  }

  if (Object.keys(fields).length === 0 && Object.keys(containers).length === 0) {
    return undefined;
  }

  return {
    fields,
    ...(Object.keys(containers).length > 0 ? { containers } : {}),
    ...(nestedFieldKeys ? { nestedFieldKeys } : {}),
  };
};

const createPreviewRecord = (value: unknown, lineNumber: number): PreviewJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = projectPreviewNode(buildNode(value, 0, 0));
  const preview = createRecordPreview(value);

  return {
    status: "preview",
    id,
    lineNumber,
    node,
    ...(preview ? { preview } : {}),
    summary: extractSummary(value),
  };
};

const createParseErrorRecord = (
  line: string,
  lineNumber: number,
  error: unknown,
): FailedJsonlRecord => {
  const errorMeta = getParseErrorMeta(line, error, lineNumber - 1);
  return {
    status: "failed",
    id: `record-${lineNumber}`,
    lineNumber,
    node: null,
    error: getErrorMessage(error),
    errorMeta,
    rawLine: line,
    summary: line.slice(0, 72),
  };
};

type JsonlRecordLineResult<T extends FullJsonlRecord | PreviewJsonlRecord> =
  | { record: T; value: unknown }
  | { record: FailedJsonlRecord };

const parseJsonlRecordLineWith = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  line: string,
  lineNumber: number,
  createParsedRecord: (value: unknown) => T,
): JsonlRecordLineResult<T> => {
  try {
    const value = parseJson(line);
    return { record: createParsedRecord(value), value };
  } catch (error) {
    return { record: createParseErrorRecord(line, lineNumber, error) };
  }
};

export const parseJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): JsonlRecordLineResult<FullJsonlRecord> => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  return parseJsonlRecordLineWith(line, lineNumber, (value) =>
    createRecord(value, lineNumber, maxDepth),
  );
};

export const parseJsonlRecordLine = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): FullJsonlRecord | FailedJsonlRecord =>
  parseJsonlRecordLineWithValue(line, lineNumber, options).record;

export const parsePreviewJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
): JsonlRecordLineResult<PreviewJsonlRecord> =>
  parseJsonlRecordLineWith(line, lineNumber, (value) => createPreviewRecord(value, lineNumber));

export const parsePreviewJsonlRecordLine = (
  line: string,
  lineNumber: number,
): PreviewJsonlRecord | FailedJsonlRecord =>
  parsePreviewJsonlRecordLineWithValue(line, lineNumber).record;

/** @deprecated Use parsePreviewJsonlRecordLine. */
export const parseDeferredJsonlRecordLine = parsePreviewJsonlRecordLine;

type StrictJsonlAttempt =
  | { kind: "complete"; records: JsonlRecord[]; nextLineIndex: number }
  | { kind: "failed"; records: JsonlRecord[]; nextLineIndex: number };

// Strict pass: every non-empty line must parse, otherwise the input is not
// clean JSONL. Preserve the parsed prefix so loose fallback can resume without
// rebuilding records.
const parseStrictJsonlRecords = (lines: string[], maxDepth: number): StrictJsonlAttempt => {
  const records: JsonlRecord[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }

    const record = parseJsonlRecordLine(line, index + 1, { maxDepth });
    records.push(record);

    if (isFailedRecord(record)) {
      return { kind: "failed", records, nextLineIndex: index + 1 };
    }
  }

  return { kind: "complete", records, nextLineIndex: lines.length };
};

// Loose pass: keep every line, failed ones become error records.
const parseLooseJsonlRecords = (
  lines: string[],
  maxDepth: number,
  progress?: StrictJsonlAttempt,
): JsonlRecord[] => {
  const records = progress?.records ?? [];
  const startIndex = progress?.nextLineIndex ?? 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.trim()) {
      continue;
    }

    records.push(parseJsonlRecordLine(line, index + 1, { maxDepth }));
  }

  return records;
};

const buildJsonlResult = (records: JsonlRecord[]): ParseResult => {
  const success = records.filter(isParsed).length;
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
          status: "failed",
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

const detectFormat = (input: string): "json" | "jsonl" =>
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
    return buildJsonlResult(parseLooseJsonlRecords(input.split(/\r?\n/), maxDepth));
  }

  // Auto: strict JSONL → single JSON → loose JSONL → the JSON error result.
  const lines = input.split(/\r?\n/);
  const strict = parseStrictJsonlRecords(lines, maxDepth);
  if (strict.kind === "complete" && strict.records.length > 1) {
    return buildJsonlResult(strict.records);
  }

  const single = parseSingleJsonResult(input, maxDepth);
  if (single.stats.success > 0) {
    return single;
  }

  const loose = parseLooseJsonlRecords(lines, maxDepth, strict);
  if (loose.length > 1 && loose.some(isParsed)) {
    return buildJsonlResult(loose);
  }

  return single;
};

const restoreNodeAtPath = (
  node: JsonNode,
  paths: string[][] | undefined,
  path: string[],
): JsonNode => {
  const rawString = node.rawString;
  const shouldRestore = rawString !== undefined && (!paths || matchesPath(path, paths));

  if (shouldRestore) {
    return {
      kind: "string",
      value: rawString,
    };
  }

  if (node.kind === "object" && node.children) {
    const children = Object.fromEntries(
      Object.entries(node.children).map(([key, child]) => [
        key,
        restoreNodeAtPath(child, paths, [...path, key]),
      ]),
    );
    return { ...node, children };
  }

  if (node.kind === "array" && node.children) {
    return {
      ...node,
      children: node.children.map((child, index) =>
        restoreNodeAtPath(child, paths, [...path, String(index)]),
      ),
    };
  }

  return node;
};

export const restoreNode = (node: JsonNode, paths?: string[][]): JsonNode =>
  restoreNodeAtPath(node, paths, ["$"]);

export const formatResult = (result: ParseResult, options: FormatOptions = {}) => {
  const indent = options.indent ?? 2;
  if (result.format === "json") {
    const record = result.records[0];
    return JSON.stringify(
      record && isParsed(record) ? materializeNode(record.node) : null,
      null,
      indent,
    );
  }

  return result.records
    .map(
      (record) => JSON.stringify(isParsed(record) ? materializeNode(record.node) : null) ?? "null",
    )
    .join("\n");
};

export const materializeNode = (node: JsonNode): unknown => {
  if (node.kind === "object" && node.children) {
    return Object.fromEntries(
      Object.entries(node.children).map(([key, child]) => [key, materializeNode(child)]),
    );
  }

  if (node.kind === "array" && node.children) {
    return node.children.map((child) => materializeNode(child));
  }

  if (node.kind === "object" || node.kind === "array") {
    return node.preview ? null : node.value;
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
  if (index < 0) {
    return null;
  }

  // The token text can occur earlier in the input than the actual failure (e.g. inside
  // a string value), so only trust this fallback when the token is unambiguous.
  return index === input.lastIndexOf(token) ? index : null;
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
