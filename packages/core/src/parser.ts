import type {
  FormatOptions,
  FailedJsonlRecord,
  FullJsonNode,
  FullJsonlRecord,
  JsonContainerKind,
  JsonNode,
  JsonlRecord,
  JsonlRecordPreviewFieldValue,
  LosslessJsonValue,
  ParseErrorMeta,
  ParseOptions,
  ParseResult,
  PreviewJsonlRecord,
  PreviewJsonNode,
} from "./types.js";
import { materializeLosslessValue, parseLosslessJson } from "./lossless-json.js";
import { isFailedRecord, isParsed } from "./records.js";
import { stringifyJsonNode } from "./serialization.js";
import { DEFAULT_MAX_DEPTH, probeJsonl, truncateAtCodePointBoundary } from "./utils.js";

const maxPreviewStringLength = 160;
const summaryKeys = ["timestamp", "type", "action", "event", "name", "message"] as const;

const summarizeLosslessPrimitive = (value: LosslessJsonValue) => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return truncateAtCodePointBoundary(value, 72) || '""';
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (value.type === "number") {
    return value.rawValue;
  }
  return value.type === "array"
    ? `Array(${value.items.length})`
    : `Object(${Object.keys(value.entries).length})`;
};

const summarizeField = (key: string, value: LosslessJsonValue, maxLength: number) => {
  if (typeof value === "string" && value.trim()) {
    return `${key}:${truncateAtCodePointBoundary(value.trim(), maxLength)}`;
  }
  if (typeof value === "boolean") {
    return `${key}:${String(value)}`;
  }
  if (value !== null && typeof value === "object" && value.type === "number") {
    return `${key}:${value.rawValue}`;
  }
  return null;
};

const extractLosslessSummary = (value: LosslessJsonValue) => {
  if (value === null || typeof value !== "object" || value.type !== "object") {
    return summarizeLosslessPrimitive(value);
  }

  const preferred = summaryKeys.flatMap((key) => {
    const field = value.entries[key];
    const summary = field === undefined ? null : summarizeField(key, field, 48);
    return summary ? [summary] : [];
  });
  if (preferred.length > 0) {
    return preferred.join(" · ");
  }

  for (const [key, field] of Object.entries(value.entries)) {
    const summary = summarizeField(key, field, 72);
    if (summary) {
      return summary;
    }
  }
  return `Object(${Object.keys(value.entries).length})`;
};

