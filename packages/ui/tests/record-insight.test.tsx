import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordInsightSummary } from "../src/components/record-insight";
import { I18nProvider } from "../src/i18n/context";
import { createRecordInsight, createRecordInsightMap } from "../src/lib/record-insight";
import { filterRecords } from "../src/lib/record-filter";

describe("record insight", () => {
  it("renders the message kind with the neutral badge variant", () => {
    render(
      <I18nProvider>
        <RecordInsightSummary
          insight={{
            recordId: "record-1",
            lineNumber: 1,
            kind: "message",
            title: "message",
            nestedJsonCount: 0,
            maxDepth: 0,
            keyPathCount: 0,
          }}
        />
      </I18nProvider>,
    );

    const badge = screen.getByText("Message").closest("div");
    expect(badge).toHaveClass("text-text-muted");
    expect(badge).not.toHaveClass("text-success");
  });

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
    expect(tool?.keyPathCount).toBeGreaterThanOrEqual(2);
  });

  // The field pickers changed from eight filter+sort passes to a single pass
  // keeping the minimum per field. These pin the tie-break order that the
  // stable sort used to provide.
  describe("field selection tie-breaks", () => {
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

    it("prefers the lexicographically smaller path at equal depth and length", () => {
      expect(insightFor({ b: { message: "yy" }, a: { message: "xx" } })?.message).toBe("xx");
    });

    it("counts array indices as no extra depth, matching the path separators", () => {
      // `$.items[0].message` and `$.other.message` both carry two separators,
      // so the value length decides.
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
        nestedFieldKeys: "payload",
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
      maxDepth: 1,
    });
    expect(filterRecords([record], "nested", null)).toEqual([record]);
  });
});
