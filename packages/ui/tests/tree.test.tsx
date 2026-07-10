import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  createFileOverview,
  createFileOverviewState,
  updateFileOverview,
} from "../src/lib/file-overview";
import { parseTreePath } from "../src/lib/path-codec";
import {
  buildSearchPattern,
  buildRecordRows,
  collectStringifiedPaths,
  filterRecords,
  recordContainsStringifiedJson,
  resolveTreePath,
  resolveTreePathMatches,
  searchRecords,
  searchJsonValue,
  searchRecord,
} from "../src/lib/tree";

describe("tree paths", () => {
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
    const rows = buildRecordRows(record, new Set(["$.payload"]));
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

  it("builds and searches deep quoted paths without changing path output", () => {
    const depth = 36;
    let value: unknown = "needle";
    let expectedJsonPath = "$";
    let expectedJqPath = ".";

    for (let index = depth - 1; index >= 0; index--) {
      value = index % 2 === 0 ? { [`key.${index}`]: value } : [value];
    }

    for (let index = 0; index < depth; index++) {
      if (index % 2 === 0) {
        expectedJsonPath += `["key.${index}"]`;
        expectedJqPath += `["key.${index}"]`;
      } else {
        expectedJsonPath += "[0]";
        expectedJqPath += "[0]";
      }
    }

    const result = parseInput(JSON.stringify(value));
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set());
    const leaf = rows.find((row) => row.valueLabel === '"needle"');
    const matches = searchRecords(result.records, expectedJsonPath, {
      regex: false,
      caseSensitive: true,
      jq: true,
    });

    expect(leaf?.jsonPath).toBe(expectedJsonPath);
    expect(leaf?.jqPath).toBe(expectedJqPath);
    expect(matches).toEqual([
      expect.objectContaining({
        pathText: expectedJsonPath,
        pathRanges: [{ start: 0, end: expectedJsonPath.length }],
      }),
    ]);
  });

  it("collects stringified paths with quoted keys and array indexes", () => {
    const result = parseInput('{"payload":{"items":["{\\"a.b\\":1}"]}}');
    const record = result.records[0]!;

    expect(collectStringifiedPaths(record, new Set())).toEqual(["$.payload.items[0]"]);
  });

  it("searches raw JSON values with the same matches as a JsonNode tree", () => {
    const line = JSON.stringify({
      "a.b": "needle",
      payload: JSON.stringify({ nested: [{ value: "needle" }] }),
      nullable: "null",
    });
    const result = parseInput(line);
    const record = result.records[0]!;
    const options = { regex: false, caseSensitive: false, jq: false };
    const pattern = buildSearchPattern("needle", options);

    expect(pattern).not.toBeNull();
    expect(searchJsonValue(JSON.parse(line), record.id, pattern!, options)).toEqual(
      searchRecord(record, pattern!, options),
    );

    const nullPattern = buildSearchPattern("null", options);
    expect(nullPattern).not.toBeNull();
    expect(searchJsonValue(JSON.parse(line), record.id, nullPattern!, options)).toEqual(
      searchRecord(record, nullPattern!, options),
    );
  });

  it("limits long string labels without changing the node value", () => {
    const longValue = "a".repeat(600);
    const result = parseInput(JSON.stringify({ payload: longValue }));
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set());
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

  it("keeps overview fields and nested paths for deferred previews", () => {
    const record = {
      id: "record-1",
      lineNumber: 1,
      deferred: true,
      node: {
        kind: "object",
        value: null,
        path: ["$"],
        wasStringified: false,
        meta: {
          depth: 0,
          expandable: true,
          restorable: false,
          recordId: "record-1",
          sourceLine: 1,
        },
      },
      preview: {
        fields: { event: "tool_call", tool: "billing.search" },
        nestedFieldKeys: "args",
      },
      summary: "event:tool_call",
    } satisfies JsonlRecord;

    expect(createFileOverview([record])).toMatchObject({
      total: 1,
      success: 1,
      nestedRecords: 1,
      maxDepth: 1,
      topNestedPaths: [{ pathText: "$.args", count: 1 }],
    });
    expect(createFileOverview([record]).topFieldValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "event", value: "tool_call" }),
        expect.objectContaining({ field: "tool", value: "billing.search" }),
      ]),
    );
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
