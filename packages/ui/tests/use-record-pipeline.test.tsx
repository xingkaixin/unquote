import { renderHook } from "@testing-library/react";
import type { JsonlRecord, ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { useRecordPipeline } from "../src/hooks/use-record-pipeline";
import type { SearchMatch } from "../src/lib/record-search";

const result = parseInput('{"value":1}\ninvalid\n{"value":2}', { forcedFormat: "jsonl" });

const createMatch = (recordId: string): SearchMatch => ({
  recordId,
  pathText: "$.value",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

const rec = (id: string): JsonlRecord => ({
  ...parseInput("not-json", { forcedFormat: "jsonl" }).records[0]!,
  id,
  summary: id,
});

const buildResult = (records: JsonlRecord[]): ParseResult => ({
  format: "jsonl",
  records,
  stats: { total: records.length, success: records.length, failed: 0 },
});

describe("useRecordPipeline", () => {
  it("preserves core stats for the unfiltered record set", () => {
    const matches = [createMatch("record-1"), createMatch("record-2")];
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({ sourceRevision: 0, result, searchMatches: matches, recordFilter: "all" }),
    );

    expect(pipeline.current.visibleRecords).toEqual(result.records);
    expect(pipeline.current.visibleStats).toBe(result.stats);
    expect(pipeline.current.visibleMatches).toEqual(matches);
    expect(pipeline.current.matchCount).toBe(2);
  });

  it("recalculates stats and matches from filtered records", () => {
    const matches = [createMatch("record-1"), createMatch("record-2")];
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({
        sourceRevision: 0,
        result,
        searchMatches: matches,
        recordFilter: "errors",
      }),
    );

    expect(pipeline.current.visibleRecords.map((record) => record.id)).toEqual(["record-2"]);
    expect(pipeline.current.visibleStats).toEqual({ total: 1, success: 0, failed: 1 });
    expect(pipeline.current.visibleMatches).toEqual([matches[1]]);
    expect(pipeline.current.matchCount).toBe(1);
  });

  it("keeps idle search results nullable", () => {
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({
        sourceRevision: 0,
        result,
        searchMatches: null,
        recordFilter: "matches",
      }),
    );

    expect(pipeline.current.visibleRecords).toEqual([]);
    expect(pipeline.current.visibleMatches).toBeNull();
    expect(pipeline.current.matchCount).toBe(0);
  });

  it("reuses the same recordsById Map instance across a streamed append", () => {
    const r1 = rec("r1");
    const r2 = rec("r2");
    const { result: pipeline, rerender } = renderHook(
      ({ result: streamed }: { result: ParseResult }) =>
        useRecordPipeline({
          sourceRevision: 0,
          result: streamed,
          searchMatches: null,
          recordFilter: "all",
        }),
      { initialProps: { result: buildResult([r1, r2]) } },
    );

    const mapBeforeAppend = pipeline.current.recordsById;

    const r3 = rec("r3");
    rerender({ result: buildResult([r1, r2, r3]) });

    expect(pipeline.current.recordsById).toBe(mapBeforeAppend);
    expect(pipeline.current.recordsById).toEqual(
      new Map([
        ["r1", r1],
        ["r2", r2],
        ["r3", r3],
      ]),
    );
  });

  it("rebuilds recordsById without stale entries when the source changes", () => {
    const r1 = rec("r1");
    const r2 = rec("r2");
    const { result: pipeline, rerender } = renderHook(
      ({ result: streamed }: { result: ParseResult }) =>
        useRecordPipeline({
          sourceRevision: 0,
          result: streamed,
          searchMatches: null,
          recordFilter: "all",
        }),
      { initialProps: { result: buildResult([r1, r2]) } },
    );

    const mapBeforeSwitch = pipeline.current.recordsById;

    const r4 = rec("r4");
    const r5 = rec("r5");
    rerender({ result: buildResult([r4, r5]) });

    expect(pipeline.current.recordsById).not.toBe(mapBeforeSwitch);
    expect(pipeline.current.recordsById.has("r1")).toBe(false);
    expect(pipeline.current.recordsById.has("r2")).toBe(false);
    expect(pipeline.current.recordsById).toEqual(
      new Map([
        ["r4", r4],
        ["r5", r5],
      ]),
    );
  });
});