const toNode = (
  value: LosslessJsonValue,
  depth: number,
  maxDepth: number,
  rawString?: string,
): FullJsonNode => {
  const source = rawString === undefined ? {} : { rawString };

  if (value !== null && typeof value === "object" && value.type === "object") {
    if (depth >= maxDepth) {
      return {
        kind: "object",
        value,
        truncated: true,
        ...source,
      };
    }

    const children = Object.fromEntries(
      Object.entries(value.entries).map(([key, childValue]) => [
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

  if (value !== null && typeof value === "object" && value.type === "array") {
    if (depth >= maxDepth) {
      return {
        kind: "array",
        value,
        truncated: true,
        ...source,
      };
    }

    const children = value.items.map((childValue) => buildNode(childValue, depth + 1, maxDepth));

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
  if (typeof value === "object") {
    return { kind: "number", value: Number(value.rawValue), rawValue: value.rawValue, ...source };
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
    const parsed = parseLosslessJson(trimmed);
    return toNode(parsed, depth, maxDepth, value);
  } catch {
    return null;
  }
};

const buildNode = (value: LosslessJsonValue, depth: number, maxDepth: number): FullJsonNode => {
  if (typeof value === "string") {
    const expanded = maybeExpandString(value, depth, maxDepth);
    if (expanded) {
      return expanded;
    }
  }

  return toNode(value, depth, maxDepth);
};

const createRecord = (
  value: LosslessJsonValue,
  lineNumber: number,
  maxDepth: number,
): FullJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = buildNode(value, 0, maxDepth);

  return {
    status: "full",
    id,
    lineNumber,
    node,
    summary: extractLosslessSummary(value),
  };
};

const truncatePreviewString = (value: string) =>
  truncateAtCodePointBoundary(value, maxPreviewStringLength);

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
        ? Object.keys(node.value.entries).length
        : Object.keys(node.children).length;
    return { kind: "object", childCount, preview: true };
  }

  if (node.kind === "array") {
    const childCount = node.children === undefined ? node.value.items.length : node.children.length;
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

const createRecordPreview = (value: LosslessJsonValue) => {
  if (!value || typeof value !== "object" || value.type !== "object") {
    return undefined;
  }

  const fields: Array<[string, JsonlRecordPreviewFieldValue]> = [];
  const containers: Array<[string, JsonContainerKind]> = [];
  const nestedFieldKeys: string[] = [];

  for (const [key, child] of Object.entries(value.entries)) {
    if (child !== null && typeof child === "object") {
      if (child.type === "number") {
        fields.push([key, child]);
      } else {
        containers.push([key, child.type]);
      }
      continue;
    }

    fields.push([key, typeof child === "string" ? truncatePreviewString(child) : child]);
    if (typeof child === "string" && buildNode(child, 1, 1).rawString !== undefined) {
      nestedFieldKeys.push(key);
    }
  }

  if (fields.length === 0 && containers.length === 0) {
    return undefined;
  }

  // Collected as entries because assigning `preview[key]` would route a JSON
  // key named `__proto__` into the prototype setter instead of a property.
  return {
    fields: Object.fromEntries(fields),
    ...(containers.length > 0 ? { containers: Object.fromEntries(containers) } : {}),
    ...(nestedFieldKeys.length > 0 ? { nestedFieldKeys } : {}),
  };
};

const createPreviewRecord = (value: LosslessJsonValue, lineNumber: number): PreviewJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = projectPreviewNode(buildNode(value, 0, 0));
  const preview = createRecordPreview(value);

  return {
    status: "preview",
    id,
    lineNumber,
    node,
    ...(preview ? { preview } : {}),
    summary: extractLosslessSummary(value),
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
    summary: truncateAtCodePointBoundary(line, 72),
  };
};

export type JsonlRecordLineResult<T extends FullJsonlRecord | PreviewJsonlRecord> =
  | { record: T; value: unknown }
  | { record: FailedJsonlRecord };

type JsonlRecordLineSourceResult<T extends FullJsonlRecord | PreviewJsonlRecord> =
  | { record: T; source: LosslessJsonValue }
  | { record: FailedJsonlRecord };

const parseJsonlRecordLineWith = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  line: string,
  lineNumber: number,
  createParsedRecord: (value: LosslessJsonValue) => T,
): JsonlRecordLineSourceResult<T> => {
  try {
    const source = parseLosslessJson(line);
    return { record: createParsedRecord(source), source };
  } catch (error) {
    return { record: createParseErrorRecord(line, lineNumber, error) };
  }
};

const withApproximateValue = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  result: JsonlRecordLineSourceResult<T>,
): JsonlRecordLineResult<T> =>
  "source" in result
    ? {
        record: result.record,
        value: materializeLosslessValue(result.source, { numbers: "approximate" }),
      }
    : result;

const parseFullJsonlRecordLine = (line: string, lineNumber: number, options: ParseOptions) =>
  parseJsonlRecordLineWith(line, lineNumber, (value) =>
    createRecord(value, lineNumber, options.maxDepth ?? DEFAULT_MAX_DEPTH),
  );

export const parseJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): JsonlRecordLineResult<FullJsonlRecord> =>
  withApproximateValue(parseFullJsonlRecordLine(line, lineNumber, options));

export const parseJsonlRecordLine = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): FullJsonlRecord | FailedJsonlRecord =>
  parseFullJsonlRecordLine(line, lineNumber, options).record;

export const parsePreviewJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
): JsonlRecordLineResult<PreviewJsonlRecord> =>
  withApproximateValue(
    parseJsonlRecordLineWith(line, lineNumber, (value) => createPreviewRecord(value, lineNumber)),
  );

export const parsePreviewJsonlRecordLine = (
  line: string,
  lineNumber: number,
): PreviewJsonlRecord | FailedJsonlRecord =>
  parseJsonlRecordLineWith(line, lineNumber, (value) => createPreviewRecord(value, lineNumber))
    .record;

type StrictJsonlAttempt<TLine> =
  | {
      kind: "complete";
      lines: TLine[];
      nextLineIndex: number;
    }
  | {
      kind: "failed";
      lines: TLine[];
      nextLineIndex: number;
    };

// Strict pass: every non-empty line must parse, otherwise the input is not
// clean JSONL. Preserve the parsed prefix so loose fallback can resume without
// rebuilding records.
const parseStrictJsonlLines = <TLine>(
  lines: string[],
  parseLine: (line: string, lineNumber: number) => TLine,
  getRecord: (line: TLine) => FullJsonlRecord | FailedJsonlRecord,
): StrictJsonlAttempt<TLine> => {
  const parsedLines: TLine[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }

    const parsedLine = parseLine(line, index + 1);
    parsedLines.push(parsedLine);

    if (isFailedRecord(getRecord(parsedLine))) {
      return { kind: "failed", lines: parsedLines, nextLineIndex: index + 1 };
    }
  }

  return { kind: "complete", lines: parsedLines, nextLineIndex: lines.length };
};

