import { isStringifiedJson } from "./json-probe.js";
import { parseLosslessJson } from "./lossless-json.js";
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

const summarizeField = (key: string, value: LosslessJsonValue, maxLength: number) => {
  if (typeof value === "string" && value.trim()) {
    return `${key}:${truncateAtCodePointBoundary(value.trim(), maxLength)}`;
  }
  if (typeof value === "boolean") {
    return `${key}:${String(value)}`;
  }
  if (value !== null && typeof value === "object" && value.type === "number") {
    return `${key}:${value.rawValue}`;
  }
  return null;
};

const extractLosslessSummary = (value: LosslessJsonValue) => {
  if (value === null || typeof value !== "object" || value.type !== "object") {
    return summarizeLosslessPrimitive(value);
  }

  const preferred = summaryKeys.flatMap((key) => {
    const field = value.entries[key];
    const summary = field === undefined ? null : summarizeField(key, field, 48);
    return summary ? [summary] : [];
  });
  if (preferred.length > 0) {
    return preferred.join(" · ");
  }

  for (const [key, field] of Object.entries(value.entries)) {
    const summary = summarizeField(key, field, 72);
    if (summary) {
      return summary;
    }
  }
  return `Object(${Object.keys(value.entries).length})`;
};

const toNode = (
  value: LosslessJsonValue,
  depth: number,
  maxDepth: number,
  rawString?: string,
): FullJsonNode => {
  const source = rawString === undefined ? {} : { rawString };

  if (value !== null && typeof value === "object" && value.type === "object") {
    if (depth >= maxDepth) {
      return {
        kind: "object",
        value,
        truncated: true,
        ...source,
      };
    }

    const children = Object.fromEntries(
      Object.entries(value.entries).map(([key, childValue]) => [
        key,
        buildNode(childValue, depth + 1, maxDepth),
      ]),
    );

    return {
      kind: "object",
      children,
      ...source,
    };
  }

  if (value !== null && typeof value === "object" && value.type === "array") {
    if (depth >= maxDepth) {
      return {
        kind: "array",
        value,
        truncated: true,
        ...source,
      };
    }

    const children = value.items.map((childValue) => buildNode(childValue, depth + 1, maxDepth));

    return {
      kind: "array",
      children,
      ...source,
    };
  }

  if (value === null) {
    return { kind: "null", value, ...source };
  }
  if (typeof value === "string") {
    return { kind: "string", value, ...source };
  }
  if (typeof value === "object") {
    return { kind: "number", value: Number(value.rawValue), rawValue: value.rawValue, ...source };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value, ...source };
  }

  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
};

const parseStringifiedJsonLayers = (value: string): LosslessJsonValue | undefined => {
  let current = value;
  let hasParsedLayer = false;

  while (true) {
    const trimmed = current.trim();
    if (!trimmed) {
      return hasParsedLayer ? current : undefined;
    }

    try {
      const parsed = parseLosslessJson(trimmed);
      hasParsedLayer = true;
      if (typeof parsed !== "string" || parsed === current) {
        return parsed;
      }
      current = parsed;
    } catch {
      return hasParsedLayer ? current : undefined;
    }
  }
};

const maybeExpandString = (value: string, depth: number, maxDepth: number) => {
  if (depth > maxDepth) {
    return null;
  }

  const parsed = parseStringifiedJsonLayers(value);
  return parsed === undefined ? null : toNode(parsed, depth, maxDepth, value);
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

export const createFullJsonlRecord = (
  value: LosslessJsonValue,
  lineNumber: number,
  maxDepth: number,
): FullJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = buildNode(value, 0, maxDepth);

  return {
    status: "full",
    id,
    lineNumber,
    node,
    summary: extractLosslessSummary(value),
  };
};

const truncatePreviewString = (value: string) =>
  truncateAtCodePointBoundary(value, maxPreviewStringLength);

const projectPreviewNode = (node: FullJsonNode): PreviewJsonNode => {
  if (node.rawString !== undefined) {
    const valueLength = node.rawString.length;
    return {
      kind: "string",
      value: truncatePreviewString(node.rawString),
      stringifiedPreview: true,
      ...(valueLength > maxPreviewStringLength ? { valueLength } : {}),
    };
  }
  if (node.kind === "object") {
    const childCount =
      node.children === undefined
        ? Object.keys(node.value.entries).length
        : Object.keys(node.children).length;
    return { kind: "object", childCount, preview: true };
  }

  if (node.kind === "array") {
    const childCount = node.children === undefined ? node.value.items.length : node.children.length;
    return { kind: "array", childCount, preview: true };
  }

  if (node.kind === "string") {
    const valueLength = node.value.length;
    return {
      kind: "string",
      value: truncatePreviewString(node.value),
      ...(valueLength > maxPreviewStringLength ? { valueLength } : {}),
    };
  }

  return node;
};

const createRecordPreview = (value: LosslessJsonValue) => {
  if (!value || typeof value !== "object" || value.type !== "object") {
    return undefined;
  }

  const fields: Array<[string, JsonlRecordPreviewFieldValue]> = [];
  const containers: Array<[string, JsonContainerKind]> = [];
  const nestedFieldKeys: string[] = [];

  for (const [key, child] of Object.entries(value.entries)) {
    if (child !== null && typeof child === "object") {
      if (child.type === "number") {
        fields.push([key, child]);
      } else {
        containers.push([key, child.type]);
      }
      continue;
    }

    fields.push([key, typeof child === "string" ? truncatePreviewString(child) : child]);
    if (typeof child === "string" && isStringifiedJson(child)) {
      nestedFieldKeys.push(key);
    }
  }

  if (fields.length === 0 && containers.length === 0) {
    return undefined;
  }

  // Collected as entries because assigning `preview[key]` would route a JSON
  // key named `__proto__` into the prototype setter instead of a property.
  return {
    fields: Object.fromEntries(fields),
    ...(containers.length > 0 ? { containers: Object.fromEntries(containers) } : {}),
    ...(nestedFieldKeys.length > 0 ? { nestedFieldKeys } : {}),
  };
};

export const createPreviewJsonlRecord = (
  value: LosslessJsonValue,
  lineNumber: number,
): PreviewJsonlRecord => {
  const id = `record-${lineNumber}`;
  const node = projectPreviewNode(buildNode(value, 0, 0));
  const preview = createRecordPreview(value);

  return {
    status: "preview",
    id,
    lineNumber,
    node,
    ...(preview ? { preview } : {}),
    summary: extractLosslessSummary(value),
  };
};
