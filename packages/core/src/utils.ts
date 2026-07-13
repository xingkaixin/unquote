import type { JsonKind } from "./types";

export const DEFAULT_MAX_DEPTH = 100;

const SUMMARY_KEYS = ["timestamp", "type", "action", "event", "name", "message"] as const;

export const getJsonKind = (value: unknown): JsonKind => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
};

export const isJsonContainer = (value: unknown) => value !== null && typeof value === "object";

export const parseJson = (input: string) => JSON.parse(input) as unknown;

export interface JsonlProbeResult {
  sampledLines: number;
  parsableLines: number;
  isLikelyJsonl: boolean;
}

/**
 * Samples the first non-empty lines and checks whether each parses as JSON.
 * Single source of truth for "does this look like JSONL" — shared by
 * `detectFormat` and the UI's streaming-channel decision, so the verdict is
 * the same on both sides. Probing only picks the channel; final correctness
 * is guaranteed by parsing itself.
 */
export const probeJsonl = (input: string, sampleLimit = 8): JsonlProbeResult => {
  const lines: string[] = [];
  let start = 0;

  // charCodeAt scan instead of split: avoids copying the whole (possibly
  // huge) input just to look at the first few lines. Handles \r\n via the
  // trailing-\r check.
  for (let index = 0; index <= input.length && lines.length < sampleLimit; index += 1) {
    if (index < input.length && input.charCodeAt(index) !== 10) {
      continue;
    }

    const end = index > start && input.charCodeAt(index - 1) === 13 ? index - 1 : index;
    const line = input.slice(start, end).trim();
    if (line) {
      lines.push(line);
    }
    start = index + 1;
  }

  let parsableLines = 0;
  for (const line of lines) {
    try {
      parseJson(line);
      parsableLines += 1;
    } catch {
      // keep counting: parsableLines reports how many sampled lines parse
    }
  }

  return {
    sampledLines: lines.length,
    parsableLines,
    isLikelyJsonl: lines.length >= 2 && parsableLines === lines.length,
  };
};

export const extractSummary = (value: unknown) => {
  if (!isJsonContainer(value) || Array.isArray(value)) {
    return summarizePrimitive(value);
  }

  const objectValue = value as Record<string, unknown>;
  const parts = SUMMARY_KEYS.flatMap((key) => {
    const field = objectValue[key];
    if (typeof field === "string" && field.trim()) {
      return `${key}:${field.trim().slice(0, 48)}`;
    }
    if (typeof field === "number" || typeof field === "boolean") {
      return `${key}:${String(field)}`;
    }
    return [];
  });

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  for (const [key, field] of Object.entries(objectValue)) {
    if (typeof field === "string" && field.trim()) {
      return `${key}:${field.trim().slice(0, 72)}`;
    }
    if (typeof field === "number" || typeof field === "boolean") {
      return `${key}:${String(field)}`;
    }
  }

  return `Object(${Object.keys(objectValue).length})`;
};

export const summarizePrimitive = (value: unknown) => {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value.slice(0, 72) || '""';
  }

  return String(value);
};
