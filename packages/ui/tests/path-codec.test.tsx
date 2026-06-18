import { describe, expect, it } from "vitest";
import { formatJsonPath, formatJqSelector, parseTreePath } from "../src/lib/path-codec";

describe("path codec", () => {
  it("parses and serializes JSONPath and jq selectors", () => {
    const segments = parseTreePath('$.payload.items[0]["a.b"]["quote\\"key"]');

    expect(segments).toEqual([
      { kind: "key", value: "payload" },
      { kind: "key", value: "items" },
      { kind: "index", value: "0" },
      { kind: "key", value: "a.b" },
      { kind: "key", value: 'quote"key' },
    ]);
    expect(formatJsonPath(segments ?? [])).toBe('$.payload.items[0]["a.b"]["quote\\"key"]');
    expect(formatJqSelector(segments ?? [])).toBe('.payload.items[0]["a.b"]["quote\\"key"]');
  });

  it("parses the jq-leading form identically to the $-leading form", () => {
    expect(parseTreePath('.payload.items[0]["a.b"]')).toEqual([
      { kind: "key", value: "payload" },
      { kind: "key", value: "items" },
      { kind: "index", value: "0" },
      { kind: "key", value: "a.b" },
    ]);
  });

  it("round-trips quoted keys, array indexes, and numeric object keys", () => {
    const paths = [
      "$",
      "$.payload",
      "$.items[0]",
      '$["a.b"]',
      '$["0"]',
      '$.nested["key.with.dots"][2]',
    ];

    for (const path of paths) {
      const segments = parseTreePath(path);
      expect(segments, `parse failed for ${path}`).not.toBeNull();
      expect(formatJsonPath(segments!), `jsonPath round-trip for ${path}`).toBe(path);
    }
  });

  it("formats the root selector for both syntaxes", () => {
    expect(formatJsonPath([])).toBe("$");
    expect(formatJqSelector([])).toBe(".");
    expect(parseTreePath("$")).toEqual([]);
    expect(parseTreePath(".")).toEqual([]);
  });

  it("rejects invalid path syntax", () => {
    expect(parseTreePath("$.payload[abc]")).toBeNull();
    expect(parseTreePath("")).toBeNull();
    expect(parseTreePath("payload")).toBeNull();
  });
});
