import type { JsonlRecord } from "@unquote/core";
import { stringifyJsonNode } from "@unquote/core";
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
): Promise<BlobPart[]> => {
  for (let index = 0; index < records.length; index += 1) {
    builder.addBody(builder.bodyFor(records[index]!));
    if (index > 0 && index % exportChunkSize === 0) {
      await yieldToMain();
    }
  }
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
