import { describe, expect, it } from "vitest";
import {
  formatResult,
  materializeNode,
  parseInput,
  parseJson,
  parseJsonlRecordLine,
  parsePreviewJsonlRecordLine,
  probeJsonl,
  stringifyJsonNode,
} from "../src";
import { parseLosslessJsonFallback } from "../src/lossless-json";

const fullNode = (source: string, maxDepth?: number) => {
  const record = parseInput(source, maxDepth === undefined ? {} : { maxDepth }).records[0];
  if (record?.status !== "full") {
    throw new Error(`Expected ${source} to parse`);
  }
  return record.node;
};

describe("lossless JSON numbers", () => {
  it.each([
    "9007199254740991",
    "9007199254740992",
    "9007199254740993",
    "-9007199254740993",
    "0.12345678901234567890123456789",
    "1e308",
    "1e309",
    "1e400",
  ])("preserves the source lexeme %s", (rawValue) => {
    const node = fullNode(rawValue);

    expect(node).toMatchObject({ kind: "number", rawValue });
    expect(stringifyJsonNode(node)).toBe(rawValue);
    expect(formatResult(parseInput(rawValue))).toBe(rawValue);
  });

  it.each([
    ["9007199254740991", 9_007_199_254_740_991],
    ["-0", -0],
    ["0.1", 0.1],
    ["1.25e-7", 1.25e-7],
  ])("materializes round-trip-safe number %s normally", (source, expected) => {
    expect(materializeNode(fullNode(source))).toBe(expected);
  });

  it.each([
    "9007199254740992",
    "9007199254740993",
    "-9007199254740993",
    "0.12345678901234567890123456789",
    "1e308",
    "1e309",
    "1e400",
  ])("requires an explicit approximation for %s", (source) => {
    const node = fullNode(source);

    expect(() => materializeNode(node)).toThrow(RangeError);
    expect(() => materializeNode(node, { numbers: "approximate" })).not.toThrow();
  });

  it("applies the same explicit approximation contract to parseJson", () => {
    expect(parseJson("0.1")).toBe(0.1);
    expect(() => parseJson("9007199254740993")).toThrow(RangeError);
    expect(parseJson("9007199254740993", { numbers: "approximate" })).toBe(9_007_199_254_740_992);
  });

  it("still recognizes overflowing numbers as syntactically valid JSONL", () => {
    expect(probeJsonl("1e309\n1e400")).toEqual({
      sampledLines: 2,
      parsableLines: 2,
      isLikelyJsonl: true,
    });
  });

  it("preserves numbers in JSONL, stringified JSON, previews, and truncated containers", () => {
    const rawValue = "9007199254740993";
    const jsonl = parseInput(`{"value":${rawValue}}\n{"value":1e400}`, {
      forcedFormat: "jsonl",
    });
    const stringified = parseInput(`{"payload":"{\\"value\\":${rawValue}}"}`);
    const preview = parsePreviewJsonlRecordLine(`{"value":${rawValue}}`, 1);
    const hydrated = parseJsonlRecordLine(`{"value":${rawValue}}`, 1);
    const truncated = parseInput(`{"outer":{"value":${rawValue}}}`, { maxDepth: 1 });

    expect(formatResult(jsonl)).toBe(`{"value":${rawValue}}\n{"value":1e400}`);
    expect(formatResult(stringified)).toContain(`"value": ${rawValue}`);
    expect(preview).toMatchObject({ status: "preview", node: { kind: "object", preview: true } });
    expect(hydrated.node?.children).toMatchObject({
      value: { kind: "number", rawValue },
    });
    expect(formatResult(truncated)).toContain(`"value": ${rawValue}`);
  });

  it("cannot confuse a user string with the internal number marker", () => {
    const markerLike = "\0unquote:number:::9007199254740993";
    const input = JSON.stringify({ markerLike, value: 9_007_199_254_740_993n.toString() }).replace(
      '"9007199254740993"',
      "9007199254740993",
    );
    const record = parseInput(input).records[0];
    if (record?.status !== "full" || record.node.kind !== "object" || !record.node.children) {
      throw new Error("Expected an object record");
    }

    expect(record.node.children.markerLike).toMatchObject({ kind: "string", value: markerLike });
    expect(record.node.children.value).toMatchObject({
      kind: "number",
      rawValue: "9007199254740993",
    });

    expect(parseLosslessJsonFallback(input)).toMatchObject({
      type: "object",
      entries: {
        markerLike,
        value: { type: "number", rawValue: "9007199254740993" },
      },
    });
  });

  it.each(["01", "1.", "1e", "+1", "--1"])('rejects invalid JSON number syntax "%s"', (source) => {
    expect(parseInput(source, { forcedFormat: "json" }).records[0]).toMatchObject({
      status: "failed",
    });
  });

  it("rejects an invalid exact-number node instead of emitting malformed JSON", () => {
    expect(() => stringifyJsonNode({ kind: "number", value: 1, rawValue: "1." })).toThrow(
      TypeError,
    );
  });

  it("keeps native duplicate-key semantics", () => {
    expect(formatResult(parseInput('{"value":9007199254740993,"value":2}'))).toBe(
      '{\n  "value": 2\n}',
    );
  });

  it("serializes deeply truncated exact values without recursive stack growth", () => {
    const source = `${'{"value":'.repeat(3_000)}1e400${"}".repeat(3_000)}`;
    const result = parseInput(source, { maxDepth: 8 });

    expect(formatResult(result)).toContain("1e400");
    expect(() =>
      materializeNode(result.records[0]!.node!, { numbers: "approximate" }),
    ).not.toThrow();
  });

  it("round-trips a deterministic generated set of valid number lexemes", () => {
    let state = 0x17c0ffee;
    const next = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };

    for (let sample = 0; sample < 200; sample += 1) {
      const integerLength = 1 + (next() % 24);
      let integer = String(1 + (next() % 9));
      while (integer.length < integerLength) {
        integer += String(next() % 10);
      }
      const fractionLength = next() % 12;
      let fraction = "";
      while (fraction.length < fractionLength) {
        fraction += String(next() % 10);
      }
      const exponent = (next() % 801) - 400;
      const source = `${next() % 2 === 0 ? "" : "-"}${integer}${fraction ? `.${fraction}` : ""}${
        next() % 2 === 0 ? `e${exponent >= 0 ? "+" : ""}${exponent}` : ""
      }`;

      expect(formatResult(parseInput(source, { forcedFormat: "json" }))).toBe(source);
      expect(parseLosslessJsonFallback(source)).toEqual({ type: "number", rawValue: source });
    }
  });
});
