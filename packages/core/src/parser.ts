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
import {
  hasNonCanonicalJsonNumber,
  materializeLosslessValue,
  parseLosslessJson,
  parseNativeJson,
  type NativeJsonValue,
} from "./lossless-json.js";
import { getErrorMessage, getParseErrorMeta } from "./parse-error.js";
import {
  createFullJsonlRecord,
  createFullJsonlRecordFromNative,
  createPreviewJsonlRecord,
  createPreviewJsonlRecordFromNative,
} from "./record-builder.js";
import { isFailedRecord, isParsed, isPreviewRecord } from "./records.js";
import { stringifyJsonNode } from "./serialization.js";
import { isLikelySse, parseSseRecords } from "./sse.js";
import { probeJsonl, resolveMaxDepth, truncateAtCodePointBoundary } from "./utils.js";

const createParseErrorRecord = (
  line: string,
  lineNumber: number,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values and promise rejections are not restricted to Error instances.
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
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Materialized JSON has no application schema; callers must narrow its decoded value.
  { record: T; materializeValue: () => unknown } | { record: FailedJsonlRecord };

type JsonlRecordLineSourceResult<T extends FullJsonlRecord | PreviewJsonlRecord> =
  | { record: T; native: true; value: NativeJsonValue }
  | { record: T; native: false; source: LosslessJsonValue }
  | { record: FailedJsonlRecord };

const isBlankLine = (line: string) => {
  if (line.length === 0) {
    return true;
  }
  const first = line.charCodeAt(0);
  return (first <= 32 || first >= 0x80) && line.trim().length === 0;
};

const splitLinesFast = (input: string): string[] => {
  const lines: string[] = [];
  const length = input.length;
  let start = 0;

  while (start <= length) {
    const newline = input.indexOf("\n", start);
    if (newline === -1) {
      lines.push(input.slice(start));
      break;
    }
    const end = newline > start && input.charCodeAt(newline - 1) === 13 ? newline - 1 : newline;
    lines.push(input.slice(start, end));
    start = newline + 1;
  }

  return lines;
};

const parseJsonlRecordLineWith = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  line: string,
  lineNumber: number,
  createFromNative: (value: NativeJsonValue) => T,
  createFromLossless: (value: LosslessJsonValue) => T,
): JsonlRecordLineSourceResult<T> => {
  try {
    if (!hasNonCanonicalJsonNumber(line)) {
      const value = parseNativeJson(line);
      return { record: createFromNative(value), native: true, value };
    }
    const source = parseLosslessJson(line);
    return { record: createFromLossless(source), native: false, source };
  } catch (error) {
    return { record: createParseErrorRecord(line, lineNumber, error) };
  }
};

const withApproximateValue = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  result: JsonlRecordLineSourceResult<T>,
): JsonlRecordLineResult<T> => {
  if ("native" in result) {
    return result.native
      ? { record: result.record, value: result.value }
      : {
          record: result.record,
          value: materializeLosslessValue(result.source, { numbers: "approximate" }),
        };
  }
  return result;
};

const withLazyApproximateValue = <T extends FullJsonlRecord | PreviewJsonlRecord>(
  result: JsonlRecordLineSourceResult<T>,
): JsonlRecordIngestionLine<T> => {
  if ("native" in result) {
    return result.native
      ? { record: result.record, materializeValue: () => result.value }
      : {
          record: result.record,
          materializeValue: () =>
            materializeLosslessValue(result.source, { numbers: "approximate" }),
        };
  }
  return result;
};

