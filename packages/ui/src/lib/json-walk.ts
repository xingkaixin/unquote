import {
  DEFAULT_MAX_DEPTH,
  hasJsonNodeChildren,
  isStringifiedNode,
  mightBeStringifiedJson,
  truncateAtCodePointBoundary,
} from "@unquote/core";
import type { JsonKind, JsonNode } from "@unquote/core";
import { appendJsonPathSegment } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

export interface JsonWalkValueMap {
  object: unknown;
  array: unknown[] | null;
  string: string;
  number: number | string;
  boolean: boolean;
  null: null;
}

interface JsonNodeWalkValueMap extends JsonWalkValueMap {
  object: null;
  array: null;
}

interface RawJsonWalkValueMap extends JsonWalkValueMap {
  object: object | undefined | symbol | bigint;
  array: unknown[];
  number: number;
}

type JsonWalkValue<TValues extends JsonWalkValueMap> = {
  [TKind in JsonKind]: { kind: TKind; value: TValues[TKind] };
}[JsonKind];

type ResolvedJsonValue<T, TValues extends JsonWalkValueMap> = JsonWalkValue<TValues> & {
  node: T;
  wasStringified: boolean;
  childCount: number;
  children?: T[] | Record<string, T>;
  valueLength?: number;
};

type JsonValueResolver<T, TValues extends JsonWalkValueMap> = (
  node: T,
  depth: number,
) => ResolvedJsonValue<T, TValues>;

interface JsonValueWalkMetadata<T> {
  node: T;
  childCount: number;
  valueLength?: number;
  jsonPath: string;
  stringifiedChain: string[];
  // Shared walk-scoped view; copy before retaining it beyond the visitor call.
  pathSegments: readonly TreePathSegment[];
}

export type JsonValueWalkContext<
  T,
  TValues extends JsonWalkValueMap = JsonWalkValueMap,
> = JsonWalkValue<TValues> & JsonValueWalkMetadata<T>;

export type JsonWalkContext = JsonValueWalkContext<JsonNode, JsonNodeWalkValueMap>;
export type RawJsonWalkContext = JsonValueWalkContext<unknown, RawJsonWalkValueMap>;
export type JsonNodeVisitor = (ctx: JsonWalkContext) => boolean | void;
type RawJsonValueVisitor = (ctx: RawJsonWalkContext) => boolean | void;

export const maxStringValueLabelLength = 512;

export interface JsonWalkStart {
  jsonPath?: string;
  stringifiedAncestors?: string[];
  pathSegments?: readonly TreePathSegment[];
}

const resolveJsonNode: JsonValueResolver<JsonNode, JsonNodeWalkValueMap> = (node) => {
  if (hasJsonNodeChildren(node)) {
    return {
      node,
      value: null,
      kind: node.kind,
      wasStringified: isStringifiedNode(node),
      childCount: Array.isArray(node.children)
        ? node.children.length
        : Object.keys(node.children).length,
      children: node.children,
    };
  }

  if (node.kind === "object" || node.kind === "array") {
    const value = null;
    return {
      node,
      value,
      kind: node.kind,
      wasStringified: isStringifiedNode(node),
      childCount: node.preview
        ? node.childCount
        : node.kind === "array"
          ? node.value.items.length
          : Object.keys(node.value.entries).length,
    };
  }

  const shared = { node, wasStringified: isStringifiedNode(node), childCount: 0 };
  switch (node.kind) {
    case "string":
      return {
        ...shared,
        kind: "string",
        value: node.value,
        ...(typeof node.valueLength === "number" ? { valueLength: node.valueLength } : {}),
      };
    case "number":
      return { ...shared, kind: "number", value: node.rawValue ?? node.value };
    case "boolean":
      return { ...shared, kind: "boolean", value: node.value };
    case "null":
      return { ...shared, kind: "null", value: null };
  }
};

const parseStringifiedValue = (value: string, depth: number) => {
  if (depth > DEFAULT_MAX_DEPTH || !mightBeStringifiedJson(value)) {
    return null;
  }

  try {
    return { value: JSON.parse(value) as unknown };
  } catch {
    return null;
  }
};

