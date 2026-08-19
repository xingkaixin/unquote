import { afterEach, describe, expect, it, vi } from "vitest";
import { getParseErrorMeta } from "../src/parse-error";

afterEach(() => vi.restoreAllMocks());

describe("parse error metadata", () => {
  it("locates CRLF input and keeps only the adjacent context lines", () => {
    const input = '{"ok":1}\r\n{"ok":2}\r\n{bad}\r\n{"ok":4}';
    const position = input.indexOf("bad");

    const meta = getParseErrorMeta(
      input,
      new SyntaxError(`Unexpected token at position ${position}`),
    );

    expect(meta).toMatchObject({
      line: 3,
      column: 2,
      rawLine: "{bad}",
    });
    expect(meta.context).toContain('2 | {"ok":2}');
    expect(meta.context).toContain("3 | {bad}");
    expect(meta.context).toContain('4 | {"ok":4}');
    expect(meta.context).not.toContain("\r");
  });

  it("scans large input without splitting it into a complete line array", () => {
    const targetLine = 12_345;
    const input = Array.from({ length: 20_000 }, (_, index) =>
      index + 1 === targetLine ? "{bad}" : `{"index":${index + 1}}`,
    ).join("\n");
    const position = input.indexOf("bad");
    const splitSpy = vi.spyOn(String.prototype, "split");

    const meta = getParseErrorMeta(
      input,
      new SyntaxError(`Unexpected token at position ${position}`),
    );
    const splitCalls = splitSpy.mock.calls.length;
    splitSpy.mockRestore();

    expect(splitCalls).toBe(0);
    expect(meta).toMatchObject({
      line: targetLine,
      column: 2,
      rawLine: "{bad}",
    });
    expect(meta.context.split("\n")).toHaveLength(4);
  });
});
