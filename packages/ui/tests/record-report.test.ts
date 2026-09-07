// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { parseInput, parsePreviewJsonlRecordLine, stringifyJsonNode } from "@unquote/core";
import { buildRecordReport, selectReportRecords } from "../src/lib/record-report";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";

import { createLocalFileAccess } from "../src/lib/local-file-source";
import { SourceReadLimitError } from "../src/lib/local-file-reader";
import { createStreamFile } from "./helpers/stub-file";

const report = (text: string, selection = "1", paths = "", notes = "") =>
  buildRecordReport(
    createTextSourceRevision(1, text, "jsonl"),
    parseInput(text, { forcedFormat: "jsonl" }).records,
    selection,
    paths,
    notes,
    new AbortController().signal,
  );

it("redacts nested stringified values in both exports without mutating records or rounding numbers", async () => {
  const text = '{"body":"{\\"token\\":\\"secret\\",\\"id\\":9007199254740993}"}';
  const source = createTextSourceRevision(1, text, "jsonl");
  const records = parseInput(text, { forcedFormat: "jsonl" }).records;
  const result = await buildRecordReport(
    source,
    records,
    "1",
    "$.body.token",
    "",
    new AbortController().signal,
  );
  expect(result.redacted).toBe(1);
  expect(result.markdown).not.toContain("secret");
  expect(result.jsonl).toBe('{"body":{"token":"[REDACTED]","id":9007199254740993}}\n');
  expect(result.markdown).toContain("Line 1");
  const original = records[0]!;
  if (original.status !== "full") throw new Error("fixture");
  expect(stringifyJsonNode(original.node)).toContain("secret");
});

it("selects deduplicated lines in source order and rejects missing, invalid or excessive ranges", async () => {
  const result = await report('{"n":1}\n{"n":2}\n{"n":3}', "3, 1-2, 1");
  expect(result.lineNumbers).toEqual([1, 2, 3]);
  await expect(report("{}", "1-1001")).rejects.toThrow(RangeError);
  await expect(report("{}", "2")).rejects.toThrow();
  await expect(report("invalid")).rejects.toThrow();
  expect(() => selectReportRecords([], "1,")).toThrow();
});

it("redacts whole containers and safely fences notes with markdown delimiters", async () => {
  const result = await report(
    '{"a":{"token":"secret"},"ab":"keep"}',
    "1",
    "$.a\n$.a.token",
    "```\n<script>alert(1)</script>",
  );
  expect(result.redacted).toBe(1);
  expect(result.jsonl).toBe('{"a":"[REDACTED]","ab":"keep"}\n');
  expect(result.markdown).toContain("````text\n```\n<script>");
  const root = await report('{"__proto__":{"token":"secret"}}', "1", "$.__proto__.token");
  expect(root.jsonl).not.toContain("secret");
});

it("rejects aborted work and preserves explicit null values", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    buildRecordReport(
      createTextSourceRevision(1, "{}", "json"),
      parseInput("{}").records,
      "1",
      "",
      "",
      controller.signal,
    ),
  ).rejects.toThrow();
  expect((await report('{"v":null}')).jsonl).toBe('{"v":null}\n');
});

it("streams selected local records in source order without bulk hydration", async () => {
  const text = '{"token":"secret","id":9007199254740993}\n{"skip":true}\n{"token":"last"}';
  const { file } = createStreamFile(text);
  const access = createLocalFileAccess(file);
  const bulk = vi.spyOn(access, "resolveRecords");
  try {
    const result = await buildRecordReport(
      createStreamingFileSourceRevision(1, access, "jsonl"),
      text.split("\n").map((line, index) => parsePreviewJsonlRecordLine(line, index + 1)),
      "3,1",
      "$.token",
      "",
      new AbortController().signal,
    );
    expect(result).toEqual(await report(text, "3,1", "$.token"));
    expect(bulk).not.toHaveBeenCalled();
  } finally {
    access.dispose();
  }
});

it("enforces a cumulative UTF-8 budget on selected streamed lines before parsing", async () => {
  const line = '{"v":"中"}';
  const { file } = createStreamFile(`${line}\n{"skipped":"${"x".repeat(100)}"}\n${line}`);
  const access = createLocalFileAccess(file);
  const bytes = new TextEncoder().encode(line).byteLength * 2;
  const received = vi.fn();
  try {
    await access.streamRecords(new Set([1, 3]), received, undefined, bytes);
    expect(received.mock.calls.map(([record]) => record.lineNumber)).toEqual([1, 3]);
    received.mockClear();
    await expect(
      access.streamRecords(new Set([1, 3]), received, undefined, bytes - 1),
    ).rejects.toThrow(SourceReadLimitError);
    expect(received).toHaveBeenCalledTimes(1);
  } finally {
    access.dispose();
  }
});

it("does not return a partial report when local streaming fails or is cancelled", async () => {
  const { file } = createStreamFile("{}\n{}");
  const access = createLocalFileAccess(file);
  const records = [parsePreviewJsonlRecordLine("{}", 1), parsePreviewJsonlRecordLine("{}", 2)];
  const source = createStreamingFileSourceRevision(1, access, "jsonl");
  const controller = new AbortController();
  const stream = access.streamRecords;
  const streamed = vi
    .spyOn(access, "streamRecords")
    .mockImplementation(async (lines, consume, signal, maxBytes) => {
      await stream(
        lines,
        async (record) => {
          await consume(record);
          controller.abort();
        },
        signal,
        maxBytes,
      );
    });
  try {
    await expect(
      buildRecordReport(source, records, "1-2", "", "", controller.signal),
    ).rejects.toThrow();
    streamed.mockRejectedValue(new SourceReadLimitError());
    await expect(
      buildRecordReport(source, records, "1-2", "", "", new AbortController().signal),
    ).rejects.toThrow(new RangeError("report-limit"));
  } finally {
    access.dispose();
  }
});
