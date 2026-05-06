import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  buildRecordRows,
  formatJqSelector,
  formatJsonPath,
  parseTreePath,
  resolveTreePath,
  resolveTreePathMatches,
} from "../src/lib/tree";

describe("tree paths", () => {
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
    expect(parseTreePath('.payload.items[0]["a.b"]')).toEqual([
      { kind: "key", value: "payload" },
      { kind: "key", value: "items" },
      { kind: "index", value: "0" },
      { kind: "key", value: "a.b" },
    ]);
  });

  it("resolves paths inside stringified JSON", () => {
    const result = parseInput('{"payload":"{\\"items\\":[{\\"a.b\\":1,\\"0\\":\\"zero\\"}]}"}');
    const resolved = resolveTreePath(result.records, '$.payload.items[0]["a.b"]');

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }

    expect(resolved.target.pathText).toBe('$.payload.items[0]["a.b"]');
    expect(resolved.target.jqPath).toBe('.payload.items[0]["a.b"]');
    expect(resolved.target.sourceState).toBe("inside-stringified");
    expect(resolved.target.stringifiedPathChain).toEqual(["$.payload"]);
    expect(resolved.target.node.value).toBe(1);
  });

  it("resolves exact paths across all JSONL records", () => {
    const result = parseInput(
      '{"payload":{"type":"request"}}\n{"payload":{"type":"response"}}\n{"meta":{"type":"skip"}}',
    );
    const resolved = resolveTreePathMatches(result.records, "$.payload.type");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }

    expect(resolved.targets.map((target) => target.recordLine)).toEqual([1, 2]);
    expect(resolved.targets.map((target) => target.node.value)).toEqual(["request", "response"]);
  });

  it("serializes numeric object keys as quoted keys", () => {
    const result = parseInput('{"payload":"{\\"items\\":[{\\"0\\":\\"zero\\"}]}"}');
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set(["$.payload"]), new Set());
    const numericKey = rows.find((row) => row.valueLabel === '"zero"');

    expect(numericKey?.jsonPath).toBe('$.payload.items[0]["0"]');
    expect(resolveTreePath(result.records, '$.payload.items[0]["0"]')).toMatchObject({
      ok: true,
    });
    expect(resolveTreePath(result.records, "$.payload.items[0][0]")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });

  it("rejects invalid path syntax", () => {
    expect(parseTreePath("$.payload[abc]")).toBeNull();
    expect(resolveTreePath([], "$.payload[abc]")).toEqual({ ok: false, reason: "invalid" });
  });
});
