import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { searchRecords, searchResultWindowSize } from "../src/lib/record-search";
import { createSearchResultVisibility, projectSearchResult } from "../src/lib/search-result";

const options = { syntax: "text", caseSensitive: true } as const;

const makeRecords = (count: number) =>
  parseInput(
    Array.from({ length: count }, (_, index) => JSON.stringify({ index, message: "needle" })).join(
      "\n",
    ),
    { forcedFormat: "jsonl" },
  ).records;

const project = (
  result: NonNullable<ReturnType<typeof searchRecords>>,
  records: ReturnType<typeof makeRecords>,
  currentIndex: number,
) =>
  projectSearchResult(
    result,
    createSearchResultVisibility(result.matchLineNumbers, records),
    currentIndex,
  );

describe("search result windows", () => {
  it("keeps rich matches bounded while retaining the exact total", () => {
    const records = makeRecords(300);
    const result = searchRecords(records, "needle", options)!;

    expect(result.total).toBe(300);
    expect(result.matchLineNumbers).toHaveLength(300);
    expect(result.window.matches).toHaveLength(searchResultWindowSize);
    expect(result.window.matchIndexes[0]).toBe(0);
    expect(result.window.matchIndexes.at(-1)).toBe(searchResultWindowSize - 1);
  });

  it("loads forward and reverse windows without changing navigation order", () => {
    const records = makeRecords(300);
    const initial = searchRecords(records, "needle", options)!;
    const forwardRequest = project(initial, records, 128);

    expect(forwardRequest.matchCount).toBe(300);
    expect(forwardRequest.activeMatch).toBeNull();
    expect(forwardRequest.requestedWindowIndexes[0]).toBe(96);
    expect(forwardRequest.requestedWindowIndexes.at(-1)).toBe(223);

    const forward = searchRecords(
      records,
      "needle",
      options,
      forwardRequest.requestedWindowIndexes,
    )!;
    expect(project(forward, records, 128).activeMatch).toMatchObject({
      recordId: "record-129",
      pathText: "$.message",
    });

    const reverseRequest = project(forward, records, 95);
    expect(reverseRequest.activeMatch).toBeNull();
    const reverse = searchRecords(
      records,
      "needle",
      options,
      reverseRequest.requestedWindowIndexes,
    )!;
    expect(project(reverse, records, 95).activeMatch).toMatchObject({
      recordId: "record-96",
      pathText: "$.message",
    });
  });

  it("projects filtered navigation to exact global match indexes", () => {
    const records = makeRecords(300);
    const visibleRecords = records.filter((record) => record.lineNumber % 3 === 0);
    const initial = searchRecords(records, "needle", options)!;
    const projection = project(initial, visibleRecords, 40);

    expect(projection.matchCount).toBe(100);
    expect(projection.requestedWindowIndexes[40]).toBe(122);

    const filtered = searchRecords(records, "needle", options, projection.requestedWindowIndexes)!;
    expect(project(filtered, visibleRecords, 40).activeMatch).toMatchObject({
      recordId: "record-123",
      pathText: "$.message",
    });
  });

  it("preserves stringified expansion chains in a distant window", () => {
    const records = parseInput(
      Array.from({ length: 140 }, () =>
        JSON.stringify({ payload: JSON.stringify({ message: "needle" }) }),
      ).join("\n"),
      { forcedFormat: "jsonl" },
    ).records;
    const initial = searchRecords(records, "needle", options)!;
    const request = project(initial, records, 128);
    const distant = searchRecords(records, "needle", options, request.requestedWindowIndexes)!;

    expect(initial.total).toBe(140);
    expect(project(distant, records, 128).activeMatch).toMatchObject({
      recordId: "record-129",
      pathText: "$.payload.message",
      stringifiedPathChain: ["$.payload"],
    });
  });

  it("enforces the window bound at the execution seam", () => {
    const records = makeRecords(300);
    const requested = Float64Array.from({ length: 300 }, (_, index) => index);
    const result = searchRecords(records, "needle", options, requested)!;

    expect(result.window.matches).toHaveLength(searchResultWindowSize);
    expect(result.window.matchIndexes).toHaveLength(searchResultWindowSize);
  });
});
