import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInput } from "../src";

afterEach(() => vi.restoreAllMocks());

const bigObject = JSON.stringify({
  items: Array.from({ length: 2000 }, (_, index) => ({ index, label: `row-${index}` })),
});

describe("auto detection of a single JSON document", () => {
  it.each([
    ["a large object", bigObject],
    ["a large array", JSON.stringify(Array.from({ length: 2000 }, (_, index) => index))],
    ["a scalar", "42"],
    ["a string", '"text"'],
    ["null", "null"],
  ])("parses %s exactly once", (_label, input) => {
    const parse = vi.spyOn(JSON, "parse");

    const result = parseInput(input);

    // Nested calls also probe every string child for stringified JSON, so only
    // parses of the document itself are counted.
    expect(parse.mock.calls.filter(([text]) => text === input)).toHaveLength(1);
    expect(result).toEqual(parseInput(input, { forcedFormat: "json" }));
  });

  it.each([
    ["a trailing newline", `${bigObject}\n`],
    ["leading blank lines", `\n\n${bigObject}`],
    ["surrounding whitespace", `  ${bigObject}  `],
  ])("matches explicit JSON mode with %s", (_label, input) => {
    const result = parseInput(input);

    expect(result).toEqual(parseInput(input, { forcedFormat: "json" }));
    expect(result.records[0]).toMatchObject({ id: "record-1", lineNumber: 1, status: "full" });
  });

  it("keeps multi-line pretty JSON on the single-document path", () => {
    const input = JSON.stringify({ a: { b: 1 } }, null, 2);

    const result = parseInput(input);

    expect(result.format).toBe("json");
    expect(result).toEqual(parseInput(input, { forcedFormat: "json" }));
  });

  it("keeps multi-record input as JSONL", () => {
    const result = parseInput('{"a":1}\n{"b":2}');

    expect(result.format).toBe("jsonl");
    expect(result.records.map((record) => record.lineNumber)).toEqual([1, 2]);
  });

  it("reports a failed single document the same way as explicit JSON mode", () => {
    const input = "{not json}";

    expect(parseInput(input)).toEqual(parseInput(input, { forcedFormat: "json" }));
    expect(parseInput(input).records[0]).toMatchObject({ status: "failed", lineNumber: 1 });
  });

  it("honours maxDepth on the reused record", () => {
    const input = JSON.stringify({ a: { b: { c: 1 } } });

    expect(parseInput(input, { maxDepth: 1 })).toEqual(
      parseInput(input, { forcedFormat: "json", maxDepth: 1 }),
    );
  });

  it("expands stringified JSON in the reused record", () => {
    const input = JSON.stringify({ payload: JSON.stringify({ nested: true }) });

    const result = parseInput(input);

    expect(result).toEqual(parseInput(input, { forcedFormat: "json" }));
    const node = result.records[0]?.node;
    expect(node?.kind === "object" && node.children?.["payload"]?.kind).toBe("object");
  });
});
