import type { JsonNode, JsonlRecord } from "@unquote/core";
import { stringifyJsonNode, stringifyJsonNodeBounded } from "@unquote/core";
import { materializeRecord } from "./tree";

// Copy builds one giant string and hands it to the clipboard API, which freezes
// the main thread on large data. Export streams via Blob(parts[]) and is safe.
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

export const formatRecord = (record: JsonlRecord, indent = 0) =>
  record.status === "failed"
    ? JSON.stringify(getCopyValue(record), null, indent)
    : stringifyJsonNode(record.node, { indent });

export const formatRecordsAsJsonl = (records: JsonlRecord[]) =>
  records.map((record) => formatRecord(record)).join("\n");

export const formatRecordsAsJson = (records: JsonlRecord[], format: "json" | "jsonl") => {
  if (format === "json") {
    const [record] = records;
    return record ? formatRecord(record, 2) : "null";
  }

  const bodies = records.map((record) => `  ${formatRecord(record, 2).replace(/\n/g, "\n  ")}`);
  return bodies.length === 0 ? "[]" : `[\n${bodies.join(",\n")}\n]`;
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

// Yield the main thread so a long stringify doesn't freeze the UI (toasts,
// spinners stay live). Resolves on the next macrotask.
export const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const exportChunkSize = 200;

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

// Stream-friendly: each record stringifies to its own BlobPart so the engine
// concatenates buffers directly instead of one giant JS string.
export const createJsonlPartsBuilder = (): ExportPartsBuilder => {
  const parts: BlobPart[] = [];
  return {
    bodyFor: (record) => formatRecord(record),
    addBody: (body) => {
      if (parts.length > 0) {
        parts.push("\n");
      }
      parts.push(body);
    },
    finish: () => parts,
  };
};

// JSONL-as-JSON-array: stringify each record on its own and indent it to the
// array's nesting, instead of handing JSON.stringify one 300MB+ value — that
// single synchronous call can't be interrupted and freezes the tab.
export const createJsonPartsBuilder = (format: "json" | "jsonl"): ExportPartsBuilder => {
  const bodyFor = (record: JsonlRecord) => formatRecord(record, 2);

  if (format === "json") {
    let first: string | null = null;
    return {
      bodyFor,
      addBody: (body) => {
        first ??= body;
      },
      finish: () => [first ?? "null"],
    };
  }

  const parts: BlobPart[] = [];
  return {
    bodyFor: (record) => `  ${bodyFor(record).replace(/\n/g, "\n  ")}`,
    addBody: (body) => {
      parts.push(parts.length === 0 ? "[\n" : ",\n", body);
    },
    finish: () => (parts.length === 0 ? ["[]"] : [...parts, "\n]"]),
  };
};

// Chunked with main-thread yields so an "Exporting…" toast stays responsive.
export const addRecordsToBuilder = async (
  builder: ExportPartsBuilder,
  records: JsonlRecord[],
  signal?: AbortSignal,
): Promise<BlobPart[]> => {
  signal?.throwIfAborted();
  for (let index = 0; index < records.length; index += 1) {
    builder.addBody(builder.bodyFor(records[index]!));
    if (index > 0 && index % exportChunkSize === 0) {
      await yieldToMain();
      signal?.throwIfAborted();
    }
  }
  signal?.throwIfAborted();
  return builder.finish();
};

export const formatRecordsAsJsonlParts = (records: JsonlRecord[]): Promise<BlobPart[]> =>
  addRecordsToBuilder(createJsonlPartsBuilder(), records);

export const formatRecordsAsJsonParts = (
  records: JsonlRecord[],
  format: "json" | "jsonl",
): Promise<BlobPart[]> => addRecordsToBuilder(createJsonPartsBuilder(format), records);

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