// Loose pass: keep every line, failed ones become error records.
const parseLooseJsonlLines = <TLine>(
  lines: string[],
  parseLine: (line: string, lineNumber: number) => TLine,
  progress?: StrictJsonlAttempt<TLine>,
): TLine[] => {
  const parsedLines = progress?.lines ?? [];
  const startIndex = progress?.nextLineIndex ?? 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.trim()) {
      continue;
    }

    parsedLines.push(parseLine(line, index + 1));
  }

  return parsedLines;
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
    const parsed = parseLosslessJson(input);
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

export type ParseInputForIngestionResult =
  | { format: "json"; result: ParseResult }
  | { format: "jsonl"; lines: JsonlRecordLineResult<FullJsonlRecord>[] };

type ParsedInputWithLines<TLine> =
  | { format: "json"; result: ParseResult }
  | { format: "jsonl"; lines: TLine[] };

const parseInputWithJsonlLines = <TLine>(
  input: string,
  options: ParseOptions,
  parseLine: (line: string, lineNumber: number) => TLine,
  getRecord: (line: TLine) => FullJsonlRecord | FailedJsonlRecord,
): ParsedInputWithLines<TLine> => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (!input.trim()) {
    const format = options.forcedFormat ?? detectFormat(input);
    return format === "jsonl"
      ? { format, lines: [] }
      : {
          format,
          result: { format, records: [], stats: { total: 0, success: 0, failed: 0 } },
        };
  }

  if (options.forcedFormat === "json") {
    return { format: "json", result: parseSingleJsonResult(input, maxDepth) };
  }

  if (options.forcedFormat === "jsonl") {
    return { format: "jsonl", lines: parseLooseJsonlLines(input.split(/\r?\n/), parseLine) };
  }

  // Auto: strict JSONL → single JSON → loose JSONL → the JSON error result.
  const lines = input.split(/\r?\n/);
  const strict = parseStrictJsonlLines(lines, parseLine, getRecord);
  if (strict.kind === "complete") {
    if (strict.lines.length > 1) {
      return { format: "jsonl", lines: strict.lines };
    }

    // A complete strict pass over a single non-empty line means the whole input
    // is one JSON document that already has a full node tree, so only the
    // JSON-mode record identity is left to normalize.
    const [only] = strict.lines;
    if (only) {
      const record = getRecord(only);
      if (isParsed(record)) {
        return {
          format: "json",
          result: {
            format: "json",
            records: [
              record.lineNumber === 1 ? record : { ...record, id: "record-1", lineNumber: 1 },
            ],
            stats: { total: 1, success: 1, failed: 0 },
          },
        };
      }
    }
  }

  const single = parseSingleJsonResult(input, maxDepth);
  if (single.stats.success > 0) {
    return { format: "json", result: single };
  }

  const loose = parseLooseJsonlLines(lines, parseLine, strict);
  if (loose.length > 1 && loose.some((line) => isParsed(getRecord(line)))) {
    return { format: "jsonl", lines: loose };
  }

  return { format: "json", result: single };
};

export const parseInputForIngestion = (
  input: string,
  options: ParseOptions = {},
): ParseInputForIngestionResult => {
  const parsed = parseInputWithJsonlLines(
    input,
    options,
    (line, lineNumber) => parseFullJsonlRecordLine(line, lineNumber, options),
    (line) => line.record,
  );
  return parsed.format === "json"
    ? parsed
    : { format: "jsonl", lines: parsed.lines.map(withApproximateValue) };
};

export const parseInput = (input: string, options: ParseOptions = {}): ParseResult => {
  const parsed = parseInputWithJsonlLines(
    input,
    options,
    (line, lineNumber) => parseJsonlRecordLine(line, lineNumber, options),
    (record) => record,
  );
  return parsed.format === "json" ? parsed.result : buildJsonlResult(parsed.lines);
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
    return record && isParsed(record) ? stringifyJsonNode(record.node, { indent }) : "null";
  }

  return result.records
    .map((record) => (isParsed(record) ? stringifyJsonNode(record.node) : "null"))
    .join("\n");
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
    return {
      text: `${truncateAtCodePointBoundary(line, contextLineLength - 3)}...`,
      column,
    };
  }

  const zeroColumn = Math.max(0, column - 1);
  const initialStart = Math.min(
    Math.max(0, zeroColumn - contextLineRadius),
    Math.max(0, line.length - contextLineLength),
  );
  const startsInsideSurrogatePair =
    initialStart > 0 && (line.codePointAt(initialStart - 1) ?? 0) > 0xffff;
  const start = startsInsideSurrogatePair ? initialStart + 1 : initialStart;
  const visibleLine = truncateAtCodePointBoundary(
    line.slice(start, start + contextLineLength + 1),
    contextLineLength,
  );
  const end = start + visibleLine.length;
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";

  return {
    text: `${prefix}${visibleLine}${suffix}`,
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
