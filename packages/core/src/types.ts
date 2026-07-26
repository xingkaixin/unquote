export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";
export type JsonPrimitive = string | number | boolean | null;
export type JsonContainerKind = "object" | "array";

export interface JsonNodeMeta {
  depth: number;
  expandable: boolean;
  restorable: boolean;
  recordId?: string;
  sourceLine?: number;
  truncated?: boolean;
  valueLength?: number;
}

export interface JsonNode {
  kind: JsonKind;
  value: unknown;
  path: string[];
  wasStringified: boolean;
  rawString?: string;
  children?: Record<string, JsonNode> | JsonNode[];
  meta: JsonNodeMeta;
}

export interface ParseErrorMeta {
  line: number;
  column: number;
  rawLine: string;
  context: string;
}

export interface JsonlRecordPreview {
  fields: Record<string, JsonPrimitive>;
  containers?: Record<string, JsonContainerKind>;
  nestedFieldKeys?: string | string[];
}

interface JsonlRecordBase {
  id: string;
  lineNumber: number;
  summary: string;
}

export interface FullJsonlRecord extends JsonlRecordBase {
  status: "full";
  node: JsonNode;
  preview?: never;
  error?: never;
  errorMeta?: never;
  rawLine?: never;
}

export interface PreviewJsonlRecord extends JsonlRecordBase {
  status: "preview";
  node: JsonNode;
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
