import { hasJsonNodeChildren, stringifyJsonNodeWithLimits } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { appendJsonPathSegment, formatJsonPath, isPathWithin, parseTreePath } from "./path-codec";
import { yieldToMain } from "./record-export";

export const diffInputBytes = 512 * 1024;
const diffNodeLimit = 50_000;
const diffChangeLimit = 5_000;

export interface JsonDifference {
  path: string;
  kind: "added" | "removed" | "changed" | "type";
  before: string;
  after: string;
}

export const parseIgnoredPaths = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const path = parseTreePath(line);
      if (!path) throw new Error("invalid-path");
      return formatJsonPath(path);
    });

export const formatDiffInput = (node: JsonNode) => {
  const result = stringifyJsonNodeWithLimits(node, {
    maxBytes: diffInputBytes,
    maxNodes: diffNodeLimit,
  });
  if (!result.complete) throw new RangeError("diff-limit");
  return result.text;
};

const describeNode = (node: JsonNode | undefined) => {
  if (!node) return "";
  return stringifyJsonNodeWithLimits(node, { maxCharacters: 1000, maxNodes: diffNodeLimit }).text;
};

export const compareJsonNodes = async (
  before: JsonNode,
  after: JsonNode,
  ignored: readonly string[] = [],
  signal?: AbortSignal,
): Promise<JsonDifference[]> => {
  const changes: JsonDifference[] = [];
  const pending: { before: JsonNode | undefined; after: JsonNode | undefined; path: string }[] = [
    { before, after, path: "$" },
  ];
  let visited = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    if (++visited > diffNodeLimit || changes.length >= diffChangeLimit)
      throw new RangeError("diff-limit");
    if (visited % 250 === 0) await yieldToMain();
    const item = pending.pop()!;
    if (ignored.some((path) => isPathWithin(item.path, path))) continue;
    const left = item.before;
    const right = item.after;
    if ([left, right].some((node) => node && (node.truncated || node.preview)))
      throw new RangeError("diff-limit");
    if (left && right && left.kind === right.kind) {
      if (hasJsonNodeChildren(left) && hasJsonNodeChildren(right)) {
        const keys = new Set([...Object.keys(left.children), ...Object.keys(right.children)]);
        for (const key of [...keys].reverse()) {
          const get = (node: typeof left) =>
            Object.hasOwn(node.children, key)
              ? (node.children as Record<string, JsonNode>)[key]
              : undefined;
          pending.push({
            before: get(left),
            after: get(right),
            path: appendJsonPathSegment(item.path, {
              kind: left.kind === "array" ? "index" : "key",
              value: key,
            }),
          });
        }
        continue;
      }
      if (formatDiffInput(left) === formatDiffInput(right)) continue;
    }
    changes.push({
      path: item.path,
      kind: !left ? "added" : !right ? "removed" : left.kind !== right.kind ? "type" : "changed",
      before: describeNode(left),
      after: describeNode(right),
    });
  }
  signal?.throwIfAborted();
  return changes;
};
