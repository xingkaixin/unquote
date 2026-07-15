import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordInsightSummary } from "../src/components/record-insight";
import { I18nProvider } from "../src/i18n/context";
import {
  createRecordInsight,
  createRecordInsightMap,
  createRecordInsightMapState,
  updateRecordInsightMap,
} from "../src/lib/record-insight";
import { filterRecords } from "../src/lib/tree";

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
            keyPaths: [],
            filterText: "message",
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
    expect(tool?.keyPaths).toEqual(
      expect.arrayContaining(["$.payload.timestamp", "$.payload.function.name"]),
    );
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

  it("derives the same filter fields from a deferred preview", () => {
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

  it("updates the insight map incrementally for appended records", () => {
    const result = parseInput(
      [
        '{"event":"message","role":"assistant","content":"ready"}',
        '{"event":"tool_call","tool_name":"billing.search"}',
      ].join("\n"),
      { forcedFormat: "jsonl" },
    );
    const records = result.records.slice(0, 1);
    const state = createRecordInsightMapState();

    const first = updateRecordInsightMap(records, state);
    expect(first.get("record-1")?.kind).toBe("message");

    records.push(result.records[1]!);
    const second = updateRecordInsightMap(records, state);

    expect(second).toBe(first);
    expect([...second.keys()]).toEqual(["record-1", "record-2"]);
    expect(second.get("record-2")?.kind).toBe("tool");
  });
});
