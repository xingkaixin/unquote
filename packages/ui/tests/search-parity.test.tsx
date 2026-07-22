import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import { searchJsonlFile } from "../src/lib/local-file-source";
import { searchRecords } from "../src/lib/tree";
import type { SearchMatch, SearchOptions } from "../src/lib/tree";

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

const fixture = [JSON.stringify(line1), JSON.stringify(line2)].join("\n");

// SearchMatch order is not guaranteed to be identical between the two search
// paths, so compare after sorting by (recordId, pathText).
const normalize = (matches: SearchMatch[] | null) =>
  matches === null
    ? null
    : [...matches].sort((a, b) =>
        a.recordId === b.recordId
          ? a.pathText.localeCompare(b.pathText)
          : a.recordId.localeCompare(b.recordId),
      );

const searchInMemory = (query: string, options: SearchOptions) =>
  searchRecords(parseInput(fixture, { forcedFormat: "jsonl" }).records, query, options);

const searchInFile = (query: string, options: SearchOptions) => {
  const controller = new AbortController();
  return searchJsonlFile(makeStreamedFile(fixture), query, options, controller.signal);
};

const expectParity = async (query: string, options: SearchOptions) => {
  const memoryMatches = searchInMemory(query, options);
  const fileMatches = await searchInFile(query, options);

  expect(normalize(fileMatches)).toEqual(normalize(memoryMatches));
  return { memoryMatches, fileMatches };
};

describe("search parity between memory and file search paths", () => {
  it("matches a case-insensitive substring across nested and stringified fields", async () => {
    const { memoryMatches } = await expectParity("needle", {
      regex: false,
      caseSensitive: false,
      jq: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(3);
  });

  it("matches case-sensitively when caseSensitive is true", async () => {
    const { memoryMatches } = await expectParity("Needle", {
      regex: false,
      caseSensitive: true,
      jq: false,
    });

    expect(memoryMatches).toEqual([expect.objectContaining({ recordId: "record-2" })]);
  });

  it("matches case-insensitively for the same query when caseSensitive is false", async () => {
    const { memoryMatches } = await expectParity("Needle", {
      regex: false,
      caseSensitive: false,
      jq: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(1);
  });

  it("matches a regex pattern spanning multiple records", async () => {
    const { memoryMatches } = await expectParity("needle[-\\w]*", {
      regex: true,
      caseSensitive: false,
      jq: false,
    });

    expect(memoryMatches?.length).toBeGreaterThan(3);
  });

  it("matches jq path text for a stringified-expanded prefix", async () => {
    const { memoryMatches } = await expectParity("$.payload", {
      regex: false,
      caseSensitive: true,
      jq: true,
    });

    expect(memoryMatches?.length).toBeGreaterThan(1);
  });

  it("matches a query inside deeply nested stringified content", async () => {
    const { memoryMatches } = await expectParity("deepest", {
      regex: false,
      caseSensitive: true,
      jq: false,
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

  it("returns no matches on both paths for a non-matching query", async () => {
    const { memoryMatches, fileMatches } = await expectParity("zzz-not-present", {
      regex: false,
      caseSensitive: false,
      jq: false,
    });

    expect(memoryMatches).toEqual([]);
    expect(fileMatches).toEqual([]);
  });
});

describe("search parity for the empty query", () => {
  it("returns null on both search paths", async () => {
    const options: SearchOptions = { regex: false, caseSensitive: false, jq: false };

    expect(searchInMemory("", options)).toBeNull();
    await expect(searchInFile("", options)).resolves.toBeNull();
  });
});
