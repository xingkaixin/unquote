import { addFieldObservation, createFieldProfile } from "./field-profile";
import type { FieldProfile } from "./field-profile";
import { hasJsonNodeChildren, stringifyJsonNodeWithLimits } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import { parseTreePath } from "./path-codec";
import type { TreePathSegment } from "./path-codec";
import type { PublishedSourceRevision } from "./published-source";
import { yieldToMain } from "./record-export";

export const tableRowLimit = 100_000;
export const tableBytesLimit = 20 * 1024 * 1024;
const tableCellBytesLimit = 64 * 1024;
const tableRecordBytesLimit = 4 * 1024 * 1024;

export type TableOperator =
  | "any"
  | "equals"
  | "contains"
  | "greater"
  | "less"
  | "missing"
  | "kind"
  | "empty";
export interface TableColumn {
  path: string;
  operator: TableOperator;
  value: string;
}
export interface TableCell {
  kind: JsonNode["kind"] | "missing";
  text: string;
}
export interface TableRow {
  recordId: string;
  lineNumber: number;
  cells: TableCell[];
}
export interface TableResult {
  columns: TableColumn[];
  rows: TableRow[];
  profiles: FieldProfile[];
  scanned: number;
  failed: number;
}

const resolveCellNode = (root: JsonNode, segments: TreePathSegment[]) => {
  let node: JsonNode | undefined = root;
  for (const segment of segments) {
    if (node.truncated || node.preview) throw new RangeError("table-incomplete");
    if (!hasJsonNodeChildren(node)) return undefined;
    if ((node.kind === "array") !== (segment.kind === "index")) return undefined;
    node = Object.hasOwn(node.children, segment.value)
      ? (node.children as Record<string, JsonNode>)[segment.value]
      : undefined;
    if (!node) return undefined;
  }
  return node;
};

const cellForNode = (node: JsonNode | undefined): TableCell => {
  if (!node) return { kind: "missing", text: "" };
  const serialized = stringifyJsonNodeWithLimits(node, {
    maxBytes: tableCellBytesLimit,
    maxNodes: 20_000,
  });
  if (!serialized.complete) throw new RangeError("table-cell-limit");
  return { kind: node.kind, text: node.kind === "string" ? node.value : serialized.text };
};

const numberPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const decimalParts = (text: string) => {
  const match = numberPattern.exec(text);
  if (!match) throw new Error("invalid-number");
  const digits = (match[2]! + (match[3] ?? "")).replace(/^0+/, "");
  return {
    sign: digits ? (match[1] ? -1 : 1) : 0,
    digits,
    magnitude: BigInt(digits.length) + BigInt(match[4] ?? 0) - BigInt(match[3]?.length ?? 0),
  };
};

export const compareTableNumbers = (left: string, right: string) => {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (a.sign !== b.sign) return Math.sign(a.sign - b.sign);
  if (!a.sign) return 0;
  if (a.magnitude !== b.magnitude) return (a.magnitude > b.magnitude ? 1 : -1) * a.sign;
  const width = Math.max(a.digits.length, b.digits.length);
  const first = a.digits.padEnd(width, "0");
  const second = b.digits.padEnd(width, "0");
  return (first === second ? 0 : first > second ? 1 : -1) * a.sign;
};

export const tableCellMatches = (cell: TableCell, column: TableColumn) => {
  switch (column.operator) {
    case "kind":
      return cell.kind === column.value;
    case "empty":
      return cell.kind === "string" && cell.text === "";
    case "any":
      return true;
    case "missing":
      return cell.kind === "missing";
    case "contains":
      return cell.kind === "string" && cell.text.includes(column.value);
    case "equals":
      return (
        cell.kind !== "missing" &&
        (cell.kind === "number"
          ? numberPattern.test(column.value) && compareTableNumbers(cell.text, column.value) === 0
          : cell.text === column.value)
      );
    case "greater":
      return cell.kind === "number" && compareTableNumbers(cell.text, column.value) > 0;
    case "less":
      return cell.kind === "number" && compareTableNumbers(cell.text, column.value) < 0;
  }
};

export const scanRecordTable = async (
  source: PublishedSourceRevision,
  records: JsonlRecord[],
  columns: TableColumn[],
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<TableResult> => {
  if (!columns.length || columns.length > 12) throw new RangeError("table-column-limit");
  const paths = columns.map((column) => {
    const path = parseTreePath(column.path);
    if (!path) throw new Error("invalid-path");
    if (
      column.operator === "kind" &&
      !["null", "string", "number", "boolean", "object", "array", "missing"].includes(column.value)
    )
      throw new Error("invalid-kind");
    if (column.operator === "greater" || column.operator === "less") decimalParts(column.value);
    return path;
  });
  const result: TableResult = {
    columns: columns.map((column) => ({ ...column })),
    rows: [],
    profiles: columns.map(createFieldProfile),
    scanned: 0,
    failed: 0,
  };
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let offset = 0; offset < records.length; offset += 64) {
    signal.throwIfAborted();
    const batch = records.slice(offset, offset + 64);
    const previews = batch.filter((record) => record.status === "preview");
    const resolved =
      previews.length && source.kind === "local-file"
        ? await source.access.resolveRecords(previews, signal, tableRecordBytesLimit)
        : [];
    const byId = new Map(resolved.map((record) => [record.id, record]));
    for (const candidate of batch) {
      signal.throwIfAborted();
      const record = byId.get(candidate.id) ?? candidate;
      result.scanned++;
      if (record.status === "failed") {
        result.failed++;
        continue;
      }
      if (record.status !== "full") throw new Error("table-incomplete");
      const cells = paths.map((path) => cellForNode(resolveCellNode(record.node, path)));
      cells.forEach((cell, index) => addFieldObservation(result.profiles[index]!, cell));
      if (!cells.every((cell, index) => tableCellMatches(cell, columns[index]!))) continue;
      bytes += cells.reduce((size, cell) => size + encoder.encode(cell.text).byteLength + 64, 64);
      if (bytes > tableBytesLimit || result.rows.length >= tableRowLimit)
        throw new RangeError("table-result-limit");
      result.rows.push({ recordId: record.id, lineNumber: record.lineNumber, cells });
    }
    onProgress(result.scanned);
    await yieldToMain();
  }
  signal.throwIfAborted();
  return result;
};

const csvField = (text: string) => `"${text.replace(/"/g, '""')}"`;
const spreadsheetText = (text: string) => (/^[\s]*[=+\-@\t\r\n]/.test(text) ? `'${text}` : text);

export const exportTableCsv = async (result: TableResult, signal: AbortSignal) => {
  const parts = [
    result.columns.map((column) => csvField(spreadsheetText(column.path))).join(",") + "\r\n",
  ];
  for (let offset = 0; offset < result.rows.length; offset += 250) {
    signal.throwIfAborted();
    parts.push(
      result.rows
        .slice(offset, offset + 250)
        .map((row) =>
          row.cells
            .map((cell) =>
              csvField(cell.kind === "string" ? spreadsheetText(cell.text) : cell.text),
            )
            .join(","),
        )
        .join("\r\n") + "\r\n",
    );
    await yieldToMain();
  }
  signal.throwIfAborted();
  return parts;
};
