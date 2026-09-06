import { expect, it } from "vitest";
import { parseInput } from "@unquote/core";
import { scanRecordTable } from "../src/lib/record-table";
import { createTextSourceRevision } from "../src/lib/published-source";

it("profiles all valid records before filters, separating missing, null and empty strings", async () => {
  const text = '{"v":1}\n{"v":null}\n{}\n{"v":""}\n{"v":"word"}\ninvalid';
  const records = parseInput(text, { forcedFormat: "jsonl" }).records;
  const source = createTextSourceRevision(1, text, "jsonl");
  const result = await scanRecordTable(
    source,
    records,
    [{ path: "$.v", operator: "greater", value: "0" }],
    new AbortController().signal,
    () => {},
  );
  expect(result.rows.map((row) => row.lineNumber)).toEqual([1]);
  expect(result.profiles).toEqual([
    {
      total: 5,
      present: 4,
      counts: {
        missing: 1,
        null: 1,
        empty: 1,
        string: 2,
        number: 1,
        boolean: 0,
        object: 0,
        array: 0,
      },
    },
  ]);
  const empty = await scanRecordTable(
    source,
    records,
    [{ path: "$.v", operator: "empty", value: "" }],
    new AbortController().signal,
    () => {},
  );
  expect(empty.rows.map((row) => row.lineNumber)).toEqual([4]);
  const strings = await scanRecordTable(
    source,
    records,
    [{ path: "$.v", operator: "kind", value: "string" }],
    new AbortController().signal,
    () => {},
  );
  expect(strings.rows.map((row) => row.lineNumber)).toEqual([4, 5]);
});
