import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import { describe, expect, it, vi } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import { searchRecords } from "../src/lib/tree";

const makeStreamedFile = (contents: string, name = "payload.jsonl") => {
  const file = new File([contents], name, { type: "application/jsonl" });
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
  return file;
};

const makeMeasuredFile = (contents: string, chunkSize = Number.POSITIVE_INFINITY) => {
  const sliceStarts: number[] = [];
  const makeFile = (bytes: Uint8Array, absoluteStart: number): File => {
    const fileBytes = Uint8Array.from(bytes);
    const file = new File([fileBytes.buffer], "payload.jsonl", { type: "application/jsonl" });
    Object.defineProperty(file, "stream", {
      configurable: true,
      value: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
              controller.enqueue(bytes.slice(offset, offset + chunkSize));
            }
            controller.close();
          },
        }),
    });
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: (start = 0, end = bytes.byteLength) => {
        sliceStarts.push(absoluteStart + start);
        return makeFile(bytes.slice(start, end), absoluteStart + start);
      },
    });
    return file;
  };

  return { file: makeFile(new TextEncoder().encode(contents), 0), sliceStarts };
};

const oversizedMatchCount = 130_000;

describe("local-file-source", () => {
  it("reads full records for the requested line numbers", async () => {
    const file = makeStreamedFile('{"a":1}\n{"b":2}\n{"c":3}\n');

    const records = await createLocalFileAccess(file).readRecords(new Set([1, 3]));

    expect(records.size).toBe(2);
    expect(records.get(1)?.lineNumber).toBe(1);
    expect(records.get(3)?.lineNumber).toBe(3);
    expect(records.has(2)).toBe(false);
  });

  it("resolves preview records and raw copy text through the source interface", async () => {
    const access = createLocalFileAccess(
      makeStreamedFile(' { "value": 1 } \ninvalid json\n', "records.jsonl"),
    );
    const preview = parsePreviewJsonlRecordLine('{"value":1}', 1);
    const failedPreview = parsePreviewJsonlRecordLine("invalid json", 2);

    const resolved = await access.resolveRecords([preview, failedPreview]);

    expect(resolved.map((record) => record.status)).toEqual(["full", "failed"]);
    await expect(access.readRecordText(preview)).resolves.toBe('{"value":1}');
    await expect(access.readRecordText(failedPreview)).resolves.toBe("invalid json");
    await expect(access.readRecordTextByLine(1)).resolves.toBe(' { "value": 1 } ');
    await expect(access.readRecordTextByLine(2)).resolves.toBe("invalid json");
  });

  it("returns an empty map when no lines are requested", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    await expect(createLocalFileAccess(file).readRecords(new Set())).resolves.toEqual(new Map());
  });

  it("accepts export-sized line-number sets", async () => {
    const file = makeStreamedFile('{"a":1}');
    const lineNumbers = new Set(Array.from({ length: 100_000 }, (_, index) => index + 1));

    const records = await createLocalFileAccess(file).readRecords(lineNumbers);

    expect(records.get(1)?.lineNumber).toBe(1);
  });

  it("reuses indexed byte offsets across sequential hydration reads", async () => {
    const contents = Array.from({ length: 1_000 }, (_, index) => `{"i":${index}}`).join("\n");
    const { file, sliceStarts } = makeMeasuredFile(contents);

    const access = createLocalFileAccess(file);
    await access.readRecords(new Set([250]));
    await access.readRecords(new Set([500]));

    expect(sliceStarts[0]).toBe(0);
    expect(sliceStarts[1]).toBeGreaterThan(0);
  });

  it("keeps line indexes isolated per source file", async () => {
    const first = makeMeasuredFile('{"source":1}\n{"source":1}');
    const second = makeMeasuredFile('{"source":2}\n{"source":2}');

    await createLocalFileAccess(first.file).readRecords(new Set([2]));
    await createLocalFileAccess(second.file).readRecords(new Set([2]));

    expect(first.sliceStarts[0]).toBe(0);
    expect(second.sliceStarts[0]).toBe(0);
  });

  it("preserves UTF-8 and CRLF lines across stream chunks", async () => {
    const { file } = makeMeasuredFile(
      ['{"message":"一"}', '{"message":"二"}', '{"message":"三"}', '{"message":"四"}'].join("\r\n"),
      5,
    );

    const access = createLocalFileAccess(file);
    await access.readRecords(new Set([2]));
    const records = await access.readRecords(new Set([4]));

    expect(records.get(4)?.node?.children).toMatchObject({
      message: expect.objectContaining({ value: "四" }),
    });
  });

  it("reads backwards from a retained checkpoint", async () => {
    const contents = Array.from({ length: 800 }, (_, index) => `{"i":${index}}`).join("\n");
    const { file, sliceStarts } = makeMeasuredFile(contents);

    const access = createLocalFileAccess(file);
    await access.readRecords(new Set([700]));
    const records = await access.readRecords(new Set([300]));

    expect(sliceStarts[1]).toBeGreaterThan(0);
    expect(records.get(300)?.lineNumber).toBe(300);
  });

  it("falls back safely after old checkpoints are evicted", async () => {
    const contents = Array.from({ length: 10_000 }, (_, index) => `{"i":${index}}`).join("\n");
    const { file } = makeMeasuredFile(contents);

    const access = createLocalFileAccess(file);
    await access.readRecords(new Set([10_000]));
    const records = await access.readRecords(new Set([100]));

    expect(records.get(100)?.lineNumber).toBe(100);
  });

  it("stops indexed reads when aborted", async () => {
    const { file } = makeMeasuredFile('{"a":1}\n{"b":2}', 2);
    const controller = new AbortController();
    controller.abort();

    await expect(
      createLocalFileAccess(file).readRecords(new Set([2]), controller.signal),
    ).resolves.toEqual(new Map());
  });

  it("searches raw lines and reports matches across them", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n{"message":"hay"}\n');
    const controller = new AbortController();

    const matches = await createLocalFileAccess(file).search(
      "needle",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(1);
    expect(matches?.[0]?.recordId).toBe("record-1");
  });

  it("skips parsing lines that cannot contain a safe literal match", async () => {
    const skippedLine = '{"message":"hay"}';
    const matchedLine = '{"message":"needle"}';
    const escapedLine = String.raw`{"message":"\u006eeedle"}`;
    const parse = vi.spyOn(JSON, "parse");
    const controller = new AbortController();

    const matches = await createLocalFileAccess(
      makeStreamedFile([skippedLine, matchedLine, escapedLine].join("\n")),
    ).search("needle", { regex: false, caseSensitive: false, jq: false }, controller.signal);

    expect(matches?.map((match) => match.recordId)).toEqual(["record-2", "record-3"]);
    expect(parse.mock.calls.filter(([input]) => input === skippedLine)).toHaveLength(0);
    expect(parse.mock.calls.filter(([input]) => input === matchedLine)).toHaveLength(1);
    expect(parse.mock.calls.filter(([input]) => input === escapedLine)).toHaveLength(1);
    parse.mockRestore();
  });

  it("matches parsed-record search paths, ranges, and stringified chains", async () => {
    const contents = [
      JSON.stringify({
        "a.b": "needle",
        payload: JSON.stringify({ nested: [{ needle: "needle" }], nullable: null }),
      }),
      JSON.stringify({ message: "hay", "needle.key": true }),
    ].join("\n");
    const options = { regex: false, caseSensitive: true, jq: true };
    const controller = new AbortController();
    const expected = searchRecords(
      parseInput(contents, { forcedFormat: "jsonl" }).records,
      "needle",
      options,
    );

    const matches = await createLocalFileAccess(makeStreamedFile(contents)).search(
      "needle",
      options,
      controller.signal,
    );

    expect(matches).toEqual(expected);
    expect(matches).toContainEqual({
      recordId: "record-1",
      pathText: "$.payload.nested[0].needle",
      keyRanges: [{ start: 0, end: 6 }],
      valueRanges: [{ start: 1, end: 7 }],
      pathRanges: [{ start: 20, end: 26 }],
      stringifiedPathChain: ["$.payload"],
    });
  });

  it("aggregates a file line with more matches than the function argument limit", async () => {
    const contents = JSON.stringify(Array.from({ length: oversizedMatchCount }, () => "needle"));
    const file = makeStreamedFile(contents);
    const controller = new AbortController();

    const matches = await createLocalFileAccess(file).search(
      "needle",
      { regex: false, caseSensitive: true, jq: false },
      controller.signal,
    );

    expect(matches).toHaveLength(oversizedMatchCount);
  });

  it("returns null when aborted mid-scan", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n{"message":"hay"}\n');
    const controller = new AbortController();
    controller.abort();

    const matches = await createLocalFileAccess(file).search(
      "needle",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).toBeNull();
  });

  it("returns null for an empty query", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n');
    const controller = new AbortController();

    const matches = await createLocalFileAccess(file).search(
      "",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).toBeNull();
  });

  it("reads file text via stream", async () => {
    const file = makeStreamedFile('{"streamed":true}\n');
    const progress: number[] = [];

    const text = await createLocalFileAccess(file).readText((value) => progress.push(value));

    expect(text).toBe('{"streamed":true}\n');
    expect(progress.at(-1)).toBe(1);
  });

  it("falls back to FileReader when neither stream nor text() are available", async () => {
    const file = new File(['{"pasted":true}'], "payload.json", {
      type: "application/json",
    });
    // Remove both stream() and text() so the FileReader fallback runs.
    Object.defineProperty(file, "stream", { configurable: true, value: undefined });
    Object.defineProperty(file, "text", { configurable: true, value: undefined });
    const progress: number[] = [];

    const text = await createLocalFileAccess(file).readText((value) => progress.push(value));

    expect(text).toBe('{"pasted":true}');
    // FileReader reports progress through onprogress and finishes with onProgress(1).
    expect(progress.at(-1)).toBe(1);
  });
});
