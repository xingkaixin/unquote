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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The fixture serializes arbitrary JSON values before searching typed records.
const recordsFor = (value: unknown) =>
  parseInput(JSON.stringify(value), { forcedFormat: "json" }).records;

// A string label is rendered as JSON, so the visible window is the truncated
// value plus its opening quote.
const maxVisibleStringRanges = maxStringValueLabelLength + 1;

const matchesOf = (result: SearchResultSet | null) => result?.window.matches ?? null;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The fixture serializes arbitrary JSON values before searching typed records.
const matchesForPattern = (value: unknown, pattern: RegExp, options = defaultOptions) => {
  const collector = createSearchResultCollector(pattern, options);
  for (const record of recordsFor(value)) {
    collector.addRecord(record);
  }
  return collector.finish().window.matches;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The fixture serializes arbitrary JSON values before searching typed records.
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

describe("raw JSONL line search counting past the materialized window", () => {
  const seedWindow = (
    collector: ReturnType<typeof createSearchResultCollector>,
    seedLine: string,
    count = 130,
  ) => {
    for (let index = 1; index <= count; index += 1) {
      collector.addRawJsonLine(seedLine, index);
    }
    return count;
  };

  it("matches full record search across primitives, nested JSON, arrays, and invalid lines", () => {
    const query = "needle";
    const pattern = buildSearchPattern(query, defaultOptions)!;
    const collector = createSearchResultCollector(pattern, defaultOptions, undefined, query);
    const offset = seedWindow(collector, '{"seed":"needle"}');

    const lines = [
      '{"plain":"has needle","skip":"other","flag":true,"empty":null,"count":42}',
      JSON.stringify({
        wrapped: JSON.stringify({ inner: "NEEDLE", items: ["x", "needle"], n: 1 }),
        cleanNested: JSON.stringify({ a: 1, b: "miss" }),
        doubleWrapped: JSON.stringify(JSON.stringify("needle")),
        brokenNested: "{not json",
        unicodeEscaped: '{"u":"\\u006eedle"}',
        escapedControl: "line1\nline2",
      }),
      '{"needle":[1,false,null,{"nested":true}]}',
      "{not-valid-json",
    ];
    lines.forEach((line, index) => collector.addRawJsonLine(line, offset + index + 1));

    const actual = collector.finish();
    const expected = searchRecords(
      parseInput(
        [...Array.from({ length: offset }, () => '{"seed":"needle"}'), ...lines].join("\n"),
        { forcedFormat: "jsonl" },
      ).records,
      query,
      defaultOptions,
    )!;

    expect(actual.total).toBe(expected.total);
    expect([...actual.matchLineNumbers]).toEqual([...expected.matchLineNumbers]);
  });

  it("handles numbers, non-canonical JSON numbers, booleans, null, and container counts", () => {
    const cases: Array<{ query: string; options: SearchOptions; lines: string[] }> = [
      {
        query: "123",
        options: defaultOptions,
        lines: [
          '{"a":123,"b":-0,"c":1.20,"d":1e5,"e":0.0000001,"f":12345678901234567890}',
          '{"s":"{\\"num\\":12345678901234567890}","neg":-0.5}',
          '{"ok":123,"arr":[123,456]}',
        ],
      },
      {
        query: "{2}",
        options: defaultOptions,
        lines: ['{"a":1,"b":2}', '{"x":[1,2]}'],
      },
      {
        query: "true",
        options: { syntax: "text", caseSensitive: true },
        lines: ['{"a":true,"b":false,"c":null,"d":"true"}'],
      },
      {
        query: "false|null",
        options: { syntax: "regex", caseSensitive: false },
        lines: ['{"a":false,"b":null,"c":true,"d":"other"}'],
      },
    ];

    for (const testCase of cases) {
      const pattern = buildSearchPattern(testCase.query, testCase.options)!;
      const collector = createSearchResultCollector(
        pattern,
        testCase.options,
        undefined,
        testCase.query,
      );
      const seedLine = testCase.lines[0]!;
      const offset = seedWindow(collector, seedLine);
      testCase.lines.forEach((line, index) => collector.addRawJsonLine(line, offset + index + 1));
      const actual = collector.finish();

      const allLines = [...Array.from({ length: offset }, () => seedLine), ...testCase.lines];
      const expected = searchRecords(
        parseInput(allLines.join("\n"), { forcedFormat: "jsonl" }).records,
        testCase.query,
        testCase.options,
      )!;

      expect(actual.total).toBe(expected.total);
      expect([...actual.matchLineNumbers]).toEqual([...expected.matchLineNumbers]);
    }
  });

  it("matches empty keys identically to Record traversal and locates every counted match in later windows", () => {
    const query = "^$|needle";
    const options: SearchOptions = { syntax: "regex", caseSensitive: false };
    const pattern = buildSearchPattern(query, options)!;
    const collector = createSearchResultCollector(pattern, options, undefined, query);
    const lines = [
      ...Array.from({ length: 128 }, () => '{"seed":"needle"}'),
      '{"":"needle"}',
      '{"":"plain"}',
    ];
    lines.forEach((line, index) => collector.addRawJsonLine(line, index + 1));

    const actual = collector.finish();
    const records = parseInput(lines.join("\n"), { forcedFormat: "jsonl" }).records;
    const expected = searchRecords(records, query, options)!;

    expect(actual.total).toBe(expected.total);
    expect([...actual.matchLineNumbers]).toEqual([...expected.matchLineNumbers]);

    const tailCollector = createSearchResultCollector(pattern, options, [actual.total - 1], query);
    lines.forEach((line, index) => tailCollector.addRawJsonLine(line, index + 1));
    const tail = tailCollector.finish();
    expect(tail.window.matches).toHaveLength(1);
    expect([...tail.window.matchIndexes]).toEqual([actual.total - 1]);
  });
});
