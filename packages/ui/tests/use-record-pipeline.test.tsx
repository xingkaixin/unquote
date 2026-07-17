import { renderHook } from "@testing-library/react";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { useRecordPipeline } from "../src/hooks/use-record-pipeline";
import type { SearchMatch } from "../src/lib/tree";

const result = parseInput('{"value":1}\ninvalid\n{"value":2}', { forcedFormat: "jsonl" });

const createMatch = (recordId: string): SearchMatch => ({
  recordId,
  pathText: "$.value",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

describe("useRecordPipeline", () => {
  it("preserves core stats for the unfiltered record set", () => {
    const matches = [createMatch("record-1"), createMatch("record-2")];
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({ result, searchMatches: matches, recordFilter: "all" }),
    );

    expect(pipeline.current.visibleRecords).toEqual(result.records);
    expect(pipeline.current.visibleStats).toBe(result.stats);
    expect(pipeline.current.visibleMatches).toEqual(matches);
    expect(pipeline.current.matchCount).toBe(2);
  });

  it("recalculates stats and matches from filtered records", () => {
    const matches = [createMatch("record-1"), createMatch("record-2")];
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({ result, searchMatches: matches, recordFilter: "errors" }),
    );

    expect(pipeline.current.visibleRecords.map((record) => record.id)).toEqual(["record-2"]);
    expect(pipeline.current.visibleStats).toEqual({ total: 1, success: 0, failed: 1 });
    expect(pipeline.current.visibleMatches).toEqual([matches[1]]);
    expect(pipeline.current.matchCount).toBe(1);
  });

  it("keeps idle search results nullable", () => {
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({ result, searchMatches: null, recordFilter: "matches" }),
    );

    expect(pipeline.current.visibleRecords).toEqual([]);
    expect(pipeline.current.visibleMatches).toBeNull();
    expect(pipeline.current.matchCount).toBe(0);
  });
});
