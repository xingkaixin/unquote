import { describe, expect, it } from "vitest";
import { drainJsonlLines } from "../src/lib/jsonl-lines";

describe("jsonl line scanner", () => {
  it("drains CRLF lines, empty lines, and chunk tails", () => {
    const lines: string[] = [];
    let buffer = "";

    let result = drainJsonlLines(buffer, '{"a":1}\r\n{"b"', false, (line) => {
      lines.push(line);
    });
    buffer = result.buffer;

    result = drainJsonlLines(buffer, ':2}\r\n\n{"c":3}', true, (line) => {
      lines.push(line);
    });

    expect(result).toEqual({ buffer: "", stopped: false });
    expect(lines).toEqual(['{"a":1}', '{"b":2}', "", '{"c":3}']);
  });

  it("does not emit a trailing empty line for newline-terminated input", () => {
    const lines: string[] = [];

    const result = drainJsonlLines("", '{"a":1}\n', true, (line) => {
      lines.push(line);
    });

    expect(result).toEqual({ buffer: "", stopped: false });
    expect(lines).toEqual(['{"a":1}']);
  });

  it("stops scanning without slicing the remaining buffer repeatedly", () => {
    const lines: string[] = [];

    const result = drainJsonlLines("", "first\nsecond\nthird\n", false, (line) => {
      lines.push(line);
      return line !== "second";
    });

    expect(result).toEqual({ buffer: "third\n", stopped: true });
    expect(lines).toEqual(["first", "second"]);
  });
});
