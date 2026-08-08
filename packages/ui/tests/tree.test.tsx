import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import { createFileOverview } from "../src/lib/file-overview";
import { parseTreePath } from "../src/lib/path-codec";
import { filterRecords } from "../src/lib/record-filter";
import { buildSearchPattern, searchJsonValue, searchRecords } from "../src/lib/record-search";
import type { SearchResultSet } from "../src/lib/record-search";
import { buildRecordRows, collectStringifiedPaths } from "../src/lib/tree";
import { resolveTreePath, resolveTreePathMatches } from "../src/lib/tree-path";

const oversizedMatchCount = 130_000;
const matchesOf = (result: SearchResultSet | null) => result?.window.matches ?? null;

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

    expect(resolved.targets).toEqual([
      { recordId: "record-1", pathText: "$.payload.type" },
      { recordId: "record-2", pathText: "$.payload.type" },
    ]);
  });

  it("projects only the fields the renderer, virtualizer, and selection read", () => {
    const record = parseInput('{"a":{"b":1}}', { forcedFormat: "json" }).records[0]!;
    const rows = buildRecordRows(record, new Set());

    // A guard against re-introducing per-node state under a different name:
    // every field here has a production reader.
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "depth",
      "expanded",
      "id",
      "insideStringified",
      "keyLabel",
      "kind",
      "node",
      "pathText",
      "valueLabel",
      "wasStringified",
    ]);
  });

  it("addresses every row by its record id and full path", () => {
    const record = parseInput('{"outer":{"inner":{"leaf":1}}}', { forcedFormat: "json" })
      .records[0]!;
    const rows = buildRecordRows(record, new Set());

    expect(rows.map((row) => row.pathText)).toEqual([
      "$",
      "$.outer",
      "$.outer.inner",
      "$.outer.inner.leaf",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3]);
    expect(rows[2]?.id).toBe(`${record.id}:$.outer.inner`);
    expect(rows[3]?.keyLabel).toBe("leaf");
  });

  it("uses the exact source lexeme for number rows", () => {
    const record = parseInput('{"large":9007199254740993,"exponent":1e400}').records[0]!;
    const rows = buildRecordRows(record, new Set());

    expect(rows.find((row) => row.pathText === "$.large")?.valueLabel).toBe("9007199254740993");
    expect(rows.find((row) => row.pathText === "$.exponent")?.valueLabel).toBe("1e400");
  });

  it("serializes numeric object keys as quoted keys", () => {
    const result = parseInput('{"payload":"{\\"items\\":[{\\"0\\":\\"zero\\"}]}"}');
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set(["$.payload"]));
    const numericKey = rows.find((row) => row.valueLabel === '"zero"');

    expect(numericKey?.pathText).toBe('$.payload.items[0]["0"]');
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

    for (let index = depth - 1; index >= 0; index--) {
      value = index % 2 === 0 ? { [`key.${index}`]: value } : [value];
    }

    for (let index = 0; index < depth; index++) {
      if (index % 2 === 0) {
        expectedJsonPath += `["key.${index}"]`;
      } else {
        expectedJsonPath += "[0]";
      }
    }

    const result = parseInput(JSON.stringify(value));
    const record = result.records[0]!;
    const rows = buildRecordRows(record, new Set());
    const leaf = rows.find((row) => row.valueLabel === '"needle"');
    const matches = matchesOf(
      searchRecords(result.records, expectedJsonPath, {
        regex: false,
        caseSensitive: true,
        jq: true,
      }),
    );

    expect(leaf?.pathText).toBe(expectedJsonPath);
    expect(matches).toEqual([
      expect.objectContaining({
        pathText: expectedJsonPath,
        pathRanges: [{ start: 0, end: expectedJsonPath.length }],
      }),
    ]);
  });

  it("marks the rows an escaped payload was unwrapped into, not its boundary", () => {
    const record = parseInput('{"payload":"{\\"answer\\":{\\"n\\":42}}","status":"ok"}')
      .records[0]!;
    const rows = buildRecordRows(record, new Set(["$.payload"]));
    const insideByPath = new Map(rows.map((row) => [row.pathText, row.insideStringified]));

    expect(insideByPath.get("$")).toBe(false);
    expect(insideByPath.get("$.status")).toBe(false);
    expect(insideByPath.get("$.payload")).toBe(false);
    expect(insideByPath.get("$.payload.answer")).toBe(true);
    expect(insideByPath.get("$.payload.answer.n")).toBe(true);
  });

  it("leaves a collapsed boundary's payload unmarked because it has no rows", () => {
    const record = parseInput('{"payload":"{\\"answer\\":42}"}').records[0]!;
    const rows = buildRecordRows(record, new Set());

    expect(rows.map((row) => row.insideStringified)).toEqual([false, false]);
  });

  it("collects stringified paths with quoted keys and array indexes", () => {
    const result = parseInput('{"payload":{"items":["{\\"a.b\\":1}"]}}');
    const record = result.records[0]!;

    expect(collectStringifiedPaths(record, new Set())).toEqual(["$.payload.items[0]"]);
  });

  it("collects a Preview Record's nested fields", () => {
    // The projected node of a Preview Record carries no children, so the tree
    // walk finds nothing; the preview is the only record of what is nested.
    const line = '{"type":"response_item","payload":"{\\"a\\":1}","note":"plain"}';
    const parsed = parseInput(line, { forcedFormat: "jsonl" }).records[0]!;
    const preview = parsePreviewJsonlRecordLine(line, 1);

    expect(preview.status).toBe("preview");
    expect(preview.node?.children).toBeUndefined();
    expect(collectStringifiedPaths(parsed, new Set())).toEqual(["$.payload"]);
    expect(collectStringifiedPaths(preview, new Set())).toEqual(["$.payload"]);
  });

  it("reports no nested fields for a Preview Record without stringified JSON", () => {
    const preview = parsePreviewJsonlRecordLine('{"type":"event","note":"plain"}', 1);

    expect(collectStringifiedPaths(preview, new Set())).toEqual([]);
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
      searchRecords([record], "needle", options),
    );

    const nullPattern = buildSearchPattern("null", options);
    expect(nullPattern).not.toBeNull();
    expect(searchJsonValue(JSON.parse(line), record.id, nullPattern!, options)).toEqual(
      searchRecords([record], "null", options),
    );
  });

  it("searches object keys without treating roots or array indexes as keys", () => {
    const result = parseInput('{"0":"object-key","items":[10,20,30]}');
    const options = { regex: false, caseSensitive: true, jq: false };
    const matches = matchesOf(searchRecords(result.records, "0", options));

    expect(matches).toEqual([
      expect.objectContaining({
        pathText: '$["0"]',
        keyRanges: [{ start: 0, end: 1 }],
        valueRanges: [],
      }),
      expect.objectContaining({
        pathText: "$.items[0]",
        keyRanges: [],
        valueRanges: [{ start: 1, end: 2 }],
      }),
      expect.objectContaining({
        pathText: "$.items[1]",
        keyRanges: [],
        valueRanges: [{ start: 1, end: 2 }],
      }),
      expect.objectContaining({
        pathText: "$.items[2]",
        keyRanges: [],
        valueRanges: [{ start: 1, end: 2 }],
      }),
    ]);
    expect(matchesOf(searchRecords(result.records, "$", options))).toEqual([]);
  });

  // Takes ~5s on slow CI runners, right at the default 5000ms timeout.
  it(
    "aggregates a record with more matches than the function argument limit",
    { timeout: 15_000 },
    () => {
      const values = Array.from({ length: oversizedMatchCount }, () => "needle");
      const result = parseInput(JSON.stringify(values));

      const searchResult = searchRecords(result.records, "needle", {
        regex: false,
        caseSensitive: true,
        jq: false,
      });

      expect(searchResult?.total).toBe(oversizedMatchCount);
      expect(searchResult?.matchLineNumbers).toHaveLength(oversizedMatchCount);
      expect(searchResult?.window.matches).toHaveLength(128);
    },
  );

  it("prefilters ordinary strings without skipping valid stringified JSON scalars", () => {
    const values = [
      "ordinary log message",
      "truthy",
      "false alarm",
      "nullish",
      "01",
      "1.",
      "1e",
      "-",
      "  true  ",
      "\tfalse\n",
      " null\r",
      "0",
      "-12.5e+2",
      '"nested"',
      '{"nested":true}',
      "[1,2]",
    ];
    const pattern = buildSearchPattern("nested", {
      regex: false,
      caseSensitive: true,
      jq: false,
    })!;
    const parse = vi.spyOn(JSON, "parse");

    const matches = searchJsonValue(values, "record-1", pattern, {
      regex: false,
      caseSensitive: true,
      jq: false,
    }).window.matches;

    expect(parse).toHaveBeenCalledTimes(8);
    expect(matches.map((match) => match.pathText)).toEqual(["$[13]", "$[14].nested"]);
    parse.mockRestore();
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

  it("aligns long-value search ranges with the rendered label", () => {
    const value = `${"a".repeat(500)}visible${"b".repeat(5)}edge${"c".repeat(100)}deep`;
    const key = `${value.length} chars`;
    const pathText = `$["${key}"]`;
    const result = parseInput(JSON.stringify({ [key]: value }));
    const record = result.records[0]!;
    const row = buildRecordRows(record, new Set()).find(
      (candidate) => candidate.pathText === pathText,
    )!;
    const options = { regex: false, caseSensitive: true, jq: false };

    const visibleMatch = matchesOf(searchRecords(result.records, "visible", options));
    const boundaryMatch = matchesOf(searchRecords(result.records, "edge", options));
    const deepMatch = matchesOf(searchRecords(result.records, "deep", options));
    const decorationMatch = matchesOf(searchRecords(result.records, key, options));

    expect(visibleMatch).toHaveLength(1);
    expect(
      visibleMatch![0]!.valueRanges.map((range) => row.valueLabel.slice(range.start, range.end)),
    ).toEqual(["visible"]);
    expect(boundaryMatch).toEqual([expect.objectContaining({ pathText, valueRanges: [] })]);
    expect(deepMatch).toEqual([expect.objectContaining({ pathText, valueRanges: [] })]);
    expect(decorationMatch).toEqual([
      expect.objectContaining({
        pathText,
        keyRanges: [{ start: 0, end: key.length }],
        valueRanges: [],
      }),
    ]);
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

    expect(overview).toEqual({
      total: 3,
      success: 2,
      failed: 1,
      nestedRecords: 1,
      maxDepth: 2,
    });
  });

  it("counts nested JSON and depth for Preview Records", () => {
    const record = {
      id: "record-1",
      lineNumber: 1,
      status: "preview",
      node: {
        kind: "object",
        childCount: 0,
        preview: true,
      },
      preview: {
        fields: { event: "tool_call", tool: "billing.search" },
        nestedFieldKeys: ["args"],
      },
      summary: "event:tool_call",
    } satisfies JsonlRecord;

    expect(createFileOverview([record])).toEqual({
      total: 1,
      success: 1,
      failed: 0,
      nestedRecords: 1,
      maxDepth: 1,
    });
  });
});
