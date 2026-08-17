import { describe, expect, it } from "vitest";
import type { JsonNode } from "../src";
import { stringifyJsonNode, stringifyJsonNodeBounded } from "../src";

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
