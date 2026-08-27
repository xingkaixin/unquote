import type {
  FormatOptions,
  FailedJsonlRecord,
  FullJsonlRecord,
  JsonNode,
  JsonlRecord,
  LosslessJsonValue,
  ParseOptions,
  ParseResult,
  PreviewJsonlRecord,
} from "./types.js";
import { materializeLosslessValue, parseLosslessJson } from "./lossless-json.js";
import { getErrorMessage, getParseErrorMeta } from "./parse-error.js";
import { createFullJsonlRecord, createPreviewJsonlRecord } from "./record-builder.js";
import { isFailedRecord, isParsed, isPreviewRecord } from "./records.js";
import { stringifyJsonNode } from "./serialization.js";
import {
  DEFAULT_MAX_DEPTH,
  MAX_SUPPORTED_DEPTH,
  probeJsonl,
  truncateAtCodePointBoundary,
} from "./utils.js";

const resolveMaxDepth = (maxDepth: number | undefined) => {
  const resolved = maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > MAX_SUPPORTED_DEPTH) {
    throw new RangeError(`maxDepth must be an integer between 0 and ${MAX_SUPPORTED_DEPTH}`);
  }
  return resolved;
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

export type JsonlRecordIngestionLine<T extends FullJsonlRecord | PreviewJsonlRecord> =
  | { record: T; materializeValue: () => unknown }
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

const withLazyApproximateValue = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  result: JsonlRecordLineSourceResult<T>,
): JsonlRecordIngestionLine<T> =>
  "source" in result
    ? {
        record: result.record,
        materializeValue: () => materializeLosslessValue(result.source, { numbers: "approximate" }),
      }
    : result;

const parseFullJsonlRecordLine = (line: string, lineNumber: number, maxDepth: number) =>
  parseJsonlRecordLineWith(line, lineNumber, (value) =>
    createFullJsonlRecord(value, lineNumber, maxDepth),
  );

export const parseJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): JsonlRecordLineResult<FullJsonlRecord> =>
  withApproximateValue(
    parseFullJsonlRecordLine(line, lineNumber, resolveMaxDepth(options.maxDepth)),
  );

export const parseJsonlRecordLine = (
  line: string,
  lineNumber: number,
  options: ParseOptions = {},
): FullJsonlRecord | FailedJsonlRecord =>
  parseFullJsonlRecordLine(line, lineNumber, resolveMaxDepth(options.maxDepth)).record;

export const parsePreviewJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
): JsonlRecordLineResult<PreviewJsonlRecord> =>
  withApproximateValue(
    parseJsonlRecordLineWith(line, lineNumber, (value) =>
      createPreviewJsonlRecord(value, lineNumber),
    ),
  );

export const parsePreviewJsonlRecordLine = (
  line: string,
  lineNumber: number,
): PreviewJsonlRecord | FailedJsonlRecord =>
  parseJsonlRecordLineWith(line, lineNumber, (value) => createPreviewJsonlRecord(value, lineNumber))
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
      records: [createFullJsonlRecord(parsed, 1, maxDepth)],
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
  | { format: "jsonl"; lines: JsonlRecordIngestionLine<FullJsonlRecord>[] };

type ParsedInputWithLines<TLine> =
  | { format: "json"; result: ParseResult }
  | { format: "jsonl"; lines: TLine[] };

const parseInputWithJsonlLines = <TLine>(
  input: string,
  options: ParseOptions,
  parseLine: (line: string, lineNumber: number, maxDepth: number) => TLine,
  getRecord: (line: TLine) => FullJsonlRecord | FailedJsonlRecord,
): ParsedInputWithLines<TLine> => {
  const maxDepth = resolveMaxDepth(options.maxDepth);

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
    return {
      format: "jsonl",
      lines: parseLooseJsonlLines(input.split(/\r?\n/), (line, lineNumber) =>
        parseLine(line, lineNumber, maxDepth),
      ),
    };
  }

  // Auto: strict JSONL → single JSON → loose JSONL → the JSON error result.
  const lines = input.split(/\r?\n/);
  const strict = parseStrictJsonlLines(
    lines,
    (line, lineNumber) => parseLine(line, lineNumber, maxDepth),
    getRecord,
  );
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

  const loose = parseLooseJsonlLines(
    lines,
    (line, lineNumber) => parseLine(line, lineNumber, maxDepth),
    strict,
  );
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
    (line, lineNumber, maxDepth) => parseFullJsonlRecordLine(line, lineNumber, maxDepth),
    (line) => line.record,
  );
  return parsed.format === "json"
    ? parsed
    : { format: "jsonl", lines: parsed.lines.map(withLazyApproximateValue) };
};

export const parseInput = (input: string, options: ParseOptions = {}): ParseResult => {
  const parsed = parseInputWithJsonlLines(
    input,
    options,
    (line, lineNumber, maxDepth) => parseFullJsonlRecordLine(line, lineNumber, maxDepth).record,
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
  if (result.records.some(isPreviewRecord)) {
    throw new TypeError("Cannot format preview records; load the full records first");
  }
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
