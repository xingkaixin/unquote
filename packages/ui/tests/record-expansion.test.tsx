import { describe, expect, it } from "vitest";
import {
  addExpandedStringifiedPaths,
  groupExpandedStringifiedPaths,
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
