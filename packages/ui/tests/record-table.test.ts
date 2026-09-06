import { expect, it, vi } from "vitest";
import { parseInput } from "@unquote/core";
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
