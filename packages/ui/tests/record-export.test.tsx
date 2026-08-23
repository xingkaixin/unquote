import { parseInput } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import {
  addRecordsToBuilder,
  copyRecordLimit,
  createExportFilename,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
  downloadBlob,
  formatRecordsAsJsonForCopy,
  formatRecordsAsJsonlForCopy,
  getCopyValue,
  isCopyRecordCountAboveThreshold,
  isCopyTextAboveThreshold,
} from "../src/lib/record-export";
import type { ExportPartsBuilder } from "../src/lib/record-export";

const recordsFrom = (text: string, format?: "json" | "jsonl") =>
  parseInput(text, format ? { forcedFormat: format } : {}).records;

const buildJsonlParts = (records: JsonlRecord[]) =>
  addRecordsToBuilder(createJsonlPartsBuilder(), records);

const buildJsonParts = (records: JsonlRecord[], format: "json" | "jsonl") =>
  addRecordsToBuilder(createJsonPartsBuilder(format), records);

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

  it("blocks copy only above the record threshold", () => {
    expect(isCopyRecordCountAboveThreshold(copyRecordLimit)).toBe(false);
    expect(isCopyRecordCountAboveThreshold(copyRecordLimit + 1)).toBe(true);
  });

  it("formats copy payloads within budget", () => {
    const records = recordsFrom('{"a":1}\n{bad}', "jsonl");
    const jsonl = formatRecordsAsJsonlForCopy(records);
    const json = formatRecordsAsJsonForCopy(records, "jsonl");

    expect(jsonl?.split("\n").map((line) => JSON.parse(line))).toEqual(records.map(getCopyValue));
    expect(JSON.parse(json!)).toEqual(records.map(getCopyValue));
    expect(formatRecordsAsJsonForCopy([], "json")).toBe("null");
  });

  it("checks the final UTF-8 payload at an inclusive byte limit", () => {
    const records = recordsFrom('{"emoji":"😀"}', "json");
    const text = JSON.stringify({ emoji: "😀" }, null, 2);
    const byteLength = new TextEncoder().encode(text).byteLength;

    expect(formatRecordsAsJsonForCopy(records, "json", byteLength)).toBe(text);
    expect(formatRecordsAsJsonForCopy(records, "json", byteLength - 1)).toBeNull();
    expect(isCopyTextAboveThreshold(text, byteLength)).toBe(false);
    expect(isCopyTextAboveThreshold(text, byteLength - 1)).toBe(true);
  });

  it("stops serializing a Record when the copy budget is exhausted", () => {
    const children: Record<string, JsonNode> = {
      payload: { kind: "string", value: "x".repeat(100) },
    };
    Object.defineProperty(children, "unreachable", {
      enumerable: true,
      get() {
        throw new Error("read beyond copy budget");
      },
    });
    const record: JsonlRecord = {
      id: "record-1",
      lineNumber: 1,
      summary: "large",
      status: "full",
      node: { kind: "object", children },
    };

    expect(formatRecordsAsJsonlForCopy([record], 20)).toBeNull();
  });

  it("preserves unsafe number lexemes in every export shape", async () => {
    const records = recordsFrom('{"large":9007199254740993}\n{"exponent":1e400}', "jsonl");

    expect(formatRecordsAsJsonlForCopy(records)).toBe(
      '{"large":9007199254740993}\n{"exponent":1e400}',
    );
    expect(formatRecordsAsJsonForCopy(records, "jsonl")).toContain("9007199254740993");
    expect(formatRecordsAsJsonForCopy(records, "jsonl")).toContain("1e400");
    await expect(buildJsonlParts(records)).resolves.toEqual([
      '{"large":9007199254740993}',
      "\n",
      '{"exponent":1e400}',
    ]);
  });

  it("formats empty JSON and JSONL collections", async () => {
    await expect(buildJsonParts([], "json")).resolves.toEqual(["null"]);
    await expect(buildJsonParts([], "jsonl")).resolves.toEqual(["[]"]);
  });

  it("builds JSONL parts with newline separators", async () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    const parts = await buildJsonlParts(records);
    expect(parts.join("")).toBe('{"a":1}\n{"a":2}');
  });

  it("builds JSON array parts with formatted records", async () => {
    const records = recordsFrom('{"a":1}\n{"a":2}', "jsonl");
    const parts = await buildJsonParts(records, "jsonl");
    expect(parts.join("")).toBe(JSON.stringify([{ a: 1 }, { a: 2 }], null, 2));
  });

  it("chunks large JSONL and JSON-array exports", async () => {
    const [record] = recordsFrom('{"a":1}', "jsonl");
    const records = Array.from({ length: 201 }, () => record!);

    const jsonlParts = await buildJsonlParts(records);
    const jsonParts = await buildJsonParts(records, "jsonl");

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
