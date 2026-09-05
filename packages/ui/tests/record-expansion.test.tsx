import { describe, expect, it } from "vitest";
import {
  addExpandedStringifiedPaths,
  addExpandedStringifiedPathsBatch,
  groupExpandedStringifiedPaths,
  mergeExpandedStringifiedPaths,
  replaceExpandedStringifiedPathsBatch,
  type ExpandedStringifiedPathsByRecord,
  type ExpansionEntry,
} from "../src/lib/record-expansion";

interface ExpansionMatch {
  recordId: string;
  stringifiedPathChain: string[];
}

const groupWithIncrementalUpdates = (matches: ExpansionMatch[]) => {
  let grouped = new Map<string, ReadonlySet<string>>();
  for (const match of matches) {
    grouped = new Map(
      addExpandedStringifiedPaths(grouped, match.recordId, match.stringifiedPathChain),
    );
  }
  return grouped;
};

const serialize = (grouped: ReadonlyMap<string, ReadonlySet<string>>) =>
  [...grouped].map(([recordId, paths]) => [recordId, [...paths]]);

describe("groupExpandedStringifiedPaths", () => {
  it("matches incremental updates for duplicates and empty chains", () => {
    const matches: ExpansionMatch[] = [
      { recordId: "record-2", stringifiedPathChain: ["$.payload", "$.payload.nested"] },
      { recordId: "record-1", stringifiedPathChain: [] },
      { recordId: "record-2", stringifiedPathChain: ["$.payload", "$.result"] },
      { recordId: "record-3", stringifiedPathChain: ["$.arguments"] },
    ];

    expect(serialize(groupExpandedStringifiedPaths(matches))).toEqual(
      serialize(groupWithIncrementalUpdates(matches)),
    );
  });

  it("aggregates tens of thousands of matches without losing order", () => {
    const matches = Array.from({ length: 20_000 }, (_, index) => ({
      recordId: `record-${index % 100}`,
      stringifiedPathChain: [`$.payload.${index % 250}`, `$.shared.${index % 10}`],
    }));

    const grouped = groupExpandedStringifiedPaths(matches);

    expect([...grouped.keys()]).toEqual(
      Array.from({ length: 100 }, (_, index) => `record-${index}`),
    );
    expect([...grouped.values()].every((paths) => paths.size === 6)).toBe(true);
  });
});

// The batch entry points exist to copy the backing map at most once per call.
// Counting Map constructions asserts that invariant directly, without relying
// on wall-clock timing.
const countMapConstructions = <T,>(run: () => T) => {
  const NativeMap = globalThis.Map;
  let constructions = 0;

  class CountingMap<K, V> extends NativeMap<K, V> {
    constructor(entries?: readonly (readonly [K, V])[] | null) {
      super(entries);
      constructions += 1;
    }
  }

  globalThis.Map = CountingMap as unknown as MapConstructor;
  try {
    const result = run();
    return { result, constructions };
  } finally {
    globalThis.Map = NativeMap;
  }
};

const buildEntries = (count: number, pathsFor: (index: number) => string[]): ExpansionEntry[] =>
  Array.from({ length: count }, (_, index) => [`record-${index}`, pathsFor(index)] as const);

describe("batch expansion writes", () => {
  it("replaces or adds paths while preserving untouched records", () => {
    const base = new Map<string, ReadonlySet<string>>([
      ["record-0", new Set(["$.kept"])],
      ["record-1", new Set(["$.replaced"])],
      ["record-9", new Set(["$.untouched"])],
    ]);
    const entries: ExpansionEntry[] = [
      ["record-0", ["$.kept"]],
      ["record-1", ["$.payload", "$.payload.nested"]],
      ["record-2", ["$.arguments"]],
      ["record-9", []],
    ];

    expect(serialize(replaceExpandedStringifiedPathsBatch(base, entries))).toEqual([
      ["record-0", ["$.kept"]],
      ["record-1", ["$.payload", "$.payload.nested"]],
      ["record-2", ["$.arguments"]],
    ]);
    expect(serialize(addExpandedStringifiedPathsBatch(base, entries))).toEqual([
      ["record-0", ["$.kept"]],
      ["record-1", ["$.replaced", "$.payload", "$.payload.nested"]],
      ["record-9", ["$.untouched"]],
      ["record-2", ["$.arguments"]],
    ]);
  });

  it("returns the original map when no entry changes anything", () => {
    const base = new Map<string, ReadonlySet<string>>([["record-0", new Set(["$.payload"])]]);
    const entries: ExpansionEntry[] = [
      ["record-0", ["$.payload"]],
      ["record-1", []],
    ];

    expect(replaceExpandedStringifiedPathsBatch(base, entries)).toBe(base);
    expect(addExpandedStringifiedPathsBatch(base, entries)).toBe(base);
    expect(mergeExpandedStringifiedPaths(base, new Map())).toBe(base);
  });

  it("applies the last write when an entry repeats a record", () => {
    const base: ExpandedStringifiedPathsByRecord = new Map();
    const entries: ExpansionEntry[] = [
      ["record-0", ["$.first"]],
      ["record-0", ["$.second"]],
    ];

    expect(serialize(replaceExpandedStringifiedPathsBatch(base, entries))).toEqual([
      ["record-0", ["$.second"]],
    ]);
    expect(serialize(addExpandedStringifiedPathsBatch(base, entries))).toEqual([
      ["record-0", ["$.first", "$.second"]],
    ]);
  });

  it("copies the backing map at most once regardless of record count", () => {
    const base: ExpandedStringifiedPathsByRecord = new Map();
    const entries = buildEntries(5_000, (index) => [`$.payload.${index}`]);

    const replaced = countMapConstructions(() =>
      replaceExpandedStringifiedPathsBatch(base, entries),
    );
    expect(replaced.constructions).toBe(1);
    expect(replaced.result.size).toBe(5_000);

    const extra: ExpandedStringifiedPathsByRecord = new Map(
      entries.map(([recordId]) => [recordId, new Set([`${recordId}:extra`])]),
    );
    const merged = countMapConstructions(() =>
      mergeExpandedStringifiedPaths(replaced.result, extra),
    );
    expect(merged.constructions).toBe(1);
    expect(merged.result.size).toBe(5_000);
  });
});
