import type { JsonlRecord, JsonNode } from "../src";

declare const node: JsonNode;

const base = {
  id: "record-1",
  lineNumber: 1,
  summary: "record",
};

const full = {
  ...base,
  status: "full",
  node,
} satisfies JsonlRecord;

const preview = {
  ...base,
  status: "preview",
  node,
  preview: { fields: { event: "tool_call" } },
} satisfies JsonlRecord;

const failed = {
  ...base,
  status: "failed",
  node: null,
  error: "Unexpected token",
  errorMeta: { line: 1, column: 1, rawLine: "bad", context: "bad" },
  rawLine: "bad",
} satisfies JsonlRecord;

// @ts-expect-error Full Records cannot carry preview data.
const _fullWithPreview: JsonlRecord = { ...full, preview: { fields: {} } };

// @ts-expect-error Preview Records require a parsed node.
const _previewWithoutNode: JsonlRecord = { ...preview, node: null };

// @ts-expect-error Failed Records require source diagnostics.
const _failedWithoutDiagnostics: JsonlRecord = { ...base, status: "failed", node: null };

// @ts-expect-error Failed Records cannot carry a parsed node.
const _failedWithNode: JsonlRecord = { ...failed, node };
