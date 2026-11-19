import {
  readJsonlFileLines,
  readJsonlLinesByNumber,
  seedJsonlLineCheckpoints,
  SourceReadLimitError,
} from "../src/lib/local-file-reader";
import { createStreamFile } from "./helpers/stub-file";
import { describe, expect, it } from "vitest";

const createLineFile = (contents: string, streamed: boolean) => {
  const file = new File([contents], "payload.jsonl", { type: "application/jsonl" });
  if (streamed) {
    Object.defineProperty(file, "stream", {
      configurable: true,
      value: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(contents));
            controller.close();
          },
        }),
    });
  } else {
    Object.defineProperty(file, "stream", { configurable: true, value: undefined });
    Object.defineProperty(file, "text", { configurable: true, value: undefined });
  }
  return file;
};

const collectLines = async (file: File) => {
  const lines: Array<[number, string]> = [];
  await readJsonlFileLines(file, (line, lineNumber) => {
    lines.push([lineNumber, line]);
  });
  return lines;
};

describe("local JSONL line reading", () => {
  it.each([
    ["empty input", "", []],
    ["newline-terminated input", '{"a":1}\n', [[1, '{"a":1}']]],
    [
      "CRLF and blank lines",
      '\r\n{"a":1}\r\n\r\n',
      [
        [1, ""],
        [2, '{"a":1}'],
        [3, ""],
      ],
    ],
  ])("keeps stream and FileReader results equal for %s", async (_, contents, expected) => {
    await expect(collectLines(createLineFile(contents, true))).resolves.toEqual(expected);
    await expect(collectLines(createLineFile(contents, false))).resolves.toEqual(expected);
  });

  it.each([true, false])("waits for each async callback when streamed is %s", async (streamed) => {
    const events: string[] = [];
    await readJsonlFileLines(createLineFile("first\nsecond\nthird", streamed), async (line) => {
      events.push(`start:${line}`);
      await Promise.resolve();
      events.push(`end:${line}`);
      return line !== "second";
    });

    expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });
});

it("rejects oversized requested lines before collecting the full source", async () => {
  const { file } = createStreamFile('"中文"\n"second"', "bounded.jsonl");
  const bytes = new TextEncoder().encode('"中文"\n"second"');
  Object.defineProperty(file, "slice", {
    value: (start: number, end: number) => ({
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(start, end));
            controller.close();
          },
        }),
    }),
  });
  await expect(readJsonlLinesByNumber(file, new Set([1]), undefined, 7)).rejects.toBeInstanceOf(
    SourceReadLimitError,
  );
  await expect(readJsonlLinesByNumber(file, new Set([1]), undefined, 8)).resolves.toEqual(
    new Map([[1, '"中文"']]),
  );
});

it("rejects with AbortError when aborted mid-read instead of returning partial lines", async () => {
  const controller = new AbortController();
  let readCount = 0;
  const encoder = new TextEncoder();
  const file = new File(['{"a":1}\n{"b":2}\n'], "abort.jsonl");
  Object.defineProperty(file, "slice", {
    value: () => ({
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(streamController) {
            readCount += 1;
            if (readCount === 1) {
              streamController.enqueue(encoder.encode('{"a":1}\n'));
              controller.abort();
            } else {
              streamController.enqueue(encoder.encode('{"b":2}\n'));
              streamController.close();
            }
          },
        }),
    }),
  });

  await expect(
    readJsonlLinesByNumber(file, new Set([1, 2]), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("uses seeded checkpoints for the first random line read", async () => {
  const contents = '{"line":1}\n{"line":2}\n{"line":3}\n';
  const bytes = new TextEncoder().encode(contents);
  const sliceStarts: number[] = [];
  const file = new File([contents], "seeded.jsonl");
  Object.defineProperty(file, "slice", {
    value: (start = 0, end = bytes.byteLength) => {
      sliceStarts.push(start);
      return {
        stream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.slice(start, end));
              controller.close();
            },
          }),
      };
    },
  });

  seedJsonlLineCheckpoints(file, [{ lineNumber: 3, byteOffset: contents.indexOf('{"line":3}') }]);
  const lines = await readJsonlLinesByNumber(file, new Set([3]));

  expect(sliceStarts).toEqual([contents.indexOf('{"line":3}')]);
  expect(lines).toEqual(new Map([[3, '{"line":3}']]));
});
