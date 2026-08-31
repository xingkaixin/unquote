import { renderHook } from "@testing-library/react";
import type { JsonlRecord, ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { useRecordPipeline } from "../src/hooks/use-record-pipeline";
import type { SearchMatch, SearchResultSet } from "../src/lib/record-search";
import type { RecordAppend } from "../src/lib/record-sequence";
import { createMemorySearch } from "../src/lib/memory-search";

const result = parseInput('{"value":1}\ninvalid\n{"value":2}', { forcedFormat: "jsonl" });

const createMatch = (recordId: string): SearchMatch => ({
  recordId,
  pathText: "$.value",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

const createSearchResult = (matches: SearchMatch[]): SearchResultSet => ({
  total: matches.length,
  matchLineNumbers: Float64Array.from(
    matches.map((match) => Number(match.recordId.replace("record-", ""))),
  ),
  window: {
    matchIndexes: Float64Array.from(matches.map((_, index) => index)),
    matches,
  },
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

interface StreamedPipelineProps {
  result: ParseResult;
  recordAppend: RecordAppend | null;
}

describe("useRecordPipeline", () => {
  it("preserves core stats for the unfiltered record set", () => {
    const matches = [createMatch("record-1"), createMatch("record-2")];
    const { result: pipeline } = renderHook(() =>
      useRecordPipeline({
        sourceRevision: 0,
        result,
        searchResult: createSearchResult(matches),
        recordFilter: "all",
      }),
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
        searchResult: createSearchResult(matches),
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
        searchResult: null,
        recordFilter: "matches",
      }),
    );

    expect(pipeline.current.visibleRecords).toEqual([]);
    expect(pipeline.current.visibleMatches).toBeNull();
    expect(pipeline.current.matchCount).toBe(0);
  });

  it.each(["all", "matches"] as const)(
    "reuses the %s record projection when only the search window changes",
    (recordFilter) => {
      const parsed = parseInput(
        Array.from({ length: 300 }, (_, index) =>
          JSON.stringify({ value: `needle-${index}` }),
        ).join("\n"),
        { forcedFormat: "jsonl" },
      );
      const search = createMemorySearch(parsed.records);
      const options = { syntax: "text", caseSensitive: true } as const;
      const initial = search("needle", options)!;
      const distant = search("needle", options, Float64Array.of(299))!;
      const differentQuery = search("needle-299", options)!;
      let lineReads = 0;
      for (const record of parsed.records) {
        const lineNumber = record.lineNumber;
        Object.defineProperty(record, "lineNumber", {
          get: () => {
            lineReads += 1;
            return lineNumber;
          },
        });
      }
      const { result: pipeline, rerender } = renderHook(
        ({ searchResult, currentMatchIndex }) =>
          useRecordPipeline({
            sourceRevision: 0,
            result: parsed,
            searchResult,
            currentMatchIndex,
            recordFilter,
          }),
        { initialProps: { searchResult: initial, currentMatchIndex: 0 } },
      );
      const visibleRecords = pipeline.current.visibleRecords;
      lineReads = 0;

      rerender({ searchResult: distant, currentMatchIndex: 299 });

      expect(lineReads).toBe(0);
      expect(pipeline.current.visibleRecords).toBe(visibleRecords);
      expect(pipeline.current.activeSearchMatch?.recordId).toBe("record-300");
      expect(pipeline.current.matchCount).toBe(300);

      rerender({ searchResult: differentQuery, currentMatchIndex: 0 });

      expect(pipeline.current.activeSearchMatch?.recordId).toBe("record-300");
      expect(pipeline.current.matchCount).toBe(1);
      if (recordFilter === "matches") {
        expect(pipeline.current.visibleRecords.map((record) => record.id)).toEqual(["record-300"]);
      }
    },
  );

  it("keeps the previous record lookup bounded when records append", () => {
    const r1 = rec("r1");
    const r2 = rec("r2");
    const initialResult = buildResult([r1, r2]);
    const initialProps: StreamedPipelineProps = {
      result: initialResult,
      recordAppend: null,
    };
    const { result: pipeline, rerender } = renderHook(
      ({ result: streamed, recordAppend }: StreamedPipelineProps) =>
        useRecordPipeline({
          sourceRevision: 0,
          result: streamed,
          searchResult: null,
          recordFilter: "all",
          recordAppend,
        }),
      { initialProps },
    );

    const lookupBeforeAppend = pipeline.current.recordsById;

    const r3 = rec("r3");
    rerender({
      result: buildResult([r1, r2, r3]),
      recordAppend: { previousRecords: initialResult.records },
    });

    expect(pipeline.current.recordsById).not.toBe(lookupBeforeAppend);
    expect(lookupBeforeAppend.size).toBe(2);
    expect(lookupBeforeAppend.get("r1")).toBe(r1);
    expect(lookupBeforeAppend.get("r2")).toBe(r2);
    expect(lookupBeforeAppend.get("r3")).toBeUndefined();
    expect(pipeline.current.visibleRecordAppend).toEqual({
      previousRecords: initialResult.records,
    });
    expect(pipeline.current.recordsById.size).toBe(3);
    expect(pipeline.current.recordsById.get("r1")).toBe(r1);
    expect(pipeline.current.recordsById.get("r2")).toBe(r2);
    expect(pipeline.current.recordsById.get("r3")).toBe(r3);
  });

  it("rebuilds recordsById without stale entries when the source changes", () => {
    const r1 = rec("r1");
    const r2 = rec("r2");
    const { result: pipeline, rerender } = renderHook(
      ({ result: streamed }: { result: ParseResult }) =>
        useRecordPipeline({
          sourceRevision: 0,
          result: streamed,
          searchResult: null,
          recordFilter: "all",
        }),
      { initialProps: { result: buildResult([r1, r2]) } },
    );

    const lookupBeforeSwitch = pipeline.current.recordsById;

    const r4 = rec("r4");
    const r5 = rec("r5");
    rerender({ result: buildResult([r4, r5]) });

    expect(pipeline.current.recordsById).not.toBe(lookupBeforeSwitch);
    expect(lookupBeforeSwitch.get("r1")).toBe(r1);
    expect(lookupBeforeSwitch.get("r4")).toBeUndefined();
    expect(pipeline.current.recordsById.has("r1")).toBe(false);
    expect(pipeline.current.recordsById.has("r2")).toBe(false);
    expect(pipeline.current.recordsById.size).toBe(2);
    expect(pipeline.current.recordsById.get("r4")).toBe(r4);
    expect(pipeline.current.recordsById.get("r5")).toBe(r5);
  });
});
