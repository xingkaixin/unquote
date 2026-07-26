export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";
export type JsonPrimitive = string | number | boolean | null;
export type JsonContainerKind = "object" | "array";

interface JsonNodeBase {
  rawString?: string;
}

export interface JsonObjectNode extends JsonNodeBase {
  kind: "object";
  children: Record<string, JsonNode>;
  value?: never;
  truncated?: never;
  preview?: never;
}

export interface JsonArrayNode extends JsonNodeBase {
  kind: "array";
  children: JsonNode[];
  value?: never;
  truncated?: never;
  preview?: never;
}

export interface TruncatedJsonObjectNode extends JsonNodeBase {
  kind: "object";
  value: Record<string, unknown>;
  truncated: true;
  children?: never;
  preview?: never;
}

export interface TruncatedJsonArrayNode extends JsonNodeBase {
  kind: "array";
  value: unknown[];
  truncated: true;
  children?: never;
  preview?: never;
}

export interface PreviewJsonObjectNode extends JsonNodeBase {
  kind: "object";
  childCount: number;
  preview: true;
  rawString?: never;
  children?: never;
  value?: never;
  truncated?: never;
}

export interface PreviewJsonArrayNode extends JsonNodeBase {
  kind: "array";
  childCount: number;
  preview: true;
  rawString?: never;
  children?: never;
  value?: never;
  truncated?: never;
}

interface JsonStringNodeBase {
  kind: "string";
  value: string;
  valueLength?: number;
  children?: never;
  truncated?: never;
  preview?: never;
}

export type JsonSourceStringNode = JsonStringNodeBase &
  (
    | { rawString?: never; stringifiedPreview?: never }
    | { rawString: string; stringifiedPreview?: never }
  );

export type PreviewStringifiedJsonNode = JsonStringNodeBase & {
  rawString?: never;
  stringifiedPreview: true;
};

export type JsonStringNode = JsonSourceStringNode | PreviewStringifiedJsonNode;

export interface JsonNumberNode extends JsonNodeBase {
  kind: "number";
  value: number;
  children?: never;
  truncated?: never;
  preview?: never;
}

export interface JsonBooleanNode extends JsonNodeBase {
  kind: "boolean";
  value: boolean;
  children?: never;
  truncated?: never;
  preview?: never;
}

export interface JsonNullNode extends JsonNodeBase {
  kind: "null";
  value: null;
  children?: never;
  truncated?: never;
  preview?: never;
}

export type JsonContainerNode =
  | JsonObjectNode
  | JsonArrayNode
  | TruncatedJsonObjectNode
  | TruncatedJsonArrayNode
  | PreviewJsonObjectNode
  | PreviewJsonArrayNode;

export type JsonNodeWithChildren = JsonObjectNode | JsonArrayNode;
export type TruncatedJsonNode = TruncatedJsonObjectNode | TruncatedJsonArrayNode;

export type FullJsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | TruncatedJsonObjectNode
  | TruncatedJsonArrayNode
  | JsonSourceStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

export type PreviewJsonNode =
  | PreviewJsonObjectNode
  | PreviewJsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

export type JsonNode = FullJsonNode | PreviewJsonNode;

export interface ParseErrorMeta {
  line: number;
  column: number;
  rawLine: string;
  context: string;
}

export interface JsonlRecordPreview {
  fields: Record<string, JsonPrimitive>;
  containers?: Record<string, JsonContainerKind>;
  nestedFieldKeys?: readonly string[];
}

interface JsonlRecordBase {
  id: string;
  lineNumber: number;
  summary: string;
}

export interface FullJsonlRecord extends JsonlRecordBase {
  status: "full";
  node: FullJsonNode;
  preview?: never;
  error?: never;
  errorMeta?: never;
  rawLine?: never;
}

export interface PreviewJsonlRecord extends JsonlRecordBase {
  status: "preview";
  node: PreviewJsonNode;
  preview?: JsonlRecordPreview;
  error?: never;
  errorMeta?: never;
  rawLine?: never;
}

export interface FailedJsonlRecord extends JsonlRecordBase {
  status: "failed";
  node: null;
  preview?: never;
  error: string;
  errorMeta: ParseErrorMeta;
  rawLine: string;
}

export type ParsedJsonlRecord = FullJsonlRecord | PreviewJsonlRecord;
export type JsonlRecord = ParsedJsonlRecord | FailedJsonlRecord;

export interface ParseStats {
  total: number;
  success: number;
  failed: number;
}

export interface ParseResult {
  format: "json" | "jsonl";
  records: JsonlRecord[];
  stats: ParseStats;
}

export interface ParseOptions {
  maxDepth?: number;
  forcedFormat?: "json" | "jsonl";
}

export interface FormatOptions {
  indent?: number;
}
