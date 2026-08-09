import { parseInput } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import {
  addRecordsToBuilder,
  copyBytesLimit,
  copyRecordLimit,
  createExportFilename,
  downloadBlob,
  formatRecordsAsJson,
  formatRecordsAsJsonParts,
  formatRecordsAsJsonl,
  formatRecordsAsJsonlParts,
  getCopyValue,
  isCopyAboveThreshold,
} from "../src/lib/record-export";
import type { ExportPartsBuilder } from "../src/lib/record-export";

const recordsFrom = (text: string, format?: "json" | "jsonl") =>
  parseInput(text, format ? { forcedFormat: format } : {}).records;

describe("record-export", () => {
  it("getCopyValue returns the materialized value for a parsed record", () => {
    const [record] = recordsFrom('{"a":1,"b":"x"}', "json");
    expect(getCopyValue(record!)).toEqual({ a: 1, b: "x" });
  });

  it("getCopyValue returns an error shape for a failed record", () => {
    const [record] = recordsFrom("{bad}", "jsonl");
    const value = getCopyValue(record!) as Record<string, unknown>;
    expect(value.error).toBeTruthy();
    expect(value.lineNumber).toBe(1);
  });

  it("getCopyValue preserves required failed-record diagnostics", () => {
    const [failed] = recordsFrom("{bad}", "jsonl");

    expect(getCopyValue(failed!)).toMatchObject({
      error: failed?.error,
      rawLine: failed?.rawLine,
    });
  });

  it("blocks copy only above the record or byte thresholds", () => {
    expect(isCopyAboveThreshold(copyRecordLimit, copyBytesLimit)).toBe(false);
    expect(isCopyAboveThreshold(copyRecordLimit + 1, 0)).toBe(true);
    expect(isCopyAboveThreshold(0, copyBytesLimit + 1)).toBe(true);
  });

  it("formatRecordsAsJsonl joins record values with newlines", () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    expect(formatRecordsAsJsonl(records)).toBe('{"a":1}\n{"a":2}');
  });

  it("formatRecordsAsJson emits the first value for json format", () => {
    const records = recordsFrom('{"a":1}', "json");
    expect(formatRecordsAsJson(records, "json")).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("formatRecordsAsJson emits an array for jsonl format", () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    expect(formatRecordsAsJson(records, "jsonl")).toBe(
      JSON.stringify([{ a: 1 }, { a: 2 }], null, 2),
    );
  });

  it("preserves unsafe number lexemes in every export shape", async () => {
    const records = recordsFrom('{"large":9007199254740993}\n{"exponent":1e400}', "jsonl");

    expect(formatRecordsAsJsonl(records)).toBe('{"large":9007199254740993}\n{"exponent":1e400}');
    expect(formatRecordsAsJson(records, "jsonl")).toContain("9007199254740993");
    expect(formatRecordsAsJson(records, "jsonl")).toContain("1e400");
    await expect(formatRecordsAsJsonlParts(records)).resolves.toEqual([
      '{"large":9007199254740993}',
      "\n",
      '{"exponent":1e400}',
    ]);
  });

  it("formats empty JSON and JSONL collections", async () => {
    expect(formatRecordsAsJson([], "json")).toBe("null");
    await expect(formatRecordsAsJsonParts([], "json")).resolves.toEqual(["null"]);
    await expect(formatRecordsAsJsonParts([], "jsonl")).resolves.toEqual(["[]"]);
  });

  it("formatRecordsAsJsonlParts concatenates to the same string as the sync formatter", async () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    const parts = await formatRecordsAsJsonlParts(records);
    expect(parts.join("")).toBe(formatRecordsAsJsonl(records));
  });

  it("formatRecordsAsJsonParts concatenates to the same string as the sync formatter", async () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    const parts = await formatRecordsAsJsonParts(records, "jsonl");
    expect(parts.join("")).toBe(formatRecordsAsJson(records, "jsonl"));
  });

  it("chunks large JSONL and JSON-array exports", async () => {
    const [record] = recordsFrom('{"a":1}', "jsonl");
    const records = Array.from({ length: 201 }, () => record!);

    const jsonlParts = await formatRecordsAsJsonlParts(records);
    const jsonParts = await formatRecordsAsJsonParts(records, "jsonl");

    expect(jsonlParts.join("").split("\n")).toHaveLength(201);
    expect(JSON.parse(jsonParts.join(""))).toHaveLength(201);
  });

  it("stops a builder at its first yield after cancellation", async () => {
    vi.useFakeTimers();
    const [record] = recordsFrom('{"a":1}', "jsonl");
    const records = Array.from({ length: 401 }, () => record!);
    const builder: ExportPartsBuilder = {
      bodyFor: vi.fn(() => "{}"),
      addBody: vi.fn(),
      finish: vi.fn(() => []),
    };
    const controller = new AbortController();

    try {
      const parts = addRecordsToBuilder(builder, records, controller.signal);
      const rejected = expect(parts).rejects.toMatchObject({ name: "AbortError" });
      expect(builder.bodyFor).toHaveBeenCalledTimes(201);

      controller.abort();
      await vi.runAllTimersAsync();
      await rejected;

      expect(builder.bodyFor).toHaveBeenCalledTimes(201);
      expect(builder.finish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("createExportFilename produces a timestamped name without colons or dots", () => {
    const name = createExportFilename("jsonl");
    expect(name).toMatch(/^unquote-visible-[\dTZ-]+\.jsonl$/);
  });

  it("defers download cleanup until a later task", () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    try {
      downloadBlob(["payload"], "payload.jsonl", "application/jsonl");

      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(document.querySelector('a[download="payload.jsonl"]')).toBeInTheDocument();

      vi.runAllTimers();

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
      expect(document.querySelector('a[download="payload.jsonl"]')).not.toBeInTheDocument();
    } finally {
      document.querySelector('a[download="payload.jsonl"]')?.remove();
      vi.useRealTimers();
    }
  });
});
