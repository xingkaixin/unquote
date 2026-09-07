import type { FullJsonlRecord, FullJsonNode } from "@unquote/core";
import { expect, it } from "vitest";
import { cacheFullRecords, fullRecordCacheBytesLimit } from "../src/lib/full-record-cache";

const record = (lineNumber: number, node: FullJsonNode): FullJsonlRecord => ({
  id: `record-${lineNumber}`,
  lineNumber,
  summary: "record",
  status: "full",
  node,
});

it("evicts by retained size before reaching the record count limit", () => {
  const node = { kind: "string" as const, value: "x".repeat(fullRecordCacheBytesLimit / 5) };
  const first = cacheFullRecords(new Map(), [record(1, node), record(2, node)]);
  const next = cacheFullRecords(first, [record(3, node)]);
  expect([...first.keys()]).toEqual([1, 2]);
  expect([...next.keys()]).toEqual([2, 3]);
  expect(cacheFullRecords(next, [record(2, node)])).toBe(next);
});

it.each(["rawString", "truncated"] as const)(
  "counts %s data and keeps an oversized record only until another is loaded",
  (kind) => {
    const text = "x".repeat(fullRecordCacheBytesLimit / 2);
    const node: FullJsonNode =
      kind === "rawString"
        ? { kind: "null", value: null, rawString: text }
        : { kind: "object", truncated: true, value: { type: "object", entries: { text } } };
    const small = record(1, { kind: "null", value: null });
    const large = record(2, node);
    const current = cacheFullRecords(new Map(), [small]);
    const withLarge = cacheFullRecords(current, [large]);
    expect([...withLarge.keys()]).toEqual([2]);
    expect(withLarge.get(2)?.record).toBe(large);
    expect([...cacheFullRecords(withLarge, [small]).keys()]).toEqual([1]);
  },
);

it("accounts for node overhead even when the source has no large strings", () => {
  const node: FullJsonNode = {
    kind: "array",
    children: Array.from({ length: 80_000 }, () => ({ kind: "number", value: 0 })),
  };
  const current = cacheFullRecords(new Map(), [record(1, node)]);
  const next = cacheFullRecords(current, [record(2, node)]);
  expect([...next.keys()]).toEqual([2]);
});
