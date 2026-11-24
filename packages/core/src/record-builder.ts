import { fastTrim, isStringifiedJson, mightBeStringifiedJson } from "./json-probe.js";
import {
  hasNonCanonicalJsonNumber,
  nativeToLosslessArray,
  nativeToLosslessObject,
  parseLosslessJson,
  parseNativeJson,
  type NativeJsonValue,
} from "./lossless-json.js";
import type {
  FullJsonNode,
  FullJsonlRecord,
  JsonContainerKind,
  JsonlRecordPreviewFieldValue,
  LosslessJsonValue,
  PreviewJsonlRecord,
  PreviewJsonNode,
} from "./types.js";
import { truncateAtCodePointBoundary } from "./utils.js";

const maxPreviewStringLength = 160;

const summaryKeys = ["timestamp", "type", "action", "event", "name", "message"] as const;

const setOwnProperty = <T>(target: Record<string, T>, key: string, value: T) => {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    return;
  }
  target[key] = value;
};

const summarizeLosslessPrimitive = (value: LosslessJsonValue) => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return truncateAtCodePointBoundary(value, 72) || '""';
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (value.type === "number") {
    return value.rawValue;
  }
  return value.type === "array"
    ? `Array(${value.items.length})`
    : `Object(${Object.keys(value.entries).length})`;
};

const summarizeNativePrimitive = (value: NativeJsonValue) => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return truncateAtCodePointBoundary(value, 72) || '""';
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  return `Object(${Object.keys(value).length})`;
};

const summarizeField = (key: string, value: LosslessJsonValue, maxLength: number) => {
  if (typeof value === "string") {
    const trimmed = fastTrim(value);
    if (trimmed) {
      return `${key}:${truncateAtCodePointBoundary(trimmed, maxLength)}`;
    }
    return null;
  }
  if (typeof value === "boolean") {
    return `${key}:${String(value)}`;
  }
  if (value !== null && typeof value === "object" && value.type === "number") {
    return `${key}:${value.rawValue}`;
  }
  return null;
};

const summarizeNativeField = (key: string, value: NativeJsonValue, maxLength: number) => {
  if (typeof value === "string") {
    const trimmed = fastTrim(value);
    if (trimmed) {
      return `${key}:${truncateAtCodePointBoundary(trimmed, maxLength)}`;
    }
    return null;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return `${key}:${String(value)}`;
  }
  return null;
};

const extractLosslessSummary = (value: LosslessJsonValue) => {
  if (value === null || typeof value !== "object" || value.type !== "object") {
    return summarizeLosslessPrimitive(value);
  }

  const entries = value.entries;
  let preferred: string | null = null;
  for (let index = 0; index < summaryKeys.length; index += 1) {
    const key = summaryKeys[index]!;
    if (!Object.hasOwn(entries, key)) {
      continue;
    }
    const summary = summarizeField(key, entries[key]!, 48);
    if (summary) {
      preferred = preferred === null ? summary : `${preferred} · ${summary}`;
    }
  }
  if (preferred !== null) {
    return preferred;
  }

  let count = 0;
  for (const key in entries) {
    if (!Object.hasOwn(entries, key)) {
      continue;
    }
    count += 1;
    const summary = summarizeField(key, entries[key]!, 72);
    if (summary) {
      return summary;
    }
  }
  return `Object(${count})`;
};

const extractNativeSummary = (value: NativeJsonValue) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return summarizeNativePrimitive(value);
  }

  let preferred: string | null = null;
  for (let index = 0; index < summaryKeys.length; index += 1) {
    const key = summaryKeys[index]!;
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const summary = summarizeNativeField(key, value[key]!, 48);
    if (summary) {
      preferred = preferred === null ? summary : `${preferred} · ${summary}`;
    }
  }
  if (preferred !== null) {
    return preferred;
  }

  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    count += 1;
    const summary = summarizeNativeField(key, value[key]!, 72);
    if (summary) {
      return summary;
    }
  }
  return `Object(${count})`;
};

