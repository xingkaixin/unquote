export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

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

export interface JsonlRecord {
  id: string;
  lineNumber: number;
  node: JsonNode | null;
  deferred?: boolean;
  error?: string;
  errorMeta?: ParseErrorMeta;
  rawLine?: string;
  summary: string;
}

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