const parseFullJsonlRecordLine = (line: string, lineNumber: number, maxDepth: number) =>
  parseJsonlRecordLineWith(
    line,
    lineNumber,
    (value) => createFullJsonlRecordFromNative(value, lineNumber, maxDepth),
    (value) => createFullJsonlRecord(value, lineNumber, maxDepth),
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

const parsePreviewLine = (line: string, lineNumber: number) => {
  const result = parseJsonlRecordLineWith(
    line,
    lineNumber,
    (value) => createPreviewJsonlRecordFromNative(value, lineNumber),
    (value) => createPreviewJsonlRecord(value, lineNumber),
  );
  if (result.record.status !== "failed" || line.length <= 512) return result;
  const record = result.record;
  const rawLine = `${truncateAtCodePointBoundary(line, 512)}…`;
  return {
    record: {
      ...record,
      error: truncateAtCodePointBoundary(record.error, 512),
      rawLine,
      rawLineTruncated: true as const,
      errorMeta: { ...record.errorMeta, rawLine },
    },
  };
};

export const parsePreviewJsonlRecordLineWithValue = (
  line: string,
  lineNumber: number,
): JsonlRecordLineResult<PreviewJsonlRecord> =>
  withApproximateValue(parsePreviewLine(line, lineNumber));

export const parsePreviewJsonlRecordLine = (
  line: string,
  lineNumber: number,
): PreviewJsonlRecord | FailedJsonlRecord => parsePreviewLine(line, lineNumber).record;

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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isBlankLine(line)) {
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
    if (!line || isBlankLine(line)) {
      continue;
    }

    parsedLines.push(parseLine(line, index + 1));
  }

  return parsedLines;
};

const parseForcedJsonlText = <TLine>(
  input: string,
  parseLine: (line: string, lineNumber: number) => TLine,
): TLine[] => {
  const parsedLines: TLine[] = [];
  const length = input.length;
  let start = 0;
  let lineNumber = 1;

  while (start <= length) {
    const newline = input.indexOf("\n", start);
    const end =
      newline === -1
        ? length
        : newline > start && input.charCodeAt(newline - 1) === 13
          ? newline - 1
          : newline;
    if (end > start) {
      const line = input.slice(start, end);
      if (!isBlankLine(line)) {
        parsedLines.push(parseLine(line, lineNumber));
      }
    }
    if (newline === -1) {
      break;
    }
    start = newline + 1;
    lineNumber += 1;
  }

  return parsedLines;
};

const buildSseResult = (input: string, maxDepth: number): ParseResult => {
  const records = parseSseRecords(input, { maxDepth });
  return {
    format: "sse",
    records,
    stats: { total: records.length, success: records.length, failed: 0 },
  };
};

const buildJsonlResult = (records: JsonlRecord[]): ParseResult => {
  let success = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (isParsed(records[index]!)) {
      success += 1;
    }
  }
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
    const record = !hasNonCanonicalJsonNumber(input)
      ? createFullJsonlRecordFromNative(parseNativeJson(input), 1, maxDepth)
      : createFullJsonlRecord(parseLosslessJson(input), 1, maxDepth);
    return {
      format: "json",
      records: [record],
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
  | { format: "json" | "sse"; result: ParseResult }
  | { format: "jsonl"; lines: JsonlRecordIngestionLine<FullJsonlRecord>[] };

type ParsedInputWithLines<TLine> =
  | { format: "json" | "sse"; result: ParseResult }
  | { format: "jsonl"; lines: TLine[] };

const parseInputWithJsonlLines = <TLine>(
  input: string,
  options: ParseOptions,
  parseLine: (line: string, lineNumber: number, maxDepth: number) => TLine,
  getRecord: (line: TLine) => FullJsonlRecord | FailedJsonlRecord,
): ParsedInputWithLines<TLine> => {
  const maxDepth = resolveMaxDepth(options.maxDepth);

  if (isBlankLine(input)) {
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

  if (options.forcedFormat === "sse" || (!options.forcedFormat && isLikelySse(input))) {
    return { format: "sse", result: buildSseResult(input, maxDepth) };
  }

  if (options.forcedFormat === "jsonl") {
    return {
      format: "jsonl",
      lines: parseForcedJsonlText(input, (line, lineNumber) =>
        parseLine(line, lineNumber, maxDepth),
      ),
    };
  }

  // Auto: strict JSONL → single JSON → loose JSONL → the JSON error result.
  const lines = splitLinesFast(input);
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
  return parsed.format === "jsonl"
    ? { format: "jsonl", lines: parsed.lines.map(withLazyApproximateValue) }
    : parsed;
};

export const parseInput = (input: string, options: ParseOptions = {}): ParseResult => {
  const parsed = parseInputWithJsonlLines(
    input,
    options,
    (line, lineNumber, maxDepth) => parseFullJsonlRecordLine(line, lineNumber, maxDepth).record,
    (record) => record,
  );
  return parsed.format === "jsonl" ? buildJsonlResult(parsed.lines) : parsed.result;
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
