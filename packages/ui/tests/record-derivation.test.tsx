import { parseInput, parseJsonlRecordLine, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// deriveRecord's whole point is to walk each record once instead of twice, so
// the traversal is wrapped here to make the call count observable.
const walkCalls = { count: 0 };
vi.mock("../src/lib/field-extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/field-extraction")>();
  return {
    ...actual,
    walkRecordFields: (
      ...args: Parameters<typeof actual.walkRecordFields>
    ): ReturnType<typeof actual.walkRecordFields> => {
      walkCalls.count += 1;
      return actual.walkRecordFields(...args);
    },
  };
});

const { createFileOverview } = await import("../src/lib/file-overview");
const { createRecordInsightMap } = await import("../src/lib/record-insight");
const { createRecordDerivationState, deriveRecord, updateRecordDerivations } =
  await import("../src/lib/record-derivation");

const parseRecords = (lines: string[]) =>
  parseInput(lines.join("\n"), { forcedFormat: "jsonl" }).records;

const sampleLines = [
  '{"event":"tool_call","tool":"billing.search","args":"{\\"status\\":\\"open\\"}"}',
  '{"created_at":"2026-05-15T10:02:11Z","severity":"info","speaker":"assistant","content":"done"}',
  '{"status":"failed","operation":"retry","detail":{"error":{"message":"boom"}}}',
  "not-json",
];

describe("record derivation", () => {
  beforeEach(() => {
    walkCalls.count = 0;
  });

  it("walks each record once for both insight and overview", () => {
    const records = parseRecords(sampleLines);
    const walkableCount = records.filter((record) => record.node).length;

    updateRecordDerivations(records, createRecordDerivationState());

    // Two independent pipelines walked every parsed record twice; the unparsed
    // line was walked once (by insight) and short-circuited by overview.
    expect(walkableCount).toBe(3);
    expect(walkCalls.count).toBe(walkableCount);
  });

  it("matches the standalone insight map and file overview", () => {
    const records = parseRecords(sampleLines);

    const derived = updateRecordDerivations(records, createRecordDerivationState());

    expect([...derived.insights]).toEqual([...createRecordInsightMap(records)]);
    expect(derived.overview).toEqual(createFileOverview(records));
  });

  it("keeps unparsed lines out of the insight map and counts them as failed", () => {
    const records = parseRecords(["not-json"]);

    const derived = updateRecordDerivations(records, createRecordDerivationState());

    expect(derived.insights.size).toBe(0);
    expect(derived.overview).toEqual({
      total: 1,
      success: 0,
      failed: 1,
      nestedRecords: 0,
      maxDepth: 0,
      structurePrecision: "exact",
    });
  });

  it("derives Preview Records without a full node tree", () => {
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

    const derivation = deriveRecord(record);

    expect(derivation.insight).toMatchObject({ kind: "tool", tool: "billing.search" });
    expect(derivation.overview).toMatchObject({
      hasNestedJson: true,
      maxDepth: 1,
      structurePrecision: "lower-bound",
    });
  });

  it("keeps published insights stable while upgrading structure precision", () => {
    const source = '{"timestamp":9007199254740993,"event":"checkpoint"}';
    const preview = deriveRecord(parsePreviewJsonlRecordLine(source, 1));
    const full = deriveRecord(parseJsonlRecordLine(source, 1));

    expect(preview.insight).toEqual(full.insight);
    expect(preview.overview.structurePrecision).toBe("lower-bound");
    expect(full.overview.structurePrecision).toBe("exact");
    expect(preview.insight?.timestamp).toBe("9007199254740993");
  });

  it("reuses the insight map instance across appends", () => {
    const records = parseRecords(sampleLines).slice(0, 1);
    const state = createRecordDerivationState();

    const first = updateRecordDerivations(records, state);
    const appendedRecords = [...records, ...parseRecords(sampleLines).slice(1)];
    const second = updateRecordDerivations(appendedRecords, state, {
      previousRecords: records,
    });

    expect(second.insights).toBe(first.insights);
    expect([...second.insights.keys()]).toEqual(["record-1", "record-2", "record-3"]);
  });

  it("stays equal to full recomputation across streamed appends and rebuilds", () => {
    const allRecords = parseRecords(
      Array.from({ length: 500 }, (_, index) =>
        JSON.stringify({
          event: `event-${index % 73}`,
          type: `type-${index % 41}`,
          level: index % 5 === 0 ? "error" : "info",
          payload: JSON.stringify({ index }),
        }),
      ),
    );
    const state = createRecordDerivationState();
    let streamedRecords: JsonlRecord[] = [];

    for (let offset = 0; offset < allRecords.length; offset += 17) {
      const previousRecords = streamedRecords;
      streamedRecords = [...streamedRecords, ...allRecords.slice(offset, offset + 17)];
      const derived = updateRecordDerivations(
        streamedRecords,
        state,
        previousRecords.length > 0 ? { previousRecords } : null,
      );
      expect([...derived.insights]).toEqual([...createRecordInsightMap(streamedRecords)]);
      expect(derived.overview).toEqual(createFileOverview(streamedRecords));
    }

    const shortened = allRecords.slice(0, 83);
    const rebuilt = updateRecordDerivations(shortened, state);
    expect([...rebuilt.insights]).toEqual([...createRecordInsightMap(shortened)]);
    expect(rebuilt.overview).toEqual(createFileOverview(shortened));
  });
});
