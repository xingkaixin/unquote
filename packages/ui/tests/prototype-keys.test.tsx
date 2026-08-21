import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { searchRecords } from "../src/lib/record-search";
import { resolveTreePath } from "../src/lib/tree-path";

// Written as raw JSON: an object literal would treat `__proto__` as the
// prototype setter instead of a property.
const source = [
  '{"__proto__":"kept","toString":"own","safe":1,',
  '"nested":{"__proto__":"deep"},"items":[{"__proto__":"in-array"}]}',
].join("");

const records = parseInput(source, { forcedFormat: "jsonl" }).records;
const defaultOptions = { syntax: "text", caseSensitive: false } as const;

describe("tree paths for keys that shadow prototype members", () => {
  it.each([
    ['$["__proto__"]', "kept"],
    ['$.nested["__proto__"]', "deep"],
    ['$.items[0]["__proto__"]', "in-array"],
    ["$.toString", "own"],
  ])("resolves %s", (selector, value) => {
    const result = resolveTreePath(records, selector);

    expect(result.ok).toBe(true);
    expect(result.ok && result.target.node).toMatchObject({ kind: "string", value });
  });

  it.each(["$.constructor", "$.prototype", "$.nested.toString", '$.items[0]["valueOf"]'])(
    "reports %s as not found",
    (selector) => {
      expect(resolveTreePath(records, selector)).toEqual({ ok: false, reason: "not-found" });
    },
  );
});

describe("search over keys that shadow prototype members", () => {
  it("matches the key itself at every depth", () => {
    const matches = searchRecords(records, "__proto__", defaultOptions)?.window.matches;

    expect(matches?.map((match) => match.pathText)).toEqual([
      "$.__proto__",
      "$.nested.__proto__",
      "$.items[0].__proto__",
    ]);
    expect(matches?.every((match) => match.keyRanges.length > 0)).toBe(true);
  });

  it("matches values stored under such keys", () => {
    const matches = searchRecords(records, "in-array", defaultOptions)?.window.matches;

    expect(matches?.[0]?.pathText).toBe("$.items[0].__proto__");
  });
});
