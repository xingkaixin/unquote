import { parseInput } from "@unquote/core";
import type { JsonNode } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { getPrimitiveValue, isToolContext, normalizeKey } from "../src/lib/record-fields";

const node = (kind: JsonNode["kind"], value: unknown): JsonNode =>
  parseInput(JSON.stringify(value), { forcedFormat: "json" }).records[0]!.node!;

describe("record-fields", () => {
  it("normalizeKey strips separators and lowercases", () => {
    expect(normalizeKey("Tool_Name")).toBe("toolname");
    expect(normalizeKey("created at")).toBe("createdat");
    // default (record-insight) strips dots; overview keeps them
    expect(normalizeKey("a.b")).toBe("ab");
    expect(normalizeKey("a.b", false)).toBe("a.b");
  });

  it("getPrimitiveValue returns null for containers, coerces primitives", () => {
    expect(getPrimitiveValue(node("object", {}))).toBeNull();
    expect(getPrimitiveValue(node("array", []))).toBeNull();
    expect(getPrimitiveValue(node("string", "hi"))).toBe("hi");
    expect(getPrimitiveValue(node("number", 3))).toBe("3");
    expect(getPrimitiveValue(node("boolean", true))).toBe("true");
    expect(getPrimitiveValue(parseInput("9007199254740993").records[0]!.node!)).toBe(
      "9007199254740993",
    );
  });

  it("isToolContext detects tool/function-ish segments", () => {
    expect(isToolContext([{ kind: "key", value: "toolCall" }])).toBe(true);
    expect(isToolContext([{ kind: "key", value: "function_call" }])).toBe(true);
    expect(isToolContext([{ kind: "key", value: "data" }])).toBe(false);
  });
});