const toNode = (
  value: LosslessJsonValue,
  depth: number,
  maxDepth: number,
  rawString?: string,
): FullJsonNode => {
  if (value !== null && typeof value === "object" && value.type === "object") {
    if (depth >= maxDepth) {
      return rawString === undefined
        ? { kind: "object", value, truncated: true }
        : { kind: "object", value, truncated: true, rawString };
    }

    const children: Record<string, FullJsonNode> = {};
    const entries = value.entries;
    for (const key in entries) {
      if (Object.hasOwn(entries, key)) {
        setOwnProperty(children, key, buildNode(entries[key]!, depth + 1, maxDepth));
      }
    }

    return rawString === undefined
      ? { kind: "object", children }
      : { kind: "object", children, rawString };
  }

  if (value !== null && typeof value === "object" && value.type === "array") {
    if (depth >= maxDepth) {
      return rawString === undefined
        ? { kind: "array", value, truncated: true }
        : { kind: "array", value, truncated: true, rawString };
    }

    const items = value.items;
    const children: FullJsonNode[] = [];
    for (let index = 0; index < items.length; index += 1) {
      children.push(buildNode(items[index]!, depth + 1, maxDepth));
    }

    return rawString === undefined
      ? { kind: "array", children }
      : { kind: "array", children, rawString };
  }

  if (value === null) {
    return rawString === undefined ? { kind: "null", value } : { kind: "null", value, rawString };
  }
  if (typeof value === "string") {
    return rawString === undefined
      ? { kind: "string", value }
      : { kind: "string", value, rawString };
  }
  if (typeof value === "object") {
    return rawString === undefined
      ? { kind: "number", value: Number(value.rawValue), rawValue: value.rawValue }
      : { kind: "number", value: Number(value.rawValue), rawValue: value.rawValue, rawString };
  }
  if (typeof value === "boolean") {
    return rawString === undefined
      ? { kind: "boolean", value }
      : { kind: "boolean", value, rawString };
  }

  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
};

const toNativeNode = (
  value: NativeJsonValue,
  depth: number,
  maxDepth: number,
  rawString?: string,
): FullJsonNode => {
  if (value === null) {
    return rawString === undefined ? { kind: "null", value } : { kind: "null", value, rawString };
  }
  if (typeof value === "string") {
    return rawString === undefined
      ? { kind: "string", value }
      : { kind: "string", value, rawString };
  }
  if (typeof value === "number") {
    const rawValue = String(value);
    return rawString === undefined
      ? { kind: "number", value, rawValue }
      : { kind: "number", value, rawValue, rawString };
  }
  if (typeof value === "boolean") {
    return rawString === undefined
      ? { kind: "boolean", value }
      : { kind: "boolean", value, rawString };
  }
  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      const lossless = nativeToLosslessArray(value);
      return rawString === undefined
        ? { kind: "array", value: lossless, truncated: true }
        : { kind: "array", value: lossless, truncated: true, rawString };
    }

    const children: FullJsonNode[] = [];
    for (let index = 0; index < value.length; index += 1) {
      children.push(buildNativeNode(value[index]!, depth + 1, maxDepth));
    }

    return rawString === undefined
      ? { kind: "array", children }
      : { kind: "array", children, rawString };
  }

  if (depth >= maxDepth) {
    const lossless = nativeToLosslessObject(value);
    return rawString === undefined
      ? { kind: "object", value: lossless, truncated: true }
      : { kind: "object", value: lossless, truncated: true, rawString };
  }

  const children: Record<string, FullJsonNode> = {};
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      setOwnProperty(children, key, buildNativeNode(value[key]!, depth + 1, maxDepth));
    }
  }

  return rawString === undefined
    ? { kind: "object", children }
    : { kind: "object", children, rawString };
};

type ParsedStringifiedLayer =
  | { native: true; value: NativeJsonValue }
  | { native: false; value: LosslessJsonValue };

