import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { createRecordInsight, createRecordInsightMap } from "../src/lib/record-insight";
import { filterRecords } from "../src/lib/tree";

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
      error: "tool timeout",
    });
    expect(tool).toMatchObject({
      kind: "tool",
      timestamp: "2026-05-15T10:02:13Z",
      event: "tool_call",
      tool: "billing.search",
      nestedJsonCount: 1,
    });
    expect(tool?.maxDepth).toBeGreaterThanOrEqual(3);
    expect(tool?.keyPaths).toEqual(
      expect.arrayContaining(["$.payload.timestamp", "$.payload.function.name"]),
    );
  });

  it("filters records by insight type and field value", () => {
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
    expect(
      filterRecords(result.records, "insight", null, insights, "billing.search").map(
        (record) => record.lineNumber,
      ),
    ).toEqual([2]);
  });
});
