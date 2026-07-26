import type { JsonlRecord } from "@unquote/core";
import { materializeRecord } from "./tree";

// Copy builds one giant string and hands it to the clipboard API, which freezes
// the main thread on large data. Export streams via Blob(parts[]) and is safe.
export const copyRecordLimit = 5000;
export const copyBytesLimit = 20_000_000;
export const isCopyAboveThreshold = (recordCount: number, bytes: number) =>
  recordCount > copyRecordLimit || bytes > copyBytesLimit;

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

export const formatRecordsAsJsonl = (records: JsonlRecord[]) =>
  records.map((record) => JSON.stringify(getCopyValue(record))).join("\n");

export const formatRecordsAsJson = (records: JsonlRecord[], format: "json" | "jsonl") => {
  const values = records.map((record) => getCopyValue(record));
  if (format === "json") {
    return JSON.stringify(values[0] ?? null, null, 2);
  }

  return JSON.stringify(values, null, 2);
};

// Yield the main thread so a long stringify doesn't freeze the UI (toasts,
// spinners stay live). Resolves on the next macrotask.
export const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const exportChunkSize = 200;

// Stream-friendly: each record stringifies to its own BlobPart so the engine
// concatenates buffers directly instead of one giant JS string. Chunked with
// main-thread yields so an "Exporting…" toast stays responsive.
export const formatRecordsAsJsonlParts = async (records: JsonlRecord[]): Promise<BlobPart[]> => {
  const parts: BlobPart[] = [];
  for (let index = 0; index < records.length; index += 1) {
    if (index > 0) {
      parts.push("\n");
    }
    parts.push(JSON.stringify(getCopyValue(records[index]!)));
    if (index > 0 && index % exportChunkSize === 0) {
      await yieldToMain();
    }
  }
  return parts;
};

export const formatRecordsAsJsonParts = async (
  records: JsonlRecord[],
  format: "json" | "jsonl",
): Promise<BlobPart[]> => {
  if (format === "json") {
    const value = records[0] ? getCopyValue(records[0]) : null;
    return [JSON.stringify(value, null, 2)];
  }

  // JSONL-as-JSON-array: stringify each record on its own and indent it to the
  // array's nesting, instead of handing JSON.stringify one 300MB+ value — that
  // single synchronous call can't be interrupted and freezes the tab. Per-record
  // chunked yields keep the UI (and the "Exporting…" toast) live.
  if (records.length === 0) {
    return ["[]"];
  }
  const parts: BlobPart[] = ["[\n"];
  for (let index = 0; index < records.length; index += 1) {
    if (index > 0) {
      parts.push(",\n");
    }
    const body = JSON.stringify(getCopyValue(records[index]!), null, 2);
    parts.push(`  ${body.replace(/\n/g, "\n  ")}`);
    if (index > 0 && index % exportChunkSize === 0) {
      await yieldToMain();
    }
  }
  parts.push("\n]");
  return parts;
};

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
