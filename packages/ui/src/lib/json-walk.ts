import type { JsonNode } from "@unquote/core";
import { appendJsonPathSegment, appendJqSelectorSegment } from "./path-codec";
import type { TreePathSegment } from "./path-codec";

export interface JsonWalkContext {
  node: JsonNode;
  jsonPath: string; // e.g. $.a.b[0]
  jqPath: string; // e.g. .a.b[0]
  // The chain of stringified-JSON ancestor paths, including this node's own
  // path when it is itself stringified — mirrors the previous per-walker
  // `currentChain` computation.
  stringifiedChain: string[];
  // Path segments to this node; the last segment's `kind` distinguishes an
  // object member ("key") from an array element ("index"), which field-
  // classifying walkers rely on.
  pathSegments: TreePathSegment[];
}

// Return `false` to skip descending into this node's children; any other value
// (including undefined) descends. This expresses both "descend only when
// expanded" and "always descend" without re-scattering the array/object branch.
export type JsonNodeVisitor = (ctx: JsonWalkContext) => boolean | void;

export interface JsonWalkStart {
  jsonPath?: string;
  jqPath?: string;
  stringifiedAncestors?: string[];
  pathSegments?: TreePathSegment[];
}

// Single traversal primitive for JsonNode trees: walks array/object children,
// builds the $.json / .jq paths incrementally, and threads the stringified
// chain. Callers supply only per-node logic via the visitor.
export const walkJsonNode = (
  root: JsonNode,
  visit: JsonNodeVisitor,
  start: JsonWalkStart = {},
) => {
  const walk = (
    node: JsonNode,
    jsonPath: string,
    jqPath: string,
    stringifiedAncestors: string[],
    pathSegments: TreePathSegment[],
  ) => {
    const stringifiedChain = node.wasStringified
      ? [...stringifiedAncestors, jsonPath]
      : stringifiedAncestors;

    if (
      visit({ node, jsonPath, jqPath, stringifiedChain, pathSegments }) === false ||
      !node.children
    ) {
      return;
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        const segment = { kind: "index", value: String(index) } satisfies TreePathSegment;
        walk(
          child,
          appendJsonPathSegment(jsonPath, segment),
          appendJqSelectorSegment(jqPath, segment),
          stringifiedChain,
          [...pathSegments, segment],
        );
      });
      return;
    }

    for (const [key, child] of Object.entries(node.children)) {
      const segment = { kind: "key", value: key } satisfies TreePathSegment;
      walk(
        child,
        appendJsonPathSegment(jsonPath, segment),
        appendJqSelectorSegment(jqPath, segment),
        stringifiedChain,
        [...pathSegments, segment],
      );
    }
  };

  walk(
    root,
    start.jsonPath ?? "$",
    start.jqPath ?? ".",
    start.stringifiedAncestors ?? [],
    start.pathSegments ?? [],
  );
};
