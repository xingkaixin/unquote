import type { JsonlRecord } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFileText: vi.fn(),
  readJsonlRecordsByLine: vi.fn(),
  writeClipboardText: vi.fn(),
}));

vi.mock("../src/lib/local-file-source", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/local-file-source")>(
    "../src/lib/local-file-source",
  );
  return {
    ...actual,
    readFileText: mocks.readFileText,
    readJsonlRecordsByLine: mocks.readJsonlRecordsByLine,
  };
});

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));

import { useSourceLoader } from "../src/hooks/use-source-loader";

const largeFile = (name: string) => new File(["x".repeat(1_000_001)], name);

const setup = (overrides: Partial<Parameters<typeof useSourceLoader>[0]> = {}) => {
  const callbacks = {
    onReset: vi.fn(),
    onCollapseSource: vi.fn(),
    onError: vi.fn(),
    onCopyError: vi.fn(),
  };
  const params = {
    initialInput: "initial",
    ...callbacks,
    ...overrides,
  };
  return { callbacks, ...renderHook(() => useSourceLoader(params)) };
};

describe("useSourceLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeClipboardText.mockResolvedValue(true);
  });

  it("publishes text and imported files while restoring text after a read failure", async () => {
    const readError = new Error("read failed");
    const onReadFile = vi
      .fn<(file: File) => Promise<string>>()
      .mockResolvedValueOnce('{"imported":true}')
      .mockRejectedValueOnce(readError);
    const { result, callbacks } = setup({ onReadFile });

    act(() => result.current.onSourceChange("edited"));
    expect(result.current.sourceText).toBe("edited");
    expect(result.current.sourceRevision).toBe(1);

    const imported = new File([], "small.json");
    await act(() => result.current.onFileDrop(imported));
    expect(result.current.importedFile).toBe(imported);
    expect(result.current.sourceText).toBe('{"imported":true}');

    await act(() => result.current.onFileDrop(new File([], "broken.json")));
    expect(result.current.sourceText).toBe('{"imported":true}');
    expect(result.current.readingFile).toBeNull();
    expect(callbacks.onError).toHaveBeenCalledWith(readError);
    expect(callbacks.onReset).toHaveBeenCalledTimes(2);
  });

  it("reports read progress and ignores an obsolete read failure", async () => {
    let rejectRead: ((error: Error) => void) | undefined;
    mocks.readFileText.mockImplementation((_file: File, onProgress: (progress: number) => void) => {
      onProgress(0.5);
      return new Promise<string>((_resolve, reject) => {
        rejectRead = reject;
      });
    });
    const { result, callbacks } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(new File([], "slow.json"));
    });
    expect(result.current.readProgress).toBe(0.5);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => rejectRead?.(new Error("obsolete")));
    await readPromise;

    expect(result.current.sourceText).toBe("replacement");
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("collapses oversized text and ignores an obsolete successful import", async () => {
    let resolveRead: ((text: string) => void) | undefined;
    const onReadFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const { result, callbacks } = setup({ onReadFile });

    act(() => result.current.onSourceChange("x".repeat(1_000_001)));
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(1);

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(new File([], "slow.json"));
    });
    act(() => result.current.onSourceChange("replacement"));
    await act(async () => resolveRead?.("stale"));
    await readPromise;

    expect(result.current.sourceText).toBe("replacement");
    expect(result.current.importedFile).toBeNull();
  });

  it("switches a large file between streaming and imported modes", async () => {
    const file = largeFile("large.jsonl");
    const onReadFile = vi.fn().mockResolvedValue('{"loaded":true}');
    const { result, callbacks } = setup({ onReadFile });

    await act(() => result.current.onFileDrop(file));
    expect(result.current.sourceFile).toBe(file);
    expect(result.current.sourceText).toBe("");
    expect(onReadFile).not.toHaveBeenCalled();

    act(() => result.current.setMode("json"));
    await act(async () => undefined);
    expect(result.current.importedFile).toBe(file);
    expect(result.current.sourceText).toBe('{"loaded":true}');

    act(() => result.current.setMode("jsonl"));
    expect(result.current.sourceFile).toBe(file);
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(2);
  });

  it("rechecks the active mode when an asynchronous file read completes", async () => {
    let resolveRead: ((text: string) => void) | undefined;
    const onReadFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const file = largeFile("large.json");
    const { result } = setup({ onReadFile });
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(file);
    });
    act(() => result.current.setMode("jsonl"));
    await act(async () => resolveRead?.('{"loaded":true}'));
    await readPromise;

    expect(result.current.sourceFile).toBe(file);
    expect(result.current.importedFile).toBeNull();
  });

  it("opens files and text returned by the host", async () => {
    const file = new File([], "opened.json");
    const onReadFile = vi.fn().mockResolvedValue('{"file":true}');
    const onRequestOpenFile = vi
      .fn<() => Promise<File | string | null>>()
      .mockResolvedValueOnce(file)
      .mockResolvedValueOnce('{"text":true}')
      .mockResolvedValueOnce(null);
    const { result } = setup({ onReadFile, onRequestOpenFile });

    await act(() => result.current.onOpenFile());
    expect(result.current.importedFile).toBe(file);

    await act(() => result.current.onOpenFile());
    expect(result.current.sourceText).toBe('{"text":true}');
    expect(result.current.importedFile).toBeNull();

    await act(() => result.current.onOpenFile());
    expect(result.current.sourceText).toBe('{"text":true}');
  });

  it("resolves streamed records before copying and surfaces copy failures", async () => {
    const file = largeFile("large.jsonl");
    const { result, callbacks } = setup();
    await act(() => result.current.onFileDrop(file));
    const parsedRecord = parseInput('{"value":1}').records[0];
    expect(parsedRecord).toBeDefined();
    mocks.readJsonlRecordsByLine.mockResolvedValue(new Map([[1, parsedRecord]]));

    await act(() =>
      result.current.onCopyRawLine({
        id: "record-1",
        lineNumber: 1,
        node: null,
        deferred: true,
        summary: "deferred",
      }),
    );
    expect(mocks.writeClipboardText).toHaveBeenCalledWith('{"value":1}');

    mocks.readJsonlRecordsByLine.mockResolvedValue(
      new Map<number, JsonlRecord>([
        [
          2,
          {
            id: "record-2",
            lineNumber: 2,
            node: null,
            rawLine: "raw line",
            summary: "raw line",
          },
        ],
      ]),
    );
    mocks.writeClipboardText.mockResolvedValue(false);
    await act(() =>
      result.current.onCopyRawLine({
        id: "record-2",
        lineNumber: 2,
        node: null,
        deferred: true,
        summary: "deferred",
      }),
    );
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("raw line");
    expect(callbacks.onCopyError).toHaveBeenCalledTimes(1);

    const readError = new Error("record read failed");
    mocks.readJsonlRecordsByLine.mockRejectedValue(readError);
    await act(() =>
      result.current.onCopyRawLine({
        id: "record-3",
        lineNumber: 3,
        node: null,
        deferred: true,
        summary: "deferred",
      }),
    );
    expect(callbacks.onError).toHaveBeenCalledWith(readError);
  });

  it("copies inline record text without resolving a file", async () => {
    const { result } = setup();

    await act(() =>
      result.current.onCopyRawLine({
        id: "record-1",
        lineNumber: 1,
        node: null,
        errorMeta: { line: 1, column: 1, rawLine: "invalid raw line", context: "invalid" },
        summary: "invalid",
      }),
    );

    expect(mocks.readJsonlRecordsByLine).not.toHaveBeenCalled();
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("invalid raw line");
  });
});
