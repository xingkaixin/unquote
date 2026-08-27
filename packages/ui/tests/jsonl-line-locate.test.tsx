import { parsePreviewJsonlRecordLine } from "@unquote/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalFileAccess } from "../src/lib/local-file-source";

const makeChunkedFile = (contents: string, chunkSize = Number.POSITIVE_INFINITY) => {
  const chunks: Uint8Array[] = [];
  const scans: Array<{ start: number; bytesRead: number }> = [];
  const makeFile = (bytes: Uint8Array, absoluteStart: number): File => {
    const file = new File([bytes.buffer as ArrayBuffer], "payload.jsonl", {
      type: "application/jsonl",
    });
    Object.defineProperty(file, "stream", {
      configurable: true,
      // Pull-based so the recorded chunks reflect what the scan actually read.
      value: () => {
        const scan = { start: absoluteStart, bytesRead: 0 };
        scans.push(scan);
        let offset = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= bytes.byteLength) {
              controller.close();
              return;
            }
            const chunk = bytes.slice(offset, offset + chunkSize);
            chunks.push(chunk);
            scan.bytesRead += chunk.byteLength;
            controller.enqueue(chunk);
            offset += chunkSize;
          },
        });
      },
    });
    Object.defineProperty(file, "slice", {
      configurable: true,
      value: (start = 0, end = bytes.byteLength) =>
        makeFile(bytes.slice(start, end), absoluteStart + start),
    });
    return file;
  };

  return { file: makeFile(new TextEncoder().encode(contents), 0), chunks, scans };
};

const jsonlLines = (count: number) =>
  Array.from({ length: count }, (_, index) => `{"i":${index + 1}}`);
const fixedWidthJsonlLine = (lineNumber: number) =>
  `{"i":"${String(lineNumber).padStart(6, "0")}"}`;

afterEach(() => vi.restoreAllMocks());

describe("locating a JSONL line by number", () => {
  it("bounds repeated scans across distant hydration targets", async () => {
    const contents = Array.from({ length: 100_000 }, (_, index) =>
      fixedWidthJsonlLine(index + 1),
    ).join("\n");
    const { file, scans } = makeChunkedFile(contents, 65_536);
    const access = createLocalFileAccess(file);
    const readTargets = async () => {
      await expect(access.readRecordTextByLine(1_000)).resolves.toBe(fixedWidthJsonlLine(1_000));

      const fullRecords = await access.readRecords(new Set([50_000]));
      expect(fullRecords.get(50_000)?.lineNumber).toBe(50_000);

      const preview = parsePreviewJsonlRecordLine(fixedWidthJsonlLine(99_000), 99_000);
      await expect(access.readRecordText(preview)).resolves.toBe(fixedWidthJsonlLine(99_000));
    };

    const initialRecords = await access.readRecords(new Set([99_000]));
    expect(initialRecords.get(99_000)?.lineNumber).toBe(99_000);
    const repeatedScanStart = scans.length;
    await readTargets();
    await readTargets();

    const repeatedScans = scans.slice(repeatedScanStart);
    expect(Math.max(...repeatedScans.map((scan) => scan.bytesRead))).toBeLessThanOrEqual(50_000);
    expect(repeatedScans.reduce((total, scan) => total + scan.bytesRead, 0)).toBeLessThanOrEqual(
      300_000,
    );
  });

  it.each([
    ["the first line", 1],
    ["a middle line", 500],
    ["the last line", 1000],
  ])("reads %s", async (_label, lineNumber) => {
    const { file } = makeChunkedFile(jsonlLines(1000).join("\n"));

    const text = await createLocalFileAccess(file).readRecordTextByLine(lineNumber);

    expect(text).toBe(`{"i":${lineNumber}}`);
  });

  it.each([
    ["CRLF separators", "\r\n"],
    ["LF separators", "\n"],
  ])("reads a line with %s", async (_label, separator) => {
    const { file } = makeChunkedFile(jsonlLines(300).join(separator), 7);

    const access = createLocalFileAccess(file);

    expect(await access.readRecordTextByLine(250)).toBe('{"i":250}');
    expect(await access.readRecordTextByLine(300)).toBe('{"i":300}');
  });

  it("reads a final line that has no trailing newline", async () => {
    const { file } = makeChunkedFile('{"a":1}\n{"b":2}');

    expect(await createLocalFileAccess(file).readRecordTextByLine(2)).toBe('{"b":2}');
  });

  it("reads a blank line between records", async () => {
    const { file } = makeChunkedFile('{"a":1}\n\n{"c":3}\n');
    const access = createLocalFileAccess(file);

    expect(await access.readRecordTextByLine(2)).toBe("");
    expect(await access.readRecordTextByLine(3)).toBe('{"c":3}');
  });

  it("returns the same text and line number before and after a checkpoint is retained", async () => {
    const { file } = makeChunkedFile(jsonlLines(1000).join("\n"));
    const access = createLocalFileAccess(file);

    const firstPass = await access.readRecords(new Set([950]));
    // The scan above retains checkpoints, so this read starts mid-file.
    const secondPass = await access.readRecords(new Set([950]));

    expect(secondPass.get(950)?.lineNumber).toBe(950);
    expect(secondPass.get(950)?.summary).toBe(firstPass.get(950)?.summary);
  });

  it("copies no bytes for the lines it skips over", async () => {
    const { file } = makeChunkedFile(jsonlLines(95_000).join("\n"));
    const merge = vi.spyOn(Uint8Array.prototype, "set");

    const text = await createLocalFileAccess(file).readRecordTextByLine(95_000);

    expect(text).toBe('{"i":95000}');
    // Each of the 94,999 skipped lines used to be merged into a fresh buffer
    // before its number was even checked. The handful of remaining calls come
    // from the test's own file plumbing, not from the scan.
    expect(merge.mock.calls.length).toBeLessThan(5);
  });

  it("merges only the target line when it spans chunks", async () => {
    const { file } = makeChunkedFile(jsonlLines(400).join("\n"), 6);
    const merge = vi.spyOn(Uint8Array.prototype, "set");

    const text = await createLocalFileAccess(file).readRecordTextByLine(400);

    expect(text).toBe('{"i":400}');
    // Only the requested line is reassembled, not the 399 lines scanned past.
    expect(merge.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("stops reading further chunks once every requested line is found", async () => {
    const { file, chunks } = makeChunkedFile(jsonlLines(2000).join("\n"), 64);

    await createLocalFileAccess(file).readRecords(new Set([2]));

    expect(chunks.length).toBeLessThan(5);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("reads nothing when the signal is already aborted", async () => {
    const { file } = makeChunkedFile(jsonlLines(100).join("\n"), 16);
    const controller = new AbortController();
    controller.abort();

    await expect(
      createLocalFileAccess(file).readRecords(new Set([50]), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
