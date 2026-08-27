import { describe, expect, it } from "vitest";
import {
  formatResult,
  materializeNode,
  parseInput,
  parsePreviewJsonlRecordLine,
  stringifyJsonNode,
  stringifyJsonNodeBounded,
  stringifyJsonNodeWithLimits,
} from "../src";
import type { JsonNode, ParseResult } from "../src";

const previews: JsonNode[] = [
  { kind: "object", childCount: 1, preview: true },
  { kind: "array", childCount: 2, preview: true },
  { kind: "string", value: "partial", valueLength: 100 },
  { kind: "string", value: '{"value":1}', stringifiedPreview: true },
];
const serializers = [
  stringifyJsonNode,
  materializeNode,
  (node: JsonNode) => stringifyJsonNodeBounded(node, 100),
  (node: JsonNode) => stringifyJsonNodeWithLimits(node, { maxNodes: 100 }),
];

describe("incomplete serialization inputs", () => {
  it.each(previews)("rejects an incomplete $kind node in every serializer", (node) => {
    for (const serialize of serializers) {
      expect(() => serialize(node)).toThrow(TypeError);
    }
  });

  it.each(previews)(
    "rejects an incomplete $kind descendant instead of inventing a value",
    (node) => {
      for (const serialize of serializers) {
        expect(() => serialize({ kind: "object", children: { value: node } })).toThrow(TypeError);
        expect(() => serialize({ kind: "array", children: [node] })).toThrow(TypeError);
      }
    },
  );

  it("does not disguise a preview input as a bounded output", () => {
    expect(() => stringifyJsonNodeWithLimits(previews[0]!, { maxNodes: 0 })).toThrow(TypeError);
    expect(() => stringifyJsonNodeBounded(previews[0]!, 0)).toThrow(TypeError);
  });

  it("keeps lossless depth-limited containers serializable", () => {
    const source = '{"items":[{"value":9007199254740993}]}';
    const node = parseInput(source, { maxDepth: 0 }).records[0]!.node!;
    expect(stringifyJsonNode(node)).toBe(source);
    expect(materializeNode(node, { numbers: "approximate" })).toEqual(JSON.parse(source));
  });

  it("allows complete strings with length metadata", () => {
    const node: JsonNode = { kind: "string", value: "hello", valueLength: 5 };
    expect(stringifyJsonNode(node)).toBe('"hello"');
    expect(materializeNode(node)).toBe("hello");
  });

  it.each(["json", "jsonl"] as const)(
    "refuses preview records in %s output, even for primitives",
    (format) => {
      for (const source of ['{"a":1}', "[]", '"hello"', "1", "true", "null"]) {
        const result: ParseResult = {
          format,
          records: [parsePreviewJsonlRecordLine(source, 1)],
          stats: { total: 1, success: 1, failed: 0 },
        };
        expect(() => formatResult(result)).toThrow(TypeError);
      }
    },
  );
});
