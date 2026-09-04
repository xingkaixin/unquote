import type { JsonNode, JsonlRecord } from "@unquote/core";
import { isPreviewRecord, stringifyJsonNodeBounded } from "@unquote/core";
import { materializeRecord } from "./tree";

export const copyRecordLimit = 5000;
export const copyBytesLimit = 20_000_000;
export const isCopyRecordCountAboveThreshold = (recordCount: number) =>
  recordCount > copyRecordLimit;

const normalizedByteLimit = (byteLimit: number) =>
  Number.isFinite(byteLimit)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(byteLimit)))
    : 0;

const utf8ByteLengthWithin = (value: string, byteLimit: number) => {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let width = first <= 0x7f ? 1 : first <= 0x7ff ? 2 : 3;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        width = 4;
        index += 1;
      }
    }
    byteLength += width;
    if (byteLength > byteLimit) {
      return null;
    }
  }
  return byteLength;
};

export const isCopyTextAboveThreshold = (text: string, byteLimit = copyBytesLimit) =>
  utf8ByteLengthWithin(text, normalizedByteLimit(byteLimit)) === null;

export const getCopyValue = (record: JsonlRecord) => {
  if (record.status !== "failed") {
    return materializeRecord(record);
  }

  return {
    lineNumber: record.lineNumber,
    error: record.error,
    line: record.errorMeta.line,
    column: record.errorMeta.column,
    rawLine: record.rawLine,
    context: record.errorMeta.context,
    summary: record.summary,
  };
};

const copyNodeFor = (record: JsonlRecord): JsonNode => {
  if (isPreviewRecord(record)) {
    throw new TypeError("Cannot export a preview record; load the full record first");
  }
  if (record.status !== "failed") {
    return record.node;
  }

  return {
    kind: "object",
    children: {
      lineNumber: { kind: "number", value: record.lineNumber },
      error: { kind: "string", value: record.error },
      line: { kind: "number", value: record.errorMeta.line },
      column: { kind: "number", value: record.errorMeta.column },
      rawLine: { kind: "string", value: record.rawLine },
      context: { kind: "string", value: record.errorMeta.context },
      summary: { kind: "string", value: record.summary },
    },
  };
};

class CopyPayloadWriter {
  private readonly chunks: string[] = [];
  private byteLength = 0;
  private exceeded = false;
  readonly byteLimit: number;

  constructor(byteLimit: number) {
    this.byteLimit = normalizedByteLimit(byteLimit);
  }

  get remainingBytes() {
    return Math.max(0, this.byteLimit - this.byteLength);
  }

  append(value: string) {
    if (this.exceeded) {
      return false;
    }
    const addedBytes = utf8ByteLengthWithin(value, this.remainingBytes);
    if (addedBytes === null) {
      this.exceeded = true;
      return false;
    }
    this.chunks.push(value);
    this.byteLength += addedBytes;
    return true;
  }

  finish() {
    return this.exceeded ? null : this.chunks.join("");
  }
}

const boundedRecordText = (record: JsonlRecord, indent: number, maxLength: number) =>
  stringifyJsonNodeBounded(copyNodeFor(record), maxLength, { indent });

const appendRecord = (writer: CopyPayloadWriter, record: JsonlRecord, indent: number) => {
  const serialized = boundedRecordText(record, indent, writer.remainingBytes);
  return !serialized.truncated && writer.append(serialized.text);
};

const appendIndentedRecord = (writer: CopyPayloadWriter, record: JsonlRecord) => {
  const serialized = boundedRecordText(record, 2, writer.remainingBytes);
  if (serialized.truncated || !writer.append("  ")) {
    return false;
  }

  let start = 0;
  while (start < serialized.text.length) {
    const newline = serialized.text.indexOf("\n", start);
    if (newline < 0) {
      return writer.append(serialized.text.slice(start));
    }
    if (!writer.append(serialized.text.slice(start, newline)) || !writer.append("\n  ")) {
      return false;
    }
    start = newline + 1;
  }
  return true;
};

export const formatRecordsAsJsonlForCopy = (
  records: JsonlRecord[],
  byteLimit = copyBytesLimit,
): string | null => {
  if (isCopyRecordCountAboveThreshold(records.length)) {
    return null;
  }
  const writer = new CopyPayloadWriter(byteLimit);
  for (let index = 0; index < records.length; index += 1) {
    if ((index > 0 && !writer.append("\n")) || !appendRecord(writer, records[index]!, 0)) {
      return null;
    }
  }
  return writer.finish();
};

export const formatRecordsAsJsonForCopy = (
  records: JsonlRecord[],
  format: "json" | "jsonl",
  byteLimit = copyBytesLimit,
): string | null => {
  const writer = new CopyPayloadWriter(byteLimit);
  if (format === "json") {
    const record = records[0];
    if (!record) {
      return writer.append("null") ? writer.finish() : null;
    }
    return appendRecord(writer, record, 2) ? writer.finish() : null;
  }
  if (isCopyRecordCountAboveThreshold(records.length)) {
    return null;
  }
  if (records.length === 0) {
    return writer.append("[]") ? writer.finish() : null;
  }
  if (!writer.append("[\n")) {
    return null;
  }
  for (let index = 0; index < records.length; index += 1) {
    if ((index > 0 && !writer.append(",\n")) || !appendIndentedRecord(writer, records[index]!)) {
      return null;
    }
  }
  return writer.append("\n]") ? writer.finish() : null;
};

