import { describe, expect, it } from "vitest";
import type { JsonNode } from "../src";
import { stringifyJsonNode, stringifyJsonNodeBounded, stringifyJsonNodeWithLimits } from "../src";

describe("stringifyJsonNodeBounded", () => {
  it("matches full serialization below the limit", () => {
    const node: JsonNode = {
      kind: "object",
      children: { message: { kind: "string", value: "hello" } },
    };

    expect(stringifyJsonNodeBounded(node, 100, { indent: 2 })).toEqual({
      text: stringifyJsonNode(node, { indent: 2 }),
      truncated: false,
    });
  });

  it("stops reading the tree once the output limit is reached", () => {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- The fixture adds throwing child getters after initialization to verify bounded traversal.
    const children: Record<string, JsonNode> = {
      payload: { kind: "string", value: "x".repeat(1_000) },
    };
    Object.defineProperty(children, "unreachable", {
      enumerable: true,
      get() {
        throw new Error("read beyond output budget");
      },
    });
    const node: JsonNode = { kind: "object", children };

    expect(stringifyJsonNodeBounded(node, 50, { indent: 2 })).toEqual({
      text: expect.any(String),
      truncated: true,
    });
  });

  it("does not split a Unicode code point at the boundary", () => {
    const node: JsonNode = { kind: "string", value: "😀" };
    const result = stringifyJsonNodeBounded(node, 2);

    expect(result.text).toBe('"');
    expect(result.truncated).toBe(true);
  });
});

describe("stringifyJsonNodeWithLimits", () => {
  it("finishes measuring bytes after the character preview is full", () => {
    const node: JsonNode = { kind: "string", value: "hello" };

    expect(stringifyJsonNodeWithLimits(node, { maxCharacters: 2, maxBytes: 100 })).toEqual({
      text: '"h',
      complete: true,
      characterLimitExceeded: true,
      byteLimitExceeded: false,
      nodeLimitExceeded: false,
    });
  });

  it("measures the UTF-8 output budget", () => {
    const node: JsonNode = { kind: "string", value: "😀" };
    const result = stringifyJsonNodeWithLimits(node, { maxBytes: 4 });

    expect(result.text).toBe('"');
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(4);
    expect(result.complete).toBe(false);
    expect(result.byteLimitExceeded).toBe(true);
    expect(result.nodeLimitExceeded).toBe(false);
  });

  it("does not append a number lexeme past the byte budget", () => {
    const node: JsonNode = {
      kind: "number",
      value: 1,
      rawValue: "12345678901234567890",
    };

    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 8 })).toEqual({
      text: "12345678",
      complete: false,
      characterLimitExceeded: false,
      byteLimitExceeded: true,
      nodeLimitExceeded: false,
    });
  });

  it("stops before reading a child beyond the node budget", () => {
    let reads = 0;
    const children = new Proxy<JsonNode[]>(
      [
        { kind: "number", value: 1, rawValue: "1" },
        { kind: "number", value: 2, rawValue: "2" },
      ],
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            reads += 1;
          }
          // oxlint-disable-next-line anti-slop/no-reflect-get -- Forward Proxy property access with the original receiver so getters preserve their semantics.
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const result = stringifyJsonNodeWithLimits({ kind: "array", children }, { maxNodes: 2 });

    expect(result.nodeLimitExceeded).toBe(true);
    expect(reads).toBe(1);
  });

  it.each<{ name: string; node: JsonNode; opening: string }>([
    { name: "empty array", node: { kind: "array", children: [] }, opening: "[" },
    { name: "empty object", node: { kind: "object", children: {} }, opening: "{" },
  ])("marks $name incomplete when its closing bracket exceeds limits", ({ node, opening }) => {
    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 1 })).toEqual({
      text: opening,
      complete: false,
      characterLimitExceeded: false,
      byteLimitExceeded: true,
      nodeLimitExceeded: false,
    });
    expect(stringifyJsonNodeWithLimits(node, { maxCharacters: 1 })).toEqual({
      text: opening,
      complete: false,
      characterLimitExceeded: true,
      byteLimitExceeded: false,
      nodeLimitExceeded: false,
    });
    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 2 })).toEqual({
      text: opening === "[" ? "[]" : "{}",
      complete: true,
      characterLimitExceeded: false,
      byteLimitExceeded: false,
      nodeLimitExceeded: false,
    });
  });

  it("measures multi-byte UTF-8 widths accurately without splitting code points", () => {
    // 1-byte quote + 2-byte 'é' + 3-byte '中' + 4-byte '😀' + 1-byte quote = 11 bytes.
    const node: JsonNode = { kind: "string", value: "é中😀" };

    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 11 })).toEqual({
      text: '"é中😀"',
      complete: true,
      characterLimitExceeded: false,
      byteLimitExceeded: false,
      nodeLimitExceeded: false,
    });
    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 9 })).toEqual({
      text: '"é中',
      complete: false,
      characterLimitExceeded: false,
      byteLimitExceeded: true,
      nodeLimitExceeded: false,
    });
    expect(stringifyJsonNodeWithLimits(node, { maxBytes: 5 })).toEqual({
      text: '"é',
      complete: false,
      characterLimitExceeded: false,
      byteLimitExceeded: true,
      nodeLimitExceeded: false,
    });
  });
});
