import { expect, it, vi } from "vitest";
import { parseInput, parseJsonlRecordLine, parsePreviewJsonlRecordLine } from "@unquote/core";
import { readJsonlLinesByNumber, SourceReadLimitError } from "../src/lib/local-file-reader";
import { compareTableNumbers, exportTableCsv, scanRecordTable } from "../src/lib/record-table";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import type { LocalFileAccess } from "../src/lib/local-file-source";

const scan = (
  text: string,
  path: string,
  operator: "any" | "equals" | "greater" | "missing" = "any",
  value = "",
) =>
  scanRecordTable(
    createTextSourceRevision(1, text, "jsonl"),
    parseInput(text, { forcedFormat: "jsonl" }).records,
    [{ path, operator, value }],
    new AbortController().signal,
    () => {},
  );

it("filters nested stringified fields without rounding numbers", async () => {
  const text = '{"body":"{\\"id\\":9007199254740992}"}\n{"body":{"id":9007199254740993}}';
  const result = await scan(text, "$.body.id", "greater", "9007199254740992");
  expect(result.rows.map((row) => row.lineNumber)).toEqual([2]);
  expect(result.rows[0]?.cells[0]?.text).toBe("9007199254740993");
  expect(compareTableNumbers("1.00", "1e0")).toBe(0);
  expect(compareTableNumbers("-1e100000", "-9e99999")).toBe(-1);
  expect(compareTableNumbers("-0", "0.00")).toBe(0);
  expect(compareTableNumbers("0.00001", "0.0001")).toBe(-1);
});

it("distinguishes missing from null and ignores inherited properties", async () => {
  const result = await scan('{"v":null}\n{}\n{"v":""}\ninvalid', "$.v", "missing");
  expect(result.rows.map((row) => row.lineNumber)).toEqual([2]);
  expect(result.failed).toBe(1);
  expect(result.scanned).toBe(4);
  expect((await scan("{}", "$.constructor")).rows[0]?.cells[0]?.kind).toBe("missing");
  expect((await scan('{"v":1}', "$.v", "equals", "abc")).rows).toEqual([]);
});

it("exports complete escaped cells and protects spreadsheet formula strings", async () => {
  const result = await scan('{"v":"=1+1"}\n{"v":"a,\\"b\\"\\nc"}', "$.v");
  const text = (await exportTableCsv(result, new AbortController().signal)).join("");
  expect(text).toBe('"$.v"\r\n"\'=1+1"\r\n"a,""b""\nc"\r\n');
  await expect(scan(JSON.stringify({ v: "x".repeat(70_000) }), "$.v")).rejects.toThrow(RangeError);
});

it("hydrates preview records before filtering and rejects a cancelled scan", async () => {
  const records = parseInput('{"v":4}', { forcedFormat: "jsonl" }).records;
  const full = records[0]!;
  const resolveRecords = vi.fn(async () => [full]);
  const source = createStreamingFileSourceRevision(
    1,
    { resolveRecords } as unknown as LocalFileAccess,
    "jsonl",
  );
  const preview = {
    id: full.id,
    lineNumber: full.lineNumber,
    summary: full.summary,
    status: "preview" as const,
    node: { kind: "object" as const, preview: true as const, childCount: 1 },
  };
  const result = await scanRecordTable(
    source,
    [preview],
    [{ path: "$.v", operator: "greater", value: "3" }],
    new AbortController().signal,
    () => {},
  );
  expect(result.rows[0]?.recordId).toBe(full.id);
  expect(result.rows[0]?.cells[0]?.text).toBe("4");
  expect(resolveRecords).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  await expect(
    scanRecordTable(
      source,
      [preview],
      [{ path: "$", operator: "any", value: "" }],
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow();
});

const localTableSource = (lines: string[]) => {
  const file = new File([lines.join("\n")], "table.jsonl");
  const resolveRecords = vi.fn<LocalFileAccess["resolveRecords"]>(
    async (records, signal, maxBytes) => {
      const selected = await readJsonlLinesByNumber(
        file,
        new Set(records.map((record) => record.lineNumber)),
        signal,
        maxBytes,
      );
      return [...selected].map(([lineNumber, line]) => parseJsonlRecordLine(line, lineNumber));
    },
  );
  return {
    source: createStreamingFileSourceRevision(
      1,
      { resolveRecords } as unknown as LocalFileAccess,
      "jsonl",
    ),
    records: lines.map((line, index) => parsePreviewJsonlRecordLine(line, index + 1)),
    resolveRecords,
  };
};

it("shrinks oversized hydration batches without losing rows or double-counting profiles", async () => {
  const lines = Array.from({ length: 64 }, (_, id) =>
    JSON.stringify({ id, padding: "x".repeat(70 * 1024) }),
  );
  lines.push("invalid");
  const { source, records } = localTableSource(lines);
  const progress: number[] = [];
  const result = await scanRecordTable(
    source,
    records,
    [{ path: "$.id", operator: "any", value: "" }],
    new AbortController().signal,
    (count) => progress.push(count),
  );
  expect(result).toEqual(await scan(lines.join("\n"), "$.id"));
  expect(result.rows).toHaveLength(64);
  expect(result.profiles[0]?.total).toBe(64);
  expect(result.failed).toBe(1);
  expect(progress).toEqual([32, 64, 65]);
});

it("reports a limit when a single local record cannot fit the read budget", async () => {
  const { source, records } = localTableSource([
    JSON.stringify({ id: 1, padding: "x".repeat(4 * 1024 * 1024) }),
  ]);
  await expect(
    scanRecordTable(
      source,
      records,
      [{ path: "$.id", operator: "any", value: "" }],
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(RangeError);
});

it.each(["cancel", "read-error"])("does not retry hydration after %s", async (kind) => {
  const { source, records, resolveRecords } = localTableSource(['{"id":1}', '{"id":2}']);
  const controller = new AbortController();
  const failure = new Error("read failed");
  resolveRecords.mockImplementation(async () => {
    if (kind === "cancel") {
      controller.abort();
      throw new SourceReadLimitError();
    }
    throw failure;
  });
  const pending = scanRecordTable(
    source,
    records,
    [{ path: "$.id", operator: "any", value: "" }],
    controller.signal,
    () => {},
  );
  await expect(pending).rejects.toBe(kind === "cancel" ? controller.signal.reason : failure);
  expect(resolveRecords).toHaveBeenCalledOnce();
});
