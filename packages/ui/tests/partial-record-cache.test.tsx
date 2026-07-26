import type { JsonlRecord } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  createPartialRecordCache,
  updatePartialRecordCache,
} from "../src/lib/partial-record-cache";

const rec = (id: string): JsonlRecord => ({
  ...parseInput("not-json", { forcedFormat: "jsonl" }).records[0]!,
  id,
  summary: id,
});

describe("partial-record-cache", () => {
  it("processes all records on the first call and reports rebuilt", () => {
    const state = createPartialRecordCache();
    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache([rec("a"), rec("b")], state, (r) => {
      calls.push(r.id);
      return r.id.toUpperCase();
    });
    expect(rebuilt).toBe(true);
    expect(calls).toEqual(["a", "b"]);
    expect(processed.map((p) => p.value)).toEqual(["A", "B"]);
  });

  it("processes only an explicitly signaled immutable append", () => {
    const state = createPartialRecordCache();
    const a = rec("a");
    const previousRecords = [a];
    updatePartialRecordCache(previousRecords, state, (record) => record.id);

    const calls: string[] = [];
    const { rebuilt, processed } = updatePartialRecordCache(
      [a, rec("b")],
      state,
      (record) => {
        calls.push(record.id);
        return record.id;
      },
      { previousRecords },
    );

    expect(rebuilt).toBe(false);
    expect(calls).toEqual(["b"]);
    expect(processed.map(({ record }) => record.id)).toEqual(["b"]);
  });

  it("rebuilds when an append signal is missing", () => {
    const state = createPartialRecordCache();
    const a = rec("a");
    const previousRecords = [a];
    updatePartialRecordCache(previousRecords, state, (r) => r.id);
    const calls: string[] = [];
    const { rebuilt } = updatePartialRecordCache([a, rec("b")], state, (r) => {
      calls.push(r.id);
      return r.id;
    });
    expect(rebuilt).toBe(true);
    expect(calls).toEqual(["a", "b"]);
  });

  it("rebuilds when the consumer did not process the signaled previous snapshot", () => {
    const state = createPartialRecordCache();
    const a = rec("a");
    const processedRecords = [a];
    updatePartialRecordCache(processedRecords, state, (record) => record.id);

    const skippedRecords = [a, rec("b")];
    const calls: string[] = [];
    const { rebuilt } = updatePartialRecordCache(
      [...skippedRecords, rec("c")],
      state,
      (record) => {
        calls.push(record.id);
        return record.id;
      },
      { previousRecords: skippedRecords },
    );

    expect(rebuilt).toBe(true);
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("rebuilds when an immutable snapshot changes the processed prefix", () => {
    const state = createPartialRecordCache();
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
    expect(calls).toEqual(["a", "b"]);
    expect(processed.map(({ record }) => record.id)).toEqual(["a", "b"]);
  });

  it("does not retain per-record derived values", () => {
    const state = createPartialRecordCache();
    updatePartialRecordCache([rec("a"), rec("b")], state, (r) => r.id);

    expect(state).not.toHaveProperty("entries");
  });
});
