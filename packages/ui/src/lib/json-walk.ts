import {
  DEFAULT_MAX_DEPTH,
  getJsonKind,
  hasJsonNodeChildren,
  isStringifiedNode,
  truncateAtCodePointBoundary,
} from "@unquote/core";
import type { JsonKind, JsonNode } from "@unquote/core";
import { appendJsonPathSegment } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

interface ResolvedJsonValue<T> {
  node: T;
  value: unknown;
  kind: JsonKind;
  wasStringified: boolean;
  childCount: number;
  children?: T[] | Record<string, T>;
  valueLength?: number;
}

type JsonValueResolver<T> = (node: T, depth: number) => ResolvedJsonValue<T>;

export interface JsonValueWalkContext<T> {
  node: T;
  value: unknown;
  kind: JsonKind;
  childCount: number;
  valueLength?: number;
  jsonPath: string;
  stringifiedChain: string[];
  // Shared walk-scoped view; copy before retaining it beyond the visitor call.
  pathSegments: readonly TreePathSegment[];
}

export type JsonWalkContext = JsonValueWalkContext<JsonNode>;
export type JsonNodeVisitor = (ctx: JsonWalkContext) => boolean | void;
type RawJsonValueVisitor = (ctx: JsonValueWalkContext<unknown>) => boolean | void;

export const maxStringValueLabelLength = 512;

export interface JsonWalkStart {
  jsonPath?: string;
  stringifiedAncestors?: string[];
  pathSegments?: readonly TreePathSegment[];
}

const childCountFor = (kind: JsonKind, value: unknown) => {
  if (kind === "array") {
    return (value as unknown[]).length;
  }
  if (kind === "object" && value) {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
};

const resolveJsonNode: JsonValueResolver<JsonNode> = (node) => {
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

  return {
    node,
    value: node.kind === "number" ? (node.rawValue ?? node.value) : node.value,
    kind: node.kind,
    wasStringified: isStringifiedNode(node),
    childCount: 0,
    ...(node.kind === "string" && typeof node.valueLength === "number"
      ? { valueLength: node.valueLength }
      : {}),
  };
};

const isJsonWhitespace = (character: string) =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

const skipJsonWhitespace = (value: string, start: number) => {
  let index = start;
  while (index < value.length && isJsonWhitespace(value[index]!)) {
    index++;
  }
  return index;
};

const hasOnlyTrailingJsonWhitespace = (value: string, start: number) =>
  skipJsonWhitespace(value, start) === value.length;

const hasJsonLiteral = (value: string, start: number, literal: string) =>
  value.startsWith(literal, start) && hasOnlyTrailingJsonWhitespace(value, start + literal.length);

const hasJsonNumber = (value: string, start: number) => {
  let index = start;

  if (value[index] === "-") {
    index++;
  }

  if (value[index] === "0") {
    index++;
  } else {
    const integerStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === integerStart) {
      return false;
    }
  }

  if (value[index] === ".") {
    index++;
    const fractionStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === fractionStart) {
      return false;
    }
  }

  if (value[index] === "e" || value[index] === "E") {
    index++;
    if (value[index] === "+" || value[index] === "-") {
      index++;
    }
    const exponentStart = index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") {
      index++;
    }
    if (index === exponentStart) {
      return false;
    }
  }

  return hasOnlyTrailingJsonWhitespace(value, index);
};

const mightBeStringifiedJson = (value: string) => {
  const start = skipJsonWhitespace(value, 0);
  const first = value[start];

  if (first === "{" || first === "[" || first === '"') {
    return true;
  }
  if (first === "t") {
    return hasJsonLiteral(value, start, "true");
  }
  if (first === "f") {
    return hasJsonLiteral(value, start, "false");
  }
  if (first === "n") {
    return hasJsonLiteral(value, start, "null");
  }
  return first === "-" || (first !== undefined && first >= "0" && first <= "9")
    ? hasJsonNumber(value, start)
    : false;
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

const resolveRawJsonValue: JsonValueResolver<unknown> = (node, depth) => {
  const parsed = typeof node === "string" ? parseStringifiedValue(node, depth) : null;
  const value = parsed ? parsed.value : node;
  const kind = getJsonKind(value);
  const canDescend = depth < DEFAULT_MAX_DEPTH;
  const children = canDescend && (kind === "array" || kind === "object") ? value : null;

  return {
    node,
    value,
    kind,
    wasStringified: Boolean(parsed),
    childCount: childCountFor(kind, value),
    ...(children ? { children: children as unknown[] | Record<string, unknown> } : {}),
  };
};

const walkJsonValue = <T>(
  root: T,
  resolveValue: JsonValueResolver<T>,
  visit: (ctx: JsonValueWalkContext<T>) => boolean | void,
  start: JsonWalkStart,
) => {
  const pathSegments = [...(start.pathSegments ?? [])];

  function walk(node: T, jsonPath: string, stringifiedAncestors: string[], depth: number) {
    const resolved = resolveValue(node, depth);
    const stringifiedChain = resolved.wasStringified
      ? [...stringifiedAncestors, jsonPath]
      : stringifiedAncestors;
    const context = {
      node: resolved.node,
      value: resolved.value,
      kind: resolved.kind,
      childCount: resolved.childCount,
      ...(typeof resolved.valueLength === "number" ? { valueLength: resolved.valueLength } : {}),
      jsonPath,
      stringifiedChain,
      pathSegments,
    } satisfies JsonValueWalkContext<T>;

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

type JsonValueLabelInput = Pick<
  JsonValueWalkContext<unknown>,
  "kind" | "value" | "childCount" | "valueLength"
>;

export const formatJsonValueLabel = (value: JsonValueLabelInput, maxStringLength?: number) => {
  switch (value.kind) {
    case "object":
      return `{${value.childCount}}`;
    case "array":
      return `[${value.childCount}]`;
    case "string":
      return formatStringLabel(
        value.value as string,
        maxStringLength,
        value.valueLength ?? (value.value as string).length,
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

  const stringValue = value.value as string;
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
