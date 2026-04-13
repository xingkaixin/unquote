import type { JsonKind } from "./types";

export const DEFAULT_MAX_DEPTH = 10;

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

export const isLikelyJsonl = (input: string) => {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  let valid = 0;
  for (const line of lines) {
    try {
      parseJson(line);
      valid += 1;
    } catch {
      return false;
    }
  }

  return valid === lines.length;
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