const parseStringifiedJsonLayers = (value: string): ParsedStringifiedLayer | undefined => {
  let current = value;
  let hasParsedLayer = false;

  while (true) {
    const trimmed = fastTrim(current);
    if (!trimmed || !mightBeStringifiedJson(trimmed)) {
      return hasParsedLayer ? { native: true, value: current } : undefined;
    }

    try {
      if (!hasNonCanonicalJsonNumber(trimmed)) {
        const parsed = parseNativeJson(trimmed);
        hasParsedLayer = true;
        if (typeof parsed !== "string" || parsed === current) {
          return { native: true, value: parsed };
        }
        current = parsed;
      } else {
        const parsed = parseLosslessJson(trimmed);
        hasParsedLayer = true;
        if (typeof parsed !== "string" || parsed === current) {
          return { native: false, value: parsed };
        }
        current = parsed;
      }
    } catch {
      return hasParsedLayer ? { native: true, value: current } : undefined;
    }
  }
};

const maybeExpandString = (value: string, depth: number, maxDepth: number) => {
  if (depth > maxDepth) {
    return null;
  }

  const parsed = parseStringifiedJsonLayers(value);
  if (parsed === undefined) {
    return null;
  }
  return parsed.native
    ? toNativeNode(parsed.value, depth, maxDepth, value)
    : toNode(parsed.value, depth, maxDepth, value);
};

const buildNode = (value: LosslessJsonValue, depth: number, maxDepth: number): FullJsonNode => {
  if (typeof value === "string") {
    const expanded = maybeExpandString(value, depth, maxDepth);
    if (expanded) {
      return expanded;
    }
  }

  return toNode(value, depth, maxDepth);
};

const buildNativeNode = (value: NativeJsonValue, depth: number, maxDepth: number): FullJsonNode => {
  if (typeof value === "string") {
    const expanded = maybeExpandString(value, depth, maxDepth);
    if (expanded) {
      return expanded;
    }
  }

  return toNativeNode(value, depth, maxDepth);
};

export const createFullJsonlRecord = (
  value: LosslessJsonValue,
  lineNumber: number,
  maxDepth: number,
): FullJsonlRecord => ({
  status: "full",
  id: `record-${lineNumber}`,
  lineNumber,
  node: buildNode(value, 0, maxDepth),
  summary: extractLosslessSummary(value),
});

export const createFullJsonlRecordFromNative = (
  value: NativeJsonValue,
  lineNumber: number,
  maxDepth: number,
): FullJsonlRecord => ({
  status: "full",
  id: `record-${lineNumber}`,
  lineNumber,
  node: buildNativeNode(value, 0, maxDepth),
  summary: extractNativeSummary(value),
});

const truncatePreviewString = (value: string) =>
  truncateAtCodePointBoundary(value, maxPreviewStringLength);

const createPreviewNode = (value: LosslessJsonValue): PreviewJsonNode => {
  if (value === null) {
    return { kind: "null", value };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }
  if (typeof value === "string") {
    const valueLength = value.length;
    const truncated = truncatePreviewString(value);
    if (isStringifiedJson(value)) {
      return valueLength > maxPreviewStringLength
        ? { kind: "string", value: truncated, stringifiedPreview: true, valueLength }
        : { kind: "string", value: truncated, stringifiedPreview: true };
    }
    return valueLength > maxPreviewStringLength
      ? { kind: "string", value: truncated, valueLength }
      : { kind: "string", value: truncated };
  }
  if (value.type === "number") {
    return { kind: "number", value: Number(value.rawValue), rawValue: value.rawValue };
  }
  if (value.type === "object") {
    return { kind: "object", childCount: Object.keys(value.entries).length, preview: true };
  }
  return { kind: "array", childCount: value.items.length, preview: true };
};

