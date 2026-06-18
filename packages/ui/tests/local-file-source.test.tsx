import { describe, expect, it } from "vitest";
import {
  readFileText,
  readJsonlRecordsByLine,
  searchJsonlFile,
} from "../src/lib/local-file-source";

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

describe("local-file-source", () => {
  it("reads full records for the requested line numbers", async () => {
    const file = makeStreamedFile('{"a":1}\n{"b":2}\n{"c":3}\n');

    const records = await readJsonlRecordsByLine(file, new Set([1, 3]));

    expect(records.size).toBe(2);
    expect(records.get(1)?.lineNumber).toBe(1);
    expect(records.get(3)?.lineNumber).toBe(3);
    expect(records.has(2)).toBe(false);
  });

  it("returns an empty map when no lines are requested", async () => {
    const file = makeStreamedFile('{"a":1}\n');
    await expect(readJsonlRecordsByLine(file, new Set())).resolves.toEqual(new Map());
  });

  it("searches raw lines and reports matches across them", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n{"message":"hay"}\n');
    const controller = new AbortController();

    const matches = await searchJsonlFile(
      file,
      "needle",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(1);
    expect(matches?.[0]?.recordId).toBe("record-1");
  });

  it("returns null when aborted mid-scan", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n{"message":"hay"}\n');
    const controller = new AbortController();
    controller.abort();

    const matches = await searchJsonlFile(
      file,
      "needle",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).toBeNull();
  });

  it("returns null for an empty query", async () => {
    const file = makeStreamedFile('{"message":"needle"}\n');
    const controller = new AbortController();

    const matches = await searchJsonlFile(
      file,
      "",
      { regex: false, caseSensitive: false, jq: false },
      controller.signal,
    );

    expect(matches).toBeNull();
  });

  it("reads file text via stream", async () => {
    const file = makeStreamedFile('{"streamed":true}\n');
    const progress: number[] = [];

    const text = await readFileText(file, (value) => progress.push(value));

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

    const text = await readFileText(file, (value) => progress.push(value));

    expect(text).toBe('{"pasted":true}');
    // FileReader reports progress through onprogress and finishes with onProgress(1).
    expect(progress.at(-1)).toBe(1);
  });
});
