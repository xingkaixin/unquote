import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { createMemorySearch } from "../src/lib/memory-search";
import { searchRecords, searchResultWindowSize } from "../src/lib/record-search";
import type { SearchOptions } from "../src/lib/record-search";

const textOptions: SearchOptions = { syntax: "text", caseSensitive: false };
const recordsFrom = (text: string) => parseInput(text, { forcedFormat: "jsonl" }).records;

const measuredRecords = (count = 200) => {
  const records = recordsFrom(
    Array.from({ length: count }, (_, i) =>
      JSON.stringify({ first: `needle-${i}`, second: "Needle" }),
    ).join("\n"),
  );
  let reads = 0;
  for (const record of records) {
    const node = record.node;
    Object.defineProperty(record, "node", {
      get: () => {
        reads += 1;
        return node;
      },
    });
  }
  return {
    records,
    reads: () => reads,
    reset: () => {
      reads = 0;
    },
  };
};

describe("memory search cache", () => {
  it("reuses the index and retains only a bounded initial match window", () => {
    const fixture = measuredRecords();
    const search = createMemorySearch(fixture.records);
    const initial = search("needle", textOptions)!;
    expect(initial.total).toBe(400);
    expect(initial.window.matches).toHaveLength(searchResultWindowSize);
    fixture.reset();
    const window = search("needle", textOptions, [201, 200, 399])!;
    expect(window.matchLineNumbers).toBe(initial.matchLineNumbers);
    expect([...window.window.matchIndexes]).toEqual([200, 201, 399]);
    expect(window.window.matches.map((match) => match.recordId)).toEqual([
      "record-101",
      "record-101",
      "record-200",
    ]);
    expect(fixture.reads()).toBe(2);
    fixture.reset();
    expect(search("needle", textOptions)).toBe(initial);
    expect(fixture.reads()).toBe(0);
    const first = search("needle", textOptions, [0])!;
    expect(first.window.matches[0]?.recordId).toBe("record-1");
    expect(fixture.reads()).toBe(1);
  });
});

it("invalidates the cached query when options or query text change", () => {
  const records = recordsFrom('{"value":"Needle"}\n{"value":"needle"}');
  const search = createMemorySearch(records);
  expect(search("needle", textOptions)?.total).toBe(2);
  expect(search("needle", { ...textOptions, caseSensitive: true })?.total).toBe(1);
  expect(search("missing", textOptions)?.total).toBe(0);
  expect(search("(", { ...textOptions, syntax: "regex" })).toBeNull();
  expect(search("", textOptions)).toBeNull();
  expect(search("needle", textOptions)?.total).toBe(2);
});

it.each(["text", "regex", "jq", "path"] as const)("preserves %s window results", (syntax) => {
  const line = JSON.stringify({
    payload: { needle: "Needle" },
    nested: JSON.stringify({ value: "needle" }),
  });
  const records = recordsFrom(Array.from({ length: 150 }, () => line).join("\n"));
  const query = syntax === "path" ? ".payload.needle" : "needle";
  const options: SearchOptions = { syntax, caseSensitive: false };
  const search = createMemorySearch(records);
  search(query, options);
  const indexes = [129, 2, 130, -1, NaN, 129, 99999];
  expect(search(query, options, indexes)).toEqual(searchRecords(records, query, options, indexes));
});

it("bounds windows and ignores invalid indexes without rescanning records", () => {
  const fixture = measuredRecords();
  const search = createMemorySearch(fixture.records);
  search("needle", textOptions);
  fixture.reset();
  const empty = search("needle", textOptions, [-1, NaN, Infinity, 0.5, 9999])!;
  expect(empty.window.matches).toEqual([]);
  expect(fixture.reads()).toBe(0);
  const large = search(
    "needle",
    textOptions,
    Array.from({ length: 300 }, (_, i) => i),
  )!;
  expect(large.window.matches).toHaveLength(searchResultWindowSize);
  expect(fixture.reads()).toBe(searchResultWindowSize / 2);
});

it("copies options so external mutation cannot change the cached query key", () => {
  const search = createMemorySearch(recordsFrom('{"value":"Needle"}'));
  const options = { ...textOptions };
  expect(search("needle", options)?.total).toBe(1);
  options.caseSensitive = true;
  expect(search("needle", options)?.total).toBe(0);
});

it("locates matching records across blank source lines", () => {
  const search = createMemorySearch(recordsFrom('\n{"v":"needle"}\n\n{"v":"needle"}'));
  search("needle", textOptions);
  expect(search("needle", textOptions, [1])?.window.matches[0]?.recordId).toBe("record-4");
});
