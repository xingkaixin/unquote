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

interface JsonWalkMetadata {
  node: JsonNode;
  childCount: number;
  valueLength?: number;
  jsonPath: string;
  stringifiedChain: string[];
  // Shared walk-scoped view; copy before retaining it beyond the visitor call.
  pathSegments: readonly TreePathSegment[];
  resolvePath?: (() => { jsonPath: string; stringifiedChain: string[] }) | undefined;
}

export type JsonWalkContext = JsonWalkValue & JsonWalkMetadata;

export type JsonNodeVisitor = (ctx: JsonWalkContext) => boolean | void;

export const maxStringValueLabelLength = 512;

export interface JsonWalkStart {
  jsonPath?: string;
  stringifiedAncestors?: string[];
  pathSegments?: readonly TreePathSegment[];
  lazyPath?: boolean;
}

export const walkJsonNode = (root: JsonNode, visit: JsonNodeVisitor, start: JsonWalkStart = {}) => {
  const pathSegments = [...(start.pathSegments ?? [])];
  const basePath = start.jsonPath ?? "$";
  const baseAncestors = start.stringifiedAncestors ?? [];
  const lazyPath = start.lazyPath === true;
  const baseSegmentCount = pathSegments.length;
  const stringifiedDepths: number[] = [];

  const formatPathAtDepth = (depth: number) => {
    let path = basePath;
    for (let index = baseSegmentCount; index < depth; index += 1) {
      path = appendJsonPathSegment(path, pathSegments[index]!);
    }
    return path;
  };
  const resolveLazyPath = lazyPath
    ? () => ({
        jsonPath: formatPathAtDepth(pathSegments.length),
        stringifiedChain: [...baseAncestors, ...stringifiedDepths.map(formatPathAtDepth)],
      })
    : undefined;

  function walk(node: JsonNode, jsonPath: string, stringifiedAncestors: string[]) {
    const wasStringified = isStringifiedNode(node);
    if (lazyPath && wasStringified) {
      stringifiedDepths.push(pathSegments.length);
    }
    const stringifiedChain = lazyPath
      ? baseAncestors
      : wasStringified
        ? [...stringifiedAncestors, jsonPath]
        : stringifiedAncestors;

    let children: JsonNode[] | Record<string, JsonNode> | undefined;
    let objectKeys: string[] | undefined;
    let context: JsonWalkContext;

    if (hasJsonNodeChildren(node)) {
      if (Array.isArray(node.children)) {
        children = node.children;
        context = {
          node,
          kind: "array",
          value: null,
          childCount: node.children.length,
          jsonPath,
          stringifiedChain,
          pathSegments,
          resolvePath: resolveLazyPath,
        };
      } else {
        children = node.children;
        objectKeys = Object.keys(node.children);
        context = {
          node,
          kind: "object",
          value: null,
          childCount: objectKeys.length,
          jsonPath,
          stringifiedChain,
          pathSegments,
          resolvePath: resolveLazyPath,
        };
      }
    } else if (node.kind === "object" || node.kind === "array") {
      context = {
        node,
        kind: node.kind,
        value: null,
        childCount: node.preview
          ? node.childCount
          : node.kind === "array"
            ? node.value.items.length
            : Object.keys(node.value.entries).length,
        jsonPath,
        stringifiedChain,
        pathSegments,
        resolvePath: resolveLazyPath,
      };
    } else if (node.kind === "string") {
      context =
        typeof node.valueLength === "number"
          ? {
              node,
              kind: "string",
              value: node.value,
              valueLength: node.valueLength,
              childCount: 0,
              jsonPath,
              stringifiedChain,
              pathSegments,
              resolvePath: resolveLazyPath,
            }
          : {
              node,
              kind: "string",
              value: node.value,
              childCount: 0,
              jsonPath,
              stringifiedChain,
              pathSegments,
              resolvePath: resolveLazyPath,
            };
    } else if (node.kind === "number") {
      context = {
        node,
        kind: "number",
        value: node.rawValue ?? node.value,
        childCount: 0,
        jsonPath,
        stringifiedChain,
        pathSegments,
        resolvePath: resolveLazyPath,
      };
    } else if (node.kind === "boolean") {
      context = {
        node,
        kind: "boolean",
        value: node.value,
        childCount: 0,
        jsonPath,
        stringifiedChain,
        pathSegments,
        resolvePath: resolveLazyPath,
      };
    } else {
      context = {
        node,
        kind: "null",
        value: null,
        childCount: 0,
        jsonPath,
        stringifiedChain,
        pathSegments,
        resolvePath: resolveLazyPath,
      };
    }

    if (visit(context) !== false && children) {
      if (Array.isArray(children)) {
        for (let index = 0; index < children.length; index += 1) {
          const segment = { kind: "index", value: String(index) } satisfies TreePathSegment;
          pathSegments.push(segment);
          walk(
            children[index]!,
            lazyPath ? "" : appendJsonPathSegment(jsonPath, segment),
            stringifiedChain,
          );
          pathSegments.pop();
        }
      } else if (objectKeys) {
        for (let index = 0; index < objectKeys.length; index += 1) {
          const key = objectKeys[index]!;
          const segment = { kind: "key", value: key } satisfies TreePathSegment;
          pathSegments.push(segment);
          walk(
            children[key]!,
            lazyPath ? "" : appendJsonPathSegment(jsonPath, segment),
            stringifiedChain,
          );
          pathSegments.pop();
        }
      }
    }

    if (lazyPath && wasStringified) {
      stringifiedDepths.pop();
    }
  }

  walk(root, basePath, baseAncestors);
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