export const formatResolvedRecordsForCopy = async (
  records: JsonlRecord[],
  format: "json" | "jsonl" | "array",
  resolve: (record: JsonlRecord) => Promise<JsonlRecord | null>,
  signal: AbortSignal,
  byteLimit = copyBytesLimit,
): Promise<string | null> => {
  if (isCopyRecordCountAboveThreshold(records.length)) {
    return null;
  }
  const writer = new CopyPayloadWriter(byteLimit);
  if (format === "array" && !writer.append(records.length ? "[\n" : "[]")) {
    return null;
  }
  for (let index = 0; index < records.length; index += 1) {
    signal.throwIfAborted();
    const record = await resolve(records[index]!);
    signal.throwIfAborted();
    if (!record) {
      return null;
    }
    const separator = format === "array" ? ",\n" : "\n";
    if (index > 0 && !writer.append(separator)) {
      return null;
    }
    const appended =
      format === "array"
        ? appendIndentedRecord(writer, record)
        : appendRecord(writer, record, format === "json" ? 2 : 0);
    if (!appended) {
      return null;
    }
    if (format === "json") {
      break;
    }
  }
  if (format === "array" && records.length && !writer.append("\n]")) {
    return null;
  }
  if (format === "json" && !records.length && !writer.append("null")) {
    return null;
  }
  return writer.finish();
};

// Yield the main thread so a long stringify doesn't freeze the UI (toasts,
// spinners stay live). Resolves on the next macrotask.
export const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const exportChunkSize = 200;

/**
 * Serializes records one at a time so a caller can release each Full Record as
 * soon as its text exists. `bodyFor` is separate from `addBody` because the
 * streaming export reads the file in line order but writes in the caller's
 * record order.
 */
export interface ExportPartsBuilder {
  bodyFor: (record: JsonlRecord) => string;
  addBody: (body: string) => void;
  finish: () => BlobPart[];
}

export const exportBytesLimit = 64 * 1024 * 1024;

export class ExportSizeLimitError extends Error {
  constructor() {
    super("Export exceeds the byte limit");
  }
}

const createExportPartsBuilder = (
  format: "json" | "jsonl" | "array",
  byteLimit: number,
): ExportPartsBuilder => {
  const parts: BlobPart[] = [];
  let remainingBytes = normalizedByteLimit(byteLimit);
  let count = 0;
  const requireBytes = (value: string) => {
    const bytes = utf8ByteLengthWithin(value, remainingBytes);
    if (bytes === null) {
      throw new ExportSizeLimitError();
    }
    return bytes;
  };
  const append = (value: string) => {
    remainingBytes -= requireBytes(value);
    if (value) {
      parts.push(value);
    }
  };
  return {
    bodyFor(record) {
      const serialized = boundedRecordText(record, format === "jsonl" ? 0 : 2, remainingBytes);
      if (serialized.truncated) {
        throw new ExportSizeLimitError();
      }
      if (format === "array") {
        let indentationBytes = 2;
        for (const character of serialized.text) {
          if (character === "\n") indentationBytes += 2;
        }
        if (
          indentationBytes > remainingBytes ||
          utf8ByteLengthWithin(serialized.text, remainingBytes - indentationBytes) === null
        ) {
          throw new ExportSizeLimitError();
        }
      }
      const body =
        format === "array" ? `  ${serialized.text.replace(/\n/g, "\n  ")}` : serialized.text;
      requireBytes(body);
      return body;
    },
    addBody(body) {
      if (format === "json" && count > 0) {
        return;
      }
      const prefix = format === "array" ? (count === 0 ? "[\n" : ",\n") : count > 0 ? "\n" : "";
      append(prefix);
      append(body);
      count += 1;
    },
    finish() {
      const suffix =
        format === "array"
          ? count === 0
            ? "[]"
            : "\n]"
          : format === "json" && count === 0
            ? "null"
            : "";
      requireBytes(suffix);
      return suffix ? [...parts, suffix] : parts;
    },
  };
};

export const createJsonlPartsBuilder = (byteLimit = exportBytesLimit): ExportPartsBuilder =>
  createExportPartsBuilder("jsonl", byteLimit);

export const createJsonPartsBuilder = (
  format: "json" | "jsonl",
  byteLimit = exportBytesLimit,
): ExportPartsBuilder => createExportPartsBuilder(format === "json" ? "json" : "array", byteLimit);

// Chunked with main-thread yields so an "Exporting…" toast stays responsive.
export const addRecordBodiesToBuilder = async (
  builder: ExportPartsBuilder,
  records: JsonlRecord[],
  bodyFor: (record: JsonlRecord) => string,
  signal?: AbortSignal,
): Promise<BlobPart[]> => {
  signal?.throwIfAborted();
  for (let index = 0; index < records.length; index += 1) {
    builder.addBody(bodyFor(records[index]!));
    if (index > 0 && index % exportChunkSize === 0) {
      await yieldToMain();
      signal?.throwIfAborted();
    }
  }
  signal?.throwIfAborted();
  return builder.finish();
};

export const addRecordsToBuilder = (
  builder: ExportPartsBuilder,
  records: JsonlRecord[],
  signal?: AbortSignal,
): Promise<BlobPart[]> => addRecordBodiesToBuilder(builder, records, builder.bodyFor, signal);

export const downloadBlob = (parts: BlobPart[], filename: string, type: string) => {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  // Firefox and WebKit acquire Blob downloads asynchronously after the click.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
};

export const createExportFilename = (extension: "json" | "jsonl") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `unquote-visible-${timestamp}.${extension}`;
};
