import { parseInput } from "@unquote/core";
import { describe, expect, it } from "vitest";
import {
  createExportFilename,
  formatRecordsAsJson,
  formatRecordsAsJsonParts,
  formatRecordsAsJsonl,
  formatRecordsAsJsonlParts,
  getCopyValue,
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

  it("createExportFilename produces a timestamped name without colons or dots", () => {
    const name = createExportFilename("jsonl");
    expect(name).toMatch(/^unquote-visible-[\dTZ-]+\.jsonl$/);
  });
});
