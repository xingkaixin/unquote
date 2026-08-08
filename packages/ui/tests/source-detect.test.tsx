import { describe, expect, it, vi } from "vitest";
import {
  detectSourceFormat,
  sourceDetectionLineBudget,
  sourceDetectionProbeByteBudget,
} from "../src/lib/source-detect";

describe("detectSourceFormat", () => {
  it("reports an empty draft as empty", () => {
    expect(detectSourceFormat("")).toEqual({ kind: "empty" });
    expect(detectSourceFormat("  \n \t ")).toEqual({ kind: "empty" });
  });

  it("reports a single JSON document as json", () => {
    expect(detectSourceFormat('  {"a":1}  ')).toEqual({ kind: "json" });
    expect(detectSourceFormat("[1, 2, 3]")).toEqual({ kind: "json" });
  });

  it("reports a pretty-printed document as json rather than broken JSONL", () => {
    expect(detectSourceFormat('{\n  "a": 1\n}')).toEqual({ kind: "json" });
  });

  it("counts the non-empty lines of a JSONL draft", () => {
    expect(detectSourceFormat('{"a":1}\n\n{"b":2}\r\n{"c":3}\n')).toEqual({
      kind: "jsonl",
      lines: 3,
      precision: "exact",
    });
  });

  it("reports text that parses neither way as invalid", () => {
    expect(detectSourceFormat("not json")).toEqual({ kind: "invalid" });
    expect(detectSourceFormat('{"a":1}\nnot json\nalso not json')).toEqual({ kind: "invalid" });
  });

  it("reports a lower bound after reaching the line budget", () => {
    const lines = Array.from({ length: 60 }, (_, index) => JSON.stringify({ i: index }));
    lines[50] = "not json";

    expect(detectSourceFormat(lines.join("\n"))).toEqual({
      kind: "jsonl",
      lines: sourceDetectionLineBudget,
      precision: "lower-bound",
    });
  });

  it("does not count the tail of a draft beyond the line budget", () => {
    const line = JSON.stringify({ value: "x".repeat(80) });
    const total = Math.ceil((90 * 1024) / (line.length + 1));

    expect(detectSourceFormat(Array.from({ length: total }, () => line).join("\n"))).toEqual({
      kind: "jsonl",
      lines: sourceDetectionLineBudget,
      precision: "lower-bound",
    });
  });

  it("detects JSONL whose lines are each longer than a probed chunk", () => {
    const lines = Array.from({ length: 20 }, (_, index) =>
      JSON.stringify({ index, blob: "x".repeat(4000) }),
    );

    expect(detectSourceFormat(lines.join("\n"))).toEqual({
      kind: "jsonl",
      lines: 17,
      precision: "lower-bound",
    });
  });

  it("applies the probe budget to UTF-8 bytes rather than code units", () => {
    const line = JSON.stringify({ value: "界".repeat(3000) });
    const lines = Array.from({ length: 10 }, () => line);

    expect(detectSourceFormat(lines.join("\n"))).toEqual({
      kind: "jsonl",
      lines: 8,
      precision: "lower-bound",
    });
  });

  it("classifies a multi-megabyte single-line document without parsing it", () => {
    const document = `{"blob":"${"x".repeat(4 * 1024 * 1024)}"}`;
    const parse = vi.spyOn(JSON, "parse");

    expect(detectSourceFormat(document)).toEqual({ kind: "json" });
    expect(parse).not.toHaveBeenCalled();

    parse.mockRestore();
  });

  it("still rejects an over-budget draft that is not shaped like JSON", () => {
    expect(detectSourceFormat("x".repeat(70 * 1024))).toEqual({ kind: "invalid" });
    // Over the budget the shape check is all that is left, so a bracketed
    // document is trusted while an unclosed one is not.
    expect(detectSourceFormat(`[${"x".repeat(70 * 1024)}]`)).toEqual({ kind: "json" });
    expect(detectSourceFormat(`{${"x".repeat(70 * 1024)}`)).toEqual({ kind: "invalid" });
  });

  it("counts a pretty-printed document over the budget without parsing it", () => {
    const document = `{\n${Array.from({ length: 40_000 }, (_, index) => `  "k${index}": "${"x".repeat(20)}",`).join("\n")}\n  "last": 1\n}`;
    const parse = vi.spyOn(JSON, "parse");

    // Every line here is a JSON fragment, so the probe fails on line 1 and the
    // whole draft is judged by its brackets rather than parsed.
    expect(document.length).toBeGreaterThan(64 * 1024);
    expect(detectSourceFormat(document)).toEqual({ kind: "json" });
    expect(parse).toHaveBeenCalledTimes(1);

    parse.mockRestore();
  });

  it("does not search past the byte budget for a distant newline", () => {
    const head = JSON.stringify({ blob: "x".repeat(70 * 1024) });

    expect(detectSourceFormat(`${head}\nnot json`)).toEqual({ kind: "invalid" });
  });

  it("bounds scanner work across repeated edits of a large draft", () => {
    const line = JSON.stringify({ blob: "x".repeat(4000) });
    const draft = Array.from({ length: 20 }, () => line).join("\n");
    const edits = Array.from({ length: 4 }, (_, index) => `${draft}\n{"edit":${index}}`);
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    const trim = vi.spyOn(String.prototype, "trim");
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");

    const detections = edits.map(detectSourceFormat);
    const indexOfCalls = indexOf.mock.calls.length;
    const longestTrimmedInput = Math.max(
      0,
      ...trim.mock.instances.map((instance) => String(instance).length),
    );
    const charCodeAtCalls = charCodeAt.mock.calls.length;
    indexOf.mockRestore();
    trim.mockRestore();
    charCodeAt.mockRestore();

    expect(detections).toEqual(
      Array.from({ length: edits.length }, () => ({
        kind: "jsonl",
        lines: 17,
        precision: "lower-bound",
      })),
    );
    expect(indexOfCalls).toBe(0);
    expect(longestTrimmedInput).toBeLessThanOrEqual(sourceDetectionProbeByteBudget);
    expect(charCodeAtCalls).toBeLessThanOrEqual(edits.length * sourceDetectionProbeByteBudget * 3);
  });
});
