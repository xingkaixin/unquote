import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import { searchRecords } from "../src/lib/record-search";
import type { SearchOptions, SearchResultSet } from "../src/lib/record-search";

const makeStreamedFile = (contents: string, name = "payload.jsonl") => {
  const file = new File([contents], name, { type: "application/jsonl" });
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(contents));
          controller.close();
        },
      }),
  });
  return file;
};

// Fixture covers: a stringified JSON field that gets recursively expanded, an
// object key with a dot that forces quoted-path serialization, array values
// and index paths, >=3 levels of nesting inside the stringified content,
// multi-byte (Chinese) text, and every scalar kind (string/number/boolean/null).
const line1 = {
  "a.b": "needle 一",
  payload: JSON.stringify({
    items: [
      {
        "x.y": "needle",
        deep: { deeper: { deepest: "needle-deep" } },
      },
    ],
    count: 3,
    active: true,
    missing: null,
  }),
  list: ["alpha", "needle-in-list", "gamma"],
  flag: false,
};

const line2 = {
  message: "hay 干草 Needle-marker",
  value: 42,
};

const escapedLine = String.raw`{"escaped":"quo\u0074e","solidus":"a\/b","lineBreak":"line\nbreak","small":0.0000001,"left":true,"right":false}`;
const fixture = [JSON.stringify(line1), JSON.stringify(line2), escapedLine].join("\n");

// SearchMatch order is not guaranteed to be identical between the two search
// paths, so compare after sorting by (recordId, pathText).
const normalize = (result: SearchResultSet | null) =>
  result === null
    ? null
    : [...result.window.matches].sort((a, b) =>
        a.recordId === b.recordId
          ? a.pathText.localeCompare(b.pathText)
          : a.recordId.localeCompare(b.recordId),
      );

const searchInMemory = (query: string, options: SearchOptions) =>
  searchRecords(parseInput(fixture, { forcedFormat: "jsonl" }).records, query, options);

const searchInFile = (query: string, options: SearchOptions) => {
  const controller = new AbortController();
  return createLocalFileAccess(makeStreamedFile(fixture)).search(query, options, controller.signal);
};

const expectParity = async (query: string, options: SearchOptions) => {
  const memoryResult = searchInMemory(query, options);
  const fileResult = await searchInFile(query, options);

  expect(fileResult?.total).toBe(memoryResult?.total);
  expect(fileResult?.matchLineNumbers).toEqual(memoryResult?.matchLineNumbers);
  expect(normalize(fileResult)).toEqual(normalize(memoryResult));
  return {
    memoryMatches: memoryResult?.window.matches ?? null,
    fileMatches: fileResult?.window.matches ?? null,
  };
};

describe("search parity between memory and file search paths", () => {
  it("matches a case-insensitive substring across nested and stringified fields", async () => {
    const { memoryMatches } = await expectParity("needle", {
      syntax: "text",
      caseSensitive: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(3);
  });

  it("matches case-sensitively when caseSensitive is true", async () => {
    const { memoryMatches } = await expectParity("Needle", {
      syntax: "text",
      caseSensitive: true,
    });

    expect(memoryMatches).toEqual([expect.objectContaining({ recordId: "record-2" })]);
  });

  it("matches case-insensitively for the same query when caseSensitive is false", async () => {
    const { memoryMatches } = await expectParity("Needle", {
      syntax: "text",
      caseSensitive: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(1);
  });

  it("matches a regex pattern spanning multiple records", async () => {
    const { memoryMatches } = await expectParity("needle[-\\w]*", {
      syntax: "regex",
      caseSensitive: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(3);
  });

  it("matches jq path text for a stringified-expanded prefix", async () => {
    const { memoryMatches } = await expectParity("$.payload", {
      syntax: "jq",
      caseSensitive: true,
    });

    expect(memoryMatches?.length).toBeGreaterThan(1);
  });

  it("matches a query inside deeply nested stringified content", async () => {
    const { memoryMatches } = await expectParity("deepest", {
      syntax: "text",
      caseSensitive: true,
    });

    expect(memoryMatches).toEqual([
      {
        recordId: "record-1",
        pathText: "$.payload.items[0].deep.deeper.deepest",
        keyRanges: [{ start: 0, end: 7 }],
        valueRanges: [],
        pathRanges: [],
        stringifiedPathChain: ["$.payload"],
      },
    ]);
  });

  it("does not treat record roots or array indexes as searchable keys", async () => {
    const options: SearchOptions = { syntax: "text", caseSensitive: true };

    const indexMatches = await expectParity("[0]", options);
    const rootMatches = await expectParity("$", options);

    expect(indexMatches.memoryMatches).toEqual([]);
    expect(rootMatches.memoryMatches).toEqual([]);
  });

  it("returns no matches on both paths for a non-matching query", async () => {
    const { memoryMatches, fileMatches } = await expectParity("zzz-not-present", {
      syntax: "text",
      caseSensitive: false,
    });

    expect(memoryMatches).toEqual([]);
    expect(fileMatches).toEqual([]);
  });

  it.each([
    ["quote", "a Unicode-escaped string"],
    ["a/b", "an escaped solidus"],
    [String.raw`\n`, "an escaped control character"],
    ["0.0000001", "a source number label"],
    ["6", "a synthesized container-count label"],
  ])("preserves parity for %s in %s", async (query) => {
    const { memoryMatches } = await expectParity(query, {
      syntax: "text",
      caseSensitive: true,
    });

    expect(memoryMatches).toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: "record-3" })]),
    );
  });

  it("records separate memory and file search timings", async () => {
    performance.clearMeasures("unquote:search:memory");
    performance.clearMeasures("unquote:search:file");

    await expectParity("needle", {
      syntax: "text",
      caseSensitive: false,
    });

    expect(performance.getEntriesByName("unquote:search:memory")).toHaveLength(1);
    expect(performance.getEntriesByName("unquote:search:file")).toHaveLength(1);
  });
});

describe("search parity for the empty query", () => {
  it("returns null on both search paths", async () => {
    const options: SearchOptions = { syntax: "text", caseSensitive: false };

    expect(searchInMemory("", options)).toBeNull();
    await expect(searchInFile("", options)).resolves.toBeNull();
  });
});
