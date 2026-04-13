export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonNodeMeta {
  depth: number;
  expandable: boolean;
  restorable: boolean;
  recordId?: string;
  sourceLine?: number;
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

export interface JsonlRecord {
  id: string;
  lineNumber: number;
  node: JsonNode | null;
  error?: string;
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
