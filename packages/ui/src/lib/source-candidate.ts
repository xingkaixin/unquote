export type SourceMode = "auto" | "json" | "jsonl";

export type SourceCandidate =
  | { kind: "text"; text: string; mode: SourceMode }
  | { kind: "file"; file: File; mode: SourceMode };
