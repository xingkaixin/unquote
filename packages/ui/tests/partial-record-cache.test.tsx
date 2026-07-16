import type { JsonlRecord } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  createPartialRecordCache,
  updatePartialRecordCache,
} from "../src/lib/partial-record-cache";

const rec = (id: string): JsonlRecord => ({
  id,
  lineNumber: 1,
  node: null,
  summary: id,
});

describe("partial-record-cache", () => {
  it("processes all records on the first call and reports rebuilt", () => {
    const state = createPartialRecordCache<string>();
    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache([rec("a"), rec("b")], state, (r) => {
      calls.push(r.id);
      return r.id.toUpperCase();
    });
    expect(rebuilt).toBe(true);
    expect(calls).toEqual(["a", "b"]);
    expect(processed.map((p) => p.value)).toEqual(["A", "B"]);
  });

  it("processes only the appended tail when the same array grows", () => {
    const state = createPartialRecordCache<string>();
    const records = [rec("a")];
    updatePartialRecordCache(records, state, (r) => r.id);
    records.push(rec("b"));
    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache(records, state, (r) => {
      calls.push(r.id);
      return r.id;
    });
    expect(rebuilt).toBe(false);
    expect(calls).toEqual(["b"]);
    expect(processed.map((p) => p.record.id)).toEqual(["b"]);
  });

  it("processes only the appended tail when an immutable snapshot grows", () => {
    const state = createPartialRecordCache<string>();
    const a = rec("a");
    updatePartialRecordCache([a], state, (record) => record.id);

    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache([a, rec("b")], state, (record) => {
      calls.push(record.id);
      return record.id;
    });

    expect(rebuilt).toBe(false);
    expect(calls).toEqual(["b"]);
    expect(processed.map(({ record }) => record.id)).toEqual(["b"]);
  });

  it("does not reprocess an unchanged immutable snapshot", () => {
    const state = createPartialRecordCache<string>();
    const a = rec("a");
    updatePartialRecordCache([a], state, (r) => r.id);
    const calls: string[] = [];
    const { rebuilt } = updatePartialRecordCache([a], state, (r) => {
      calls.push(r.id);
      return r.id;
    });
    expect(rebuilt).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rebuilds when an immutable snapshot changes the processed prefix", () => {
    const state = createPartialRecordCache<string>();
    const a = rec("a");
    const b = rec("b");
    updatePartialRecordCache([a, b], state, (record) => record.id);

    const replacement = rec("a");
    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache([replacement, b], state, (record) => {
      calls.push(record.id);
      return record.id;
    });

    expect(rebuilt).toBe(true);
    expect(calls).toEqual(["a"]);
    expect(processed.map(({ record }) => record.id)).toEqual(["a", "b"]);
  });

  it("evicts records absent from the rebuilt list", () => {
    const state = createPartialRecordCache<string>();
    updatePartialRecordCache([rec("a"), rec("b")], state, (r) => r.id);
    updatePartialRecordCache([rec("a")], state, (r) => r.id);
    expect(state.entries.has("a")).toBe(true);
    expect(state.entries.has("b")).toBe(false);
  });
});