const createNativePreviewNode = (value: NativeJsonValue): PreviewJsonNode => {
  if (value === null) {
    return { kind: "null", value };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }
  if (typeof value === "string") {
    const valueLength = value.length;
    const truncated = truncatePreviewString(value);
    if (isStringifiedJson(value)) {
      return valueLength > maxPreviewStringLength
        ? { kind: "string", value: truncated, stringifiedPreview: true, valueLength }
        : { kind: "string", value: truncated, stringifiedPreview: true };
    }
    return valueLength > maxPreviewStringLength
      ? { kind: "string", value: truncated, valueLength }
      : { kind: "string", value: truncated };
  }
  if (typeof value === "number") {
    return { kind: "number", value, rawValue: String(value) };
  }
  if (Array.isArray(value)) {
    return { kind: "array", childCount: value.length, preview: true };
  }
  return {
    kind: "object",
    childCount: Object.keys(value).length,
    preview: true,
  };
};

const createRecordPreview = (value: LosslessJsonValue) => {
  if (!value || typeof value !== "object" || value.type !== "object") {
    return undefined;
  }

  const fields: Record<string, JsonlRecordPreviewFieldValue> = {};
  let containers: Record<string, JsonContainerKind> | undefined;
  let nestedFieldKeys: string[] | undefined;
  let hasEntries = false;

  const entries = value.entries;
  for (const key in entries) {
    if (!Object.hasOwn(entries, key)) {
      continue;
    }
    hasEntries = true;
    const child = entries[key]!;
    if (child !== null && typeof child === "object") {
      if (child.type === "number") {
        setOwnProperty(fields, key, child);
      } else {
        containers ??= {};
        setOwnProperty(containers, key, child.type);
      }
      continue;
    }

    setOwnProperty(fields, key, typeof child === "string" ? truncatePreviewString(child) : child);
    if (typeof child === "string" && isStringifiedJson(child)) {
      nestedFieldKeys ??= [];
      nestedFieldKeys.push(key);
    }
  }

  if (!hasEntries) {
    return undefined;
  }

  return {
    fields,
    ...(containers ? { containers } : {}),
    ...(nestedFieldKeys ? { nestedFieldKeys } : {}),
  };
};

const createNativeRecordPreview = (value: NativeJsonValue) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const fields: Record<string, JsonlRecordPreviewFieldValue> = {};
  let containers: Record<string, JsonContainerKind> | undefined;
  let nestedFieldKeys: string[] | undefined;
  let hasEntries = false;

  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    hasEntries = true;
    const child = value[key]!;
    if (child !== null && typeof child === "object") {
      containers ??= {};
      setOwnProperty(containers, key, Array.isArray(child) ? "array" : "object");
      continue;
    }
    if (typeof child === "number") {
      setOwnProperty(fields, key, { type: "number", rawValue: String(child) });
      continue;
    }
    if (typeof child === "string") {
      setOwnProperty(fields, key, truncatePreviewString(child));
      if (isStringifiedJson(child)) {
        nestedFieldKeys ??= [];
        nestedFieldKeys.push(key);
      }
      continue;
    }

    setOwnProperty(fields, key, child);
  }

  if (!hasEntries) {
    return undefined;
  }

  return {
    fields,
    ...(containers ? { containers } : {}),
    ...(nestedFieldKeys ? { nestedFieldKeys } : {}),
  };
};

export const createPreviewJsonlRecord = (
  value: LosslessJsonValue,
  lineNumber: number,
): PreviewJsonlRecord => {
  const preview = createRecordPreview(value);
  return {
    status: "preview",
    id: `record-${lineNumber}`,
    lineNumber,
    node: createPreviewNode(value),
    ...(preview ? { preview } : {}),
    summary: extractLosslessSummary(value),
  };
};

export const createPreviewJsonlRecordFromNative = (
  value: NativeJsonValue,
  lineNumber: number,
): PreviewJsonlRecord => {
  const preview = createNativeRecordPreview(value);
  return {
    status: "preview",
    id: `record-${lineNumber}`,
    lineNumber,
    node: createNativePreviewNode(value),
    ...(preview ? { preview } : {}),
    summary: extractNativeSummary(value),
  };
};
