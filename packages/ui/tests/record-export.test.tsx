import { formatResolvedRecordsForCopy } from "../src/lib/record-export";
import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonNode, JsonlRecord } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import {
  addRecordsToBuilder,
  copyRecordLimit,
  createExportFilename,
  ExportSizeLimitError,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
  downloadBlob,
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
  it.each(['{"value":1}', "[]", '"hello"', "1", "true", "null"])(
    "rejects unresolved previews of %s in copy and export formats",
    async (source) => {
      const record = parsePreviewJsonlRecordLine(source, 1);
      await expect(
        formatResolvedRecordsForCopy(
          [record],
          "json",
          async (record) => record,
          new AbortController().signal,
        ),
      ).rejects.toThrow(TypeError);
      await expect(buildJsonParts([record], "jsonl")).rejects.toThrow(TypeError);
      await expect(buildJsonlParts([record])).rejects.toThrow(TypeError);
    },
  );

  it("blocks copy only above the record threshold", () => {
    expect(isCopyRecordCountAboveThreshold(copyRecordLimit)).toBe(false);
    expect(isCopyRecordCountAboveThreshold(copyRecordLimit + 1)).toBe(true);
  });

  it("preserves failed-record diagnostics in copy payloads", async () => {
    const records = recordsFrom('{"a":1}\n{bad}', "jsonl");
    const failed = records[1]!;
    const text = await formatResolvedRecordsForCopy(
      records,
      "array",
      async (record) => record,
      new AbortController().signal,
    );
    expect(JSON.parse(text!)).toEqual([
      { a: 1 },
      {
        lineNumber: 2,
        error: failed.error,
        line: failed.errorMeta!.line,
        column: failed.errorMeta!.column,
        rawLine: "{bad}",
        context: failed.errorMeta!.context,
        summary: failed.summary,
      },
    ]);
  });

  it("checks the final UTF-8 payload at an inclusive byte limit", async () => {
    const records = recordsFrom('{"emoji":"😀"}', "json");
    const text = JSON.stringify({ emoji: "😀" }, null, 2);
    const byteLength = new TextEncoder().encode(text).byteLength;

    await expect(
      formatResolvedRecordsForCopy(
        records,
        "json",
        async (record) => record,
        new AbortController().signal,
        byteLength,
      ),
    ).resolves.toBe(text);
    await expect(
      formatResolvedRecordsForCopy(
        records,
        "json",
        async (record) => record,
        new AbortController().signal,
        byteLength - 1,
      ),
    ).resolves.toBeNull();
    expect(isCopyTextAboveThreshold(text, byteLength)).toBe(false);
    expect(isCopyTextAboveThreshold(text, byteLength - 1)).toBe(true);
  });

  it("stops serializing a Record when the copy budget is exhausted", async () => {
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

    await expect(
      formatResolvedRecordsForCopy(
        [record],
        "jsonl",
        async (record) => record,
        new AbortController().signal,
        20,
      ),
    ).resolves.toBeNull();
  });

  it("preserves unsafe number lexemes in every export shape", async () => {
    const records = recordsFrom('{"large":9007199254740993}\n{"exponent":1e400}', "jsonl");

    const copied = await formatResolvedRecordsForCopy(
      records,
      "array",
      async (record) => record,
      new AbortController().signal,
    );
    expect(copied).toContain("9007199254740993");
    expect(copied).toContain("1e400");
    await expect(buildJsonlParts(records)).resolves.toEqual([
      '{"large":9007199254740993}',
      "\n",
      '{"exponent":1e400}',
    ]);
  });

  it.each([
    ["json", "null"],
    ["jsonl", ""],
    ["array", "[]"],
  ] as const)("copies an empty %s collection", async (format, expected) => {
    await expect(
      formatResolvedRecordsForCopy(
        [],
        format,
        async (record) => record,
        new AbortController().signal,
      ),
    ).resolves.toBe(expected);
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

describe("bounded copy hydration", () => {
  it("stops resolving records when the output exceeds the budget", async () => {
    const records = recordsFrom('"first"\n"second"\n"third"', "jsonl");
    const resolved: string[] = [];
    const text = await formatResolvedRecordsForCopy(
      records,
      "jsonl",
      async (record) => {
        resolved.push(record.id);
        return record;
      },
      new AbortController().signal,
      8,
    );
    expect(text).toBeNull();
    expect(resolved).toEqual([records[0]!.id, records[1]!.id]);
  });

  it.each(["jsonl", "array", "json"] as const)("preserves %s formatting", async (format) => {
    const records = recordsFrom('{"n":9007199254740993}\n{"s":"中文"}', "jsonl");
    const expected = {
      jsonl: '{"n":9007199254740993}\n{"s":"中文"}',
      array: '[\n  {\n    "n": 9007199254740993\n  },\n  {\n    "s": "中文"\n  }\n]',
      json: '{\n  "n": 9007199254740993\n}',
    }[format];
    await expect(
      formatResolvedRecordsForCopy(
        records,
        format,
        async (record) => record,
        new AbortController().signal,
      ),
    ).resolves.toBe(expected);
  });
});

describe("export byte budget", () => {
  it.each(["json", "jsonl", "array"] as const)(
    "counts Unicode and formatting in %s exports",
    async (format) => {
      const records = recordsFrom('{"text":"中文"}\n{"n":9007199254740993}', "jsonl");
      const input = format === "json" ? records.slice(0, 1) : records;
      const create = (limit: number) =>
        format === "jsonl"
          ? createJsonlPartsBuilder(limit)
          : createJsonPartsBuilder(format === "json" ? "json" : "jsonl", limit);
      const text = (await addRecordsToBuilder(create(1000), input)).join("");
      const bytes = new TextEncoder().encode(text).length;
      await expect(addRecordsToBuilder(create(bytes), input)).resolves.toEqual(expect.any(Array));
      await expect(addRecordsToBuilder(create(bytes - 1), input)).rejects.toBeInstanceOf(
        ExportSizeLimitError,
      );
    },
  );

  it("rejects a single oversized value during bounded serialization", () => {
    const record = recordsFrom('"' + "x".repeat(1000) + '"', "json")[0]!;
    expect(() => createJsonlPartsBuilder(10).bodyFor(record)).toThrow(ExportSizeLimitError);
  });
});
