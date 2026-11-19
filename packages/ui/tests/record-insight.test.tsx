import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { createRecordInsight, createRecordInsightMap } from "../src/lib/record-insight";
import { filterRecords } from "../src/lib/record-filter";

describe("record insight", () => {
  it("extracts common field variants and classifies records", () => {
    const result = parseInput(
      [
        JSON.stringify({
          created_at: "2026-05-15T10:02:11Z",
          severity: "info",
          speaker: "assistant",
          type: "message",
          content: "The invoice lookup is complete.",
        }),
        JSON.stringify({
          time: "2026-05-15T10:02:12Z",
          status: "failed",
          operation: "retry",
          message: "tool timeout",
        }),
        JSON.stringify({
          payload: JSON.stringify({
            timestamp: "2026-05-15T10:02:13Z",
            function: { name: "billing.search" },
            action: "tool_call",
            args: { customerId: "cus_42" },
          }),
        }),
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );

    const message = createRecordInsight(result.records[0]!);
    const error = createRecordInsight(result.records[1]!);
    const tool = createRecordInsight(result.records[2]!);

    expect(message).toMatchObject({
      kind: "message",
      timestamp: "2026-05-15T10:02:11Z",
      level: "info",
      role: "assistant",
      event: "message",
      message: "The invoice lookup is complete.",
    });
    expect(error).toMatchObject({
      kind: "error",
      timestamp: "2026-05-15T10:02:12Z",
      status: "failed",
      event: "retry",
      error: "failed",
      message: "tool timeout",
    });
    expect(tool).toMatchObject({
      kind: "tool",
      timestamp: "2026-05-15T10:02:13Z",
      event: "tool_call",
      tool: "billing.search",
      nestedJsonCount: 1,
    });
  });

  // The field pickers changed from eight filter+sort passes to a single pass
  // keeping the minimum per field. These pin the tie-break order that the
  // stable sort used to provide.
  describe("field selection tie-breaks", () => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The fixture exercises insight extraction across arbitrary decoded JSON values.
    const insightFor = (value: unknown) => {
      const result = parseInput(JSON.stringify(value), { forcedFormat: "jsonl" });
      return createRecordInsight(result.records[0]!);
    };

    it("prefers the shallowest path", () => {
      expect(insightFor({ message: "shallow", nested: { message: "deep" } })?.message).toBe(
        "shallow",
      );
    });

    it("prefers the shorter value at equal depth", () => {
      expect(
        insightFor({ a: { message: "a much longer message" }, b: { message: "short" } })?.message,
      ).toBe("short");
    });

    it("prefers the shorter full input when both display values are truncated", () => {
      const shorter = "s".repeat(170);
      const longer = "l".repeat(200);

      expect(insightFor({ a: { message: longer }, b: { message: shorter } })?.message).toBe(
        `${"s".repeat(160)}...`,
      );
    });

    it("treats quoted keys as structural path segments", () => {
      expect(
        insightFor({ "a-b": { message: "a much longer message" }, z: { message: "short" } })
          ?.message,
      ).toBe("short");
    });

    it("prefers the lexicographically smaller path at equal depth and length", () => {
      expect(insightFor({ b: { message: "yy" }, a: { message: "xx" } })?.message).toBe("xx");
    });

    it("does not count array indices as extra field depth", () => {
      // Both paths contain two object fields, so the value length decides.
      expect(
        insightFor({ items: [{ message: "from array" }], other: { message: "hi" } })?.message,
      ).toBe("hi");
    });

    it("ranks error hits by key priority before path depth", () => {
      // `level` sits at depth 1 and `error` at depth 2, but the `error` key
      // outranks a level-derived error hit.
      expect(insightFor({ level: "failed", detail: { error: "boom" } })?.error).toBe("boom");
    });
  });

  it("filters records by insight type", () => {
    const result = parseInput(
      [
        '{"event":"message","role":"assistant","content":"ready"}',
        '{"event":"tool_call","tool_name":"billing.search","args":{"status":"open"}}',
        '{"level":"error","message":"parse_error"}',
        "not-json",
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );
    const insights = createRecordInsightMap(result.records);

    expect(
      filterRecords(result.records, "message", null, insights).map((record) => record.lineNumber),
    ).toEqual([1]);
    expect(
      filterRecords(result.records, "tool", null, insights).map((record) => record.lineNumber),
    ).toEqual([2]);
    expect(
      filterRecords(result.records, "errors", null, insights).map((record) => record.lineNumber),
    ).toEqual([3, 4]);
  });

  it("filters nested records from insights without reading record trees", () => {
    const result = parseInput('{"payload":"{\\"nested\\":true}"}\n{"payload":{"nested":true}}', {
      forcedFormat: "jsonl",
    });
    const insights = createRecordInsightMap(result.records);
    const guardedRecords = result.records.map(
      (record) =>
        new Proxy(record, {
          get(target, property, receiver) {
            if (property === "node") {
              throw new Error("nested filtering read the record tree");
            }
            // oxlint-disable-next-line anti-slop/no-reflect-get -- Forward Proxy property access with the original receiver so getters preserve their semantics.
            return Reflect.get(target, property, receiver);
          },
        }),
    );

    expect(
      filterRecords(guardedRecords, "nested", null, insights).map((record) => record.lineNumber),
    ).toEqual([1]);
  });

  it("does not classify AGENTS instructions as errors from wording", () => {
    const result = parseInput(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "# AGENTS.md instructions for /repo\n\nDon't add error handling unless needed.",
            },
          ],
        },
      }),
      { forcedFormat: "jsonl" },
    );

    const insight = createRecordInsight(result.records[0]!);

    expect(insight).toMatchObject({
      kind: "message",
      event: "response_item",
      role: "user",
    });
    expect(insight?.error).toBeUndefined();
  });

  it("does not classify ordinary message prose containing error words as errors", () => {
    const result = parseInput(
      [
        JSON.stringify({ role: "assistant", content: "Fixed the timeout error in the parser." }),
        JSON.stringify({ message: "Retry failed attempts after an exception occurs." }),
        JSON.stringify({ msg: "fatal panic handling docs" }),
        JSON.stringify({ summary: "No error found during check" }),
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );

    for (const record of result.records) {
      const insight = createRecordInsight(record);
      expect(insight?.kind).toBe("message");
      expect(insight?.error).toBeUndefined();
    }
  });

  it("accepts progress on stderr from a successful command", () => {
    const { records } = parseInput(
      '{"status":"success","exitCode":0,"stderr":"Downloading dependencies…"}',
      { forcedFormat: "jsonl" },
    );
    expect(createRecordInsight(records[0]!)?.kind).not.toBe("error");
  });

  it("still classifies explicit error keys and error event or level values as errors", () => {
    const result = parseInput(
      [
        JSON.stringify({ error: "boom" }),
        JSON.stringify({ err: "ECONNRESET" }),
        JSON.stringify({ exception: "ValueError" }),
        JSON.stringify({ stack: "Error: boom\n  at run" }),
        JSON.stringify({ status: "failed", stderr: "permission denied" }),
        JSON.stringify({ level: "error", message: "request dropped" }),
        JSON.stringify({ type: "error", message: "rate limited" }),
        JSON.stringify({ status: "failed", message: "job aborted" }),
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );

    for (const record of result.records) {
      const insight = createRecordInsight(record);
      expect(insight?.kind).toBe("error");
      expect(insight?.error).toBeDefined();
    }
  });

  it("does not split surrogate pairs in insight titles", () => {
    const prefix = "a".repeat(95);
    const result = parseInput(JSON.stringify({ message: `${prefix}😀tail` }), {
      forcedFormat: "jsonl",
    });

    expect(createRecordInsight(result.records[0]!)?.title).toBe(`${prefix}...`);
  });

  it("derives the same filter fields from a Preview Record", () => {
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
        fields: {
          timestamp: "2026-05-15T10:02:11Z",
          type: "tool_call",
          tool_name: "billing.search",
          message: "ready",
        },
        nestedFieldKeys: ["payload"],
      },
      summary: "type:tool_call",
    } satisfies JsonlRecord;

    const insight = createRecordInsight(record);

    expect(insight).toMatchObject({
      kind: "tool",
      timestamp: "2026-05-15T10:02:11Z",
      event: "tool_call",
      tool: "billing.search",
      message: "ready",
      nestedJsonCount: 1,
    });
    expect(filterRecords([record], "nested", null, createRecordInsightMap([record]))).toEqual([
      record,
    ]);
  });
});
