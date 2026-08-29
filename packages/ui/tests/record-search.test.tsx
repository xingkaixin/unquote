import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { maxStringValueLabelLength } from "../src/lib/json-walk";
import {
  buildSearchPattern,
  createSearchResultCollector,
  searchRecords,
} from "../src/lib/record-search";
import type { SearchOptions, SearchResultSet } from "../src/lib/record-search";

const defaultOptions: SearchOptions = { syntax: "text", caseSensitive: false };

const recordsFor = (value: unknown) =>
  parseInput(JSON.stringify(value), { forcedFormat: "json" }).records;

// A string label is rendered as JSON, so the visible window is the truncated
// value plus its opening quote.
const maxVisibleStringRanges = maxStringValueLabelLength + 1;
const matchesOf = (result: SearchResultSet | null) => result?.window.matches ?? null;

const matchesForPattern = (value: unknown, pattern: RegExp, options = defaultOptions) => {
  const collector = createSearchResultCollector(pattern, options);
  for (const record of recordsFor(value)) {
    collector.addRecord(record);
  }
  return collector.finish().window.matches;
};

const valueRangesFor = (value: unknown, query: string, options = defaultOptions) => {
  const matches = matchesOf(searchRecords(recordsFor(value), query, options));
  expect(matches).toHaveLength(1);
  return matches![0]!.valueRanges;
};

describe("search range materialization", () => {
  it("bounds highlight ranges by the visible label for a dense match", () => {
    const ranges = valueRangesFor({ blob: "a".repeat(1_000_000) }, "a");

    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.length).toBeLessThanOrEqual(maxVisibleStringRanges);
    expect(ranges.at(-1)!.end).toBeLessThanOrEqual(maxVisibleStringRanges);
  });

  it("keeps the range count flat as the total match count grows", () => {
    const oneMillion = valueRangesFor({ blob: "a".repeat(1_000_000) }, "a");
    const twoMillion = valueRangesFor({ blob: "a".repeat(2_000_000) }, "a");

    expect(twoMillion.length).toBe(oneMillion.length);
  });

  it("still reports a node whose only match lies past the visible label", () => {
    const matches = matchesOf(
      searchRecords(
        recordsFor({ blob: `${"a".repeat(1_000_000)}needle` }),
        "needle",
        defaultOptions,
      ),
    );

    expect(matches).toHaveLength(1);
    expect(matches![0]!.valueRanges).toEqual([]);
  });

  it("highlights a match that ends exactly at the visible boundary", () => {
    // Offset by one for the opening quote of the JSON string label.
    const ranges = valueRangesFor({ blob: `${"a".repeat(maxStringValueLabelLength - 1)}z` }, "z");

    expect(ranges).toEqual([{ start: maxStringValueLabelLength, end: maxVisibleStringRanges }]);
  });
});

describe("search pattern semantics", () => {
  it("advances past zero-length regex matches without looping", () => {
    const matches = matchesForPattern({ blob: "abc" }, /x*/g, {
      ...defaultOptions,
      syntax: "regex",
    });
    const blob = matches.find((match) => match.pathText === "$.blob");

    // One empty match at every position of the `"abc"` label, quotes included.
    expect(blob?.valueRanges.map((range) => range.start)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(blob?.valueRanges.every((range) => range.start === range.end)).toBe(true);
  });

  it("scans every occurrence for a pattern that lacks the global flag", () => {
    const matches = matchesForPattern({ blob: "aa" }, /a/);

    expect(matches[0]?.valueRanges).toEqual([
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });

  it("honours case sensitivity", () => {
    expect(valueRangesFor({ blob: "aA" }, "a")).toHaveLength(2);
    expect(valueRangesFor({ blob: "aA" }, "a", { ...defaultOptions, caseSensitive: true })).toEqual(
      [{ start: 1, end: 2 }],
    );
  });

  it("matches keys and jq paths independently of the value", () => {
    const records = recordsFor({ needle: "value" });

    expect(matchesOf(searchRecords(records, "needle", defaultOptions))?.[0]?.keyRanges).toEqual([
      { start: 0, end: 6 },
    ]);
    expect(
      matchesOf(searchRecords(records, "$.needle", { ...defaultOptions, syntax: "jq" }))?.[0]
        ?.pathRanges,
    ).toEqual([{ start: 0, end: 8 }]);
  });

  it("keeps matching after one collector consumes multiple records", () => {
    const collector = createSearchResultCollector(/needle/gi, defaultOptions);
    const records = parseInput(
      ['{"message":"needle"}', '{"message":"Needle"}', '{"message":"needle"}'].join("\n"),
      { forcedFormat: "jsonl" },
    ).records;

    for (const record of records) {
      collector.addRecord(record);
    }

    expect([...collector.finish().matchLineNumbers]).toEqual([1, 2, 3]);
  });

  it("returns no matches for an invalid regex", () => {
    expect(buildSearchPattern("[", { ...defaultOptions, syntax: "regex" })).toBeNull();
    expect(
      searchRecords(recordsFor({ blob: "x" }), "[", { ...defaultOptions, syntax: "regex" }),
    ).toBeNull();
  });
});

describe("exact path search", () => {
  const options: SearchOptions = { syntax: "path", caseSensitive: false };

  it.each(["$.payload", ".payload", "$['payload']"])(
    "normalizes %s and only matches that path",
    (query) => {
      const result = searchRecords(
        recordsFor({ payload: 1, payloadMore: 2, Payload: 3, text: "$.payload" }),
        query,
        options,
      );
      expect(result?.window.matches).toEqual([
        {
          recordId: "record-1",
          pathText: "$.payload",
          keyRanges: [],
          valueRanges: [],
          pathRanges: [],
          stringifiedPathChain: [],
        },
      ]);
    },
  );

  it("escapes special keys and traverses arrays and stringified JSON", () => {
    const result = searchRecords(
      recordsFor({ "a.b[1]": JSON.stringify([{ value: 1 }]) }),
      '$["a.b[1]"][0].value',
      options,
    );
    expect(result?.window.matches).toMatchObject([
      {
        pathText: '$["a.b[1]"][0].value',
        stringifiedPathChain: ['$["a.b[1]"]'],
      },
    ]);
  });

  it("rejects invalid selectors", () => {
    expect(buildSearchPattern("$[", options)).toBeNull();
  });
});
