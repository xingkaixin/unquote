import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  copyBytesLimit,
  copyRecordLimit,
  createExportFilename,
  formatRecordsAsJson,
  formatRecordsAsJsonParts,
  formatRecordsAsJsonl,
  formatRecordsAsJsonlParts,
  getCopyValue,
  isCopyAboveThreshold,
} from "../src/lib/record-export";

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

  it("getCopyValue falls back to default error and metadata raw-line values", () => {
    const [failed] = recordsFrom("{bad}", "jsonl");
    const { error: _error, rawLine: _rawLine, ...record } = failed!;

    expect(getCopyValue(record)).toMatchObject({
      error: "Parse error",
      rawLine: record.errorMeta?.rawLine,
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

  it("createExportFilename produces a timestamped name without colons or dots", () => {
    const name = createExportFilename("jsonl");
    expect(name).toMatch(/^unquote-visible-[\dTZ-]+\.jsonl$/);
  });
});
