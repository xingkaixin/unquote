import { hasJsonNodeChildren, isStringifiedNode, truncateAtCodePointBoundary } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { appendJsonPathSegment } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

type JsonWalkValue =
  | { kind: "object" | "array"; value: null }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number | string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null"; value: null };

type ResolvedJsonValue = JsonWalkValue & {
  node: JsonNode;
  wasStringified: boolean;
  childCount: number;
  children?: JsonNode[] | Record<string, JsonNode>;
  valueLength?: number;
};

interface JsonWalkMetadata {
  node: JsonNode;
  childCount: number;
  valueLength?: number;
  jsonPath: string;
  stringifiedChain: string[];
  // Shared walk-scoped view; copy before retaining it beyond the visitor call.
  pathSegments: readonly TreePathSegment[];
}

export type JsonWalkContext = JsonWalkValue & JsonWalkMetadata;
export type JsonNodeVisitor = (ctx: JsonWalkContext) => boolean | void;

export const maxStringValueLabelLength = 512;

export interface JsonWalkStart {
  jsonPath?: string;
  stringifiedAncestors?: string[];
  pathSegments?: readonly TreePathSegment[];
}

const resolveJsonNode = (node: JsonNode): ResolvedJsonValue => {
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

export const walkJsonNode = (root: JsonNode, visit: JsonNodeVisitor, start: JsonWalkStart = {}) => {
  const pathSegments = [...(start.pathSegments ?? [])];

  function walk(node: JsonNode, jsonPath: string, stringifiedAncestors: string[]) {
    const resolved = resolveJsonNode(node);
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
    } as JsonWalkContext;

    if (visit(context) === false || !resolved.children) {
      return;
    }

    if (Array.isArray(resolved.children)) {
      resolved.children.forEach((child, index) => {
        const segment = { kind: "index", value: String(index) } satisfies TreePathSegment;
        pathSegments.push(segment);
        walk(child, appendJsonPathSegment(jsonPath, segment), stringifiedChain);
        pathSegments.pop();
      });
      return;
    }

    for (const [key, child] of Object.entries(resolved.children)) {
      const segment = { kind: "key", value: key } satisfies TreePathSegment;
      pathSegments.push(segment);
      walk(child, appendJsonPathSegment(jsonPath, segment), stringifiedChain);
      pathSegments.pop();
    }
  }

  walk(root, start.jsonPath ?? "$", start.stringifiedAncestors ?? []);
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

type JsonValueLabelInput = JsonWalkValue & {
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
