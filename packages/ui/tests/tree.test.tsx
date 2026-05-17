import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  createFileOverview,
  createFileOverviewState,
  updateFileOverview,
} from "../src/lib/file-overview";
import {
  buildRecordRows,
  filterRecords,
  formatJqSelector,
  formatJsonPath,
  getRenderedRecord,
  parseTreePath,
  recordContainsStringifiedJson,
  resolveTreePath,
  resolveTreePathMatches,
  searchRecords,
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

  it("resolves paths against restored record views", () => {
    const result = parseInput('{"payload":"{\\"nested\\":true}"}');
    const record = result.records[0]!;
    const restoredRecord = getRenderedRecord(record, new Set([record.id]));
    const resolved = resolveTreePath([restoredRecord], "$.payload");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }

    expect(resolved.target.kind).toBe("string");
    expect(resolved.target.node.value).toBe('{"nested":true}');
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

  it("limits long string labels without changing the node value", () => {
    const longValue = "a".repeat(600);
    const result = parseInput(JSON.stringify({ payload: longValue }));
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set(), new Set());
    const payload = rows.find((row) => row.pathText === "$.payload");

    expect(payload?.valueLabel).toContain("600 chars");
    expect(payload?.valueLabel.length).toBeLessThan(longValue.length);
    expect(payload?.node.value).toBe(longValue);
  });

  it("rejects invalid path syntax", () => {
    expect(parseTreePath("$.payload[abc]")).toBeNull();
    expect(resolveTreePath([], "$.payload[abc]")).toEqual({ ok: false, reason: "invalid" });
  });

  it("filters records by search matches, parse errors, and nested JSON", () => {
    const result = parseInput(
      '{"level":"info","payload":"{\\"nested\\":true}"}\n{"level":"error","message":"boom"}\nnot-json',
      { forcedFormat: "jsonl" },
    );
    const matches = searchRecords(result.records, "boom", {
      regex: false,
      caseSensitive: false,
      jq: false,
    });

    expect(
      filterRecords(result.records, "matches", matches).map((record) => record.lineNumber),
    ).toEqual([2]);
    expect(
      filterRecords(result.records, "errors", matches).map((record) => record.lineNumber),
    ).toEqual([3]);
    expect(
      filterRecords(result.records, "nested", matches).map((record) => record.lineNumber),
    ).toEqual([1]);
    expect(recordContainsStringifiedJson(result.records[0]!)).toBe(true);
  });

  it("builds file overview diagnostics from parsed records", () => {
    const result = parseInput(
      [
        '{"event":"tool_call","tool":"billing.search","args":"{\\"status\\":\\"open\\"}"}',
        '{"event":"tool_result","tool":"billing.search","result":{"ok":true}}',
        "not-json",
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );
    const overview = createFileOverview(result.records);

    expect(overview).toMatchObject({
      total: 3,
      success: 2,
      failed: 1,
      nestedRecords: 1,
      maxDepth: 2,
    });
    expect(overview.topNestedPaths).toEqual([{ pathText: "$.args", count: 1 }]);
    expect(overview.topFieldValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "event", pathText: "$.event", value: "tool_call" }),
        expect.objectContaining({ field: "tool", pathText: "$.tool", value: "billing.search" }),
      ]),
    );
    expect(overview.errors).toEqual([
      expect.objectContaining({ recordId: "record-3", lineNumber: 3 }),
    ]);
  });

  it("updates file overview incrementally for appended records", () => {
    const result = parseInput(
      [
        '{"event":"tool_call","tool":"billing.search","args":"{\\"status\\":\\"open\\"}"}',
        '{"event":"tool_result","tool":"billing.search","result":{"ok":true}}',
        "not-json",
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );
    const records = result.records.slice(0, 1);
    const state = createFileOverviewState();

    const first = updateFileOverview(records, state);
    expect(first.total).toBe(1);
    expect(first.nestedRecords).toBe(1);

    records.push(...result.records.slice(1));
    expect(updateFileOverview(records, state)).toEqual(createFileOverview(records));
  });
});
