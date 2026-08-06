import { describe, expect, it } from "vitest";
import { detectSourceFormat } from "../src/lib/source-detect";

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
    });
  });

  it("reports text that parses neither way as invalid", () => {
    expect(detectSourceFormat("not json")).toEqual({ kind: "invalid" });
    expect(detectSourceFormat('{"a":1}\nnot json\nalso not json')).toEqual({ kind: "invalid" });
  });

  it("probes only the head of a long JSONL draft", () => {
    const lines = Array.from({ length: 60 }, (_, index) => JSON.stringify({ i: index }));
    lines[50] = "not json";

    expect(detectSourceFormat(lines.join("\n"))).toEqual({ kind: "jsonl", lines: 60 });
  });

  it("samples only the first 64 KB of a large draft", () => {
    // ~90 KB of valid JSONL: the sample cuts mid-file, so the reported line
    // count describes the sample rather than the whole draft.
    const line = JSON.stringify({ value: "x".repeat(80) });
    const total = Math.ceil((90 * 1024) / (line.length + 1));
    const detection = detectSourceFormat(Array.from({ length: total }, () => line).join("\n"));

    expect(detection.kind).toBe("jsonl");
    expect(detection.kind === "jsonl" && detection.lines).toBeLessThan(total);
  });
});
