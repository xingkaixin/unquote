import type { FullJsonNode, JsonlRecord, JsonNode, PreviewJsonNode } from "../src";

declare const node: FullJsonNode;
declare const previewNode: PreviewJsonNode;

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
  node: previewNode,
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

const _objectNode: JsonNode = { kind: "object", children: {} };
const _arrayNode: JsonNode = { kind: "array", children: [] };
const _stringNode: JsonNode = { kind: "string", value: "value" };
const _truncatedNode: JsonNode = {
  kind: "object",
  value: { nested: true },
  truncated: true,
};
const _previewNode: JsonNode = {
  kind: "array",
  childCount: 3,
  preview: true,
};

// @ts-expect-error Expanded containers cannot retain a parallel raw value graph.
const _objectWithValue: JsonNode = { kind: "object", children: {}, value: {} };

// @ts-expect-error Primitive nodes cannot carry children.
const _primitiveWithChildren: JsonNode = { kind: "number", value: 1, children: [] };

// @ts-expect-error Truncated containers require the retained source value.
const _truncatedWithoutValue: JsonNode = { kind: "array", truncated: true };

// @ts-expect-error Preview containers require an explicit child count.
const _previewWithoutChildCount: JsonNode = { kind: "object", preview: true };

// @ts-expect-error Compact stringified previews do not retain the full raw string.
const _previewWithRawString: JsonNode = {
  kind: "string",
  value: "{}",
  stringifiedPreview: true,
  rawString: "{}",
};

// @ts-expect-error Full Records cannot carry compact Preview nodes.
const _fullWithPreviewNode: JsonlRecord = { ...full, node: previewNode };