const resolveRawJsonValue: JsonValueResolver<unknown, RawJsonWalkValueMap> = (node, depth) => {
  const parsed = typeof node === "string" ? parseStringifiedValue(node, depth) : null;
  const value = parsed ? parsed.value : node;
  const canDescend = depth < DEFAULT_MAX_DEPTH;
  const shared = { node, wasStringified: Boolean(parsed) };

  if (value === null) {
    return { ...shared, kind: "null", value: null, childCount: 0 };
  }
  if (Array.isArray(value)) {
    return {
      ...shared,
      kind: "array",
      value,
      childCount: value.length,
      ...(canDescend ? { children: value } : {}),
    };
  }
  switch (typeof value) {
    case "string":
      return { ...shared, kind: "string", value, childCount: 0 };
    case "number":
      return { ...shared, kind: "number", value, childCount: 0 };
    case "boolean":
      return { ...shared, kind: "boolean", value, childCount: 0 };
    default: {
      const childCount = value ? Object.keys(value).length : 0;
      return {
        ...shared,
        kind: "object",
        value,
        childCount,
        ...(canDescend && childCount > 0 ? { children: value as Record<string, unknown> } : {}),
      };
    }
  }
};

const walkJsonValue = <T, TValues extends JsonWalkValueMap>(
  root: T,
  resolveValue: JsonValueResolver<T, TValues>,
  visit: (ctx: JsonValueWalkContext<T, TValues>) => boolean | void,
  start: JsonWalkStart,
) => {
  const pathSegments = [...(start.pathSegments ?? [])];

  function walk(node: T, jsonPath: string, stringifiedAncestors: string[], depth: number) {
    const resolved = resolveValue(node, depth);
    const stringifiedChain = resolved.wasStringified
      ? [...stringifiedAncestors, jsonPath]
      : stringifiedAncestors;
    // The resolver already validated this pair; copying generic union fields loses its correlation.
    const context = {
      node: resolved.node,
      kind: resolved.kind,
      value: resolved.value,
      childCount: resolved.childCount,
      ...(typeof resolved.valueLength === "number" ? { valueLength: resolved.valueLength } : {}),
      jsonPath,
      stringifiedChain,
      pathSegments,
    } as JsonValueWalkContext<T, TValues>;

    if (visit(context) === false || !resolved.children) {
      return;
    }

    if (Array.isArray(resolved.children)) {
      resolved.children.forEach((child, index) => {
        const segment = { kind: "index", value: String(index) } satisfies TreePathSegment;
        pathSegments.push(segment);
        walk(child, appendJsonPathSegment(jsonPath, segment), stringifiedChain, depth + 1);
        pathSegments.pop();
      });
      return;
    }

    for (const [key, child] of Object.entries(resolved.children)) {
      const segment = { kind: "key", value: key } satisfies TreePathSegment;
      pathSegments.push(segment);
      walk(child, appendJsonPathSegment(jsonPath, segment), stringifiedChain, depth + 1);
      pathSegments.pop();
    }
  }

  walk(root, start.jsonPath ?? "$", start.stringifiedAncestors ?? [], 0);
};

const formatStringLabel = (
  value: string,
  maxLength = Number.POSITIVE_INFINITY,
  originalLength = value.length,
) => {
  if (value.length <= maxLength && value.length === originalLength) {
    return JSON.stringify(value);
  }

  const truncated = truncateAtCodePointBoundary(value, maxLength);
  return `${JSON.stringify(`${truncated}...`)} (${originalLength} chars)`;
};

type JsonValueLabelInput = JsonWalkValue<JsonWalkValueMap> & {
  childCount: number;
  valueLength?: number;
};

export const formatJsonValueLabel = (value: JsonValueLabelInput, maxStringLength?: number) => {
  switch (value.kind) {
    case "object":
      return `{${value.childCount}}`;
    case "array":
      return `[${value.childCount}]`;
    case "string":
      return formatStringLabel(
        value.value,
        maxStringLength,
        value.valueLength ?? value.value.length,
      );
    case "null":
      return "null";
    default:
      return String(value.value);
  }
};

export const getSearchableJsonValueLabelLength = (
  value: JsonValueLabelInput,
  maxStringLength: number,
) => {
  const label = formatJsonValueLabel(value, maxStringLength);
  if (value.kind !== "string") {
    return label.length;
  }

  const stringValue = value.value;
  const originalLength = value.valueLength ?? stringValue.length;
  if (stringValue.length <= maxStringLength && stringValue.length === originalLength) {
    return label.length;
  }

  return JSON.stringify(truncateAtCodePointBoundary(stringValue, maxStringLength)).length - 1;
};

export const walkJsonNode = (root: JsonNode, visit: JsonNodeVisitor, start: JsonWalkStart = {}) =>
  walkJsonValue(root, resolveJsonNode, visit, start);

export const walkRawJsonValue = (
  root: unknown,
  visit: RawJsonValueVisitor,
  start: JsonWalkStart = {},
) => walkJsonValue(root, resolveRawJsonValue, visit, start);
