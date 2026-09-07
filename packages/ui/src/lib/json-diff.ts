import {
  hasJsonNodeChildren,
  stringifyJsonNodeWithLimits,
  truncateAtCodePointBoundary,
} from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { appendJsonPathSegment, formatJsonPath, isPathWithin, parseTreePath } from "./path-codec";
import { yieldToMain } from "./record-export";

export const diffInputBytes = 512 * 1024;
const diffNodeLimit = 50_000;
const diffChangeLimit = 5_000;

interface DiffValue {
  text: string;
  truncated: boolean;
}

export interface JsonDifference {
  path: string;
  kind: "added" | "removed" | "changed" | "type";
  before: DiffValue;
  after: DiffValue;
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

const describeNode = (node: JsonNode | undefined): DiffValue => {
  if (!node) return { text: "", truncated: false };
  const result = stringifyJsonNodeWithLimits(node, {
    maxCharacters: 1000,
    maxNodes: diffNodeLimit,
  });
  return { text: result.text, truncated: !result.complete };
};

const describeText = (text: string, start: number): DiffValue => {
  if (start > 0 && text.codePointAt(start - 1)! > 0xffff) start--;
  const excerpt = truncateAtCodePointBoundary(text.slice(start), 1000);
  const omittedEnd = start + excerpt.length < text.length;
  return {
    text: `${start ? "…" : ""}${excerpt}${omittedEnd ? "…" : ""}`,
    truncated: start > 0 || omittedEnd,
  };
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
    let beforeValue: DiffValue | undefined;
    let afterValue: DiffValue | undefined;
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
      const beforeText = formatDiffInput(left);
      const afterText = formatDiffInput(right);
      if (beforeText === afterText) continue;
      let firstDifference = 0;
      while (beforeText[firstDifference] === afterText[firstDifference]) firstDifference++;
      const start =
        Math.max(beforeText.length, afterText.length) > 1000
          ? Math.max(0, firstDifference - 100)
          : 0;
      beforeValue = describeText(beforeText, start);
      afterValue = describeText(afterText, start);
    }
    changes.push({
      path: item.path,
      kind: !left ? "added" : !right ? "removed" : left.kind !== right.kind ? "type" : "changed",
      before: beforeValue ?? describeNode(left),
      after: afterValue ?? describeNode(right),
    });
  }
  signal?.throwIfAborted();
  return changes;
};
