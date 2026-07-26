import { parseJsonlRecordLine, parsePreviewJsonlRecordLine } from "@unquote/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/context";
import {
  createControlledStreamFile,
  createFailingStreamFile,
  createStreamFile,
} from "./helpers/stub-file";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));
vi.mock("sonner", () => ({ toast: toastMocks }));

import { useSourceLoader } from "../src/hooks/use-source-loader";

const oversizedContents = (prefix: string) => prefix.padEnd(1_000_001, " ");
const previewRecord = (lineNumber: number) =>
  parsePreviewJsonlRecordLine('{"value":"preview"}', lineNumber);
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const setup = (overrides: Partial<Parameters<typeof useSourceLoader>[0]> = {}) => {
  const callbacks = {
    onCollapseSource: vi.fn(),
  };
  const params = {
    initialInput: "initial",
    ...callbacks,
    ...overrides,
  };
  return { callbacks, ...renderHook(() => useSourceLoader(params), { wrapper }) };
};

describe("useSourceLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.writeClipboardText.mockResolvedValue(true);
  });

  it("keeps record copy stable across source state updates", () => {
    const { result } = setup();
    const onCopyRawLine = result.current.onCopyRawLine;

    act(() => result.current.onSourceChange("edited"));

    expect(result.current.onCopyRawLine).toBe(onCopyRawLine);
  });

  it("publishes parsing-mode changes as new Source Revisions", () => {
    const { result } = setup();

    act(() => result.current.setMode("json"));
    expect(result.current.sourceRevision).toBe(1);

    act(() => result.current.setMode("json"));
    expect(result.current.sourceRevision).toBe(1);

    act(() => result.current.setMode("jsonl"));
    expect(result.current.sourceRevision).toBe(2);
  });

  it("returns the exact revision assigned to a text source", () => {
    const { result } = setup();
    let publishedRevision = -1;

    act(() => {
      result.current.setMode("json");
      publishedRevision = result.current.onSourceChange("sample");
    });

    expect(publishedRevision).toBe(2);
    expect(result.current.sourceRevision).toBe(2);
  });

  it("keeps the published Source stable while a replacement file is read", async () => {
    const controlled = createControlledStreamFile('{"replacement":true}', "replacement.json");
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => result.current.onSourceChange('{"current":true}'));
    const currentRevision = result.current.sourceRevision;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });

    expect(controlled.stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe('{"current":true}');
    expect(result.current.sourceAccess).toBeNull();
    expect(result.current.sourceRevision).toBe(currentRevision);

    await act(async () => {
      controlled.complete();
      await readPromise;
    });
    expect(result.current.sourceText).toBe('{"replacement":true}');
    expect(result.current.sourceRevision).toBe(currentRevision + 1);
  });

  it("publishes text and imported files while restoring text after a read failure", async () => {
    const readError = new Error("read failed");
    const imported = createStreamFile('{"imported":true}', "small.json");
    const broken = createFailingStreamFile(readError, "broken.json");
    const { result } = setup();

    act(() => result.current.onSourceChange("edited"));
    expect(result.current.sourceText).toBe("edited");
    expect(result.current.sourceRevision).toBe(1);

    await act(() => result.current.onFileDrop(imported.file));
    expect(imported.stream).toHaveBeenCalledTimes(1);
    expect(result.current.importedFile).toBe(imported.file);
    expect(result.current.sourceText).toBe('{"imported":true}');

    await act(() => result.current.onFileDrop(broken.file));
    expect(broken.stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe('{"imported":true}');
    expect(result.current.readingFile).toBeNull();
    expect(toastMocks.error).toHaveBeenCalledWith("Failed to read file");
  });

  it("reports read progress and ignores an obsolete read failure", async () => {
    const controlled = createControlledStreamFile("slow", "slow.json");
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    await act(async () => {
      controlled.enqueue("sl");
    });
    expect(result.current.readProgress).toBe(0.5);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.fail(new Error("obsolete"));
      await readPromise;
    });

    expect(result.current.sourceText).toBe("replacement");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("collapses oversized text and ignores an obsolete successful import", async () => {
    const controlled = createControlledStreamFile("stale", "slow.json");
    const { result, callbacks } = setup();

    act(() => result.current.onSourceChange("x".repeat(1_000_001)));
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(1);

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(result.current.sourceText).toBe("replacement");
    expect(result.current.importedFile).toBeNull();
  });

  it("switches a large file between streaming and imported modes", async () => {
    const contents = oversizedContents('{"loaded":true}');
    const { file, stream } = createStreamFile(contents, "large.jsonl");
    const { result, callbacks } = setup();

    await act(() => result.current.onFileDrop(file));
    expect(result.current.sourceAccess?.getFile()).toBe(file);
    expect(result.current.sourceText).toBe("");
    expect(stream).not.toHaveBeenCalled();

    act(() => result.current.setMode("json"));
    await waitFor(() => expect(result.current.importedFile).toBe(file));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe(contents);

    act(() => result.current.setMode("jsonl"));
    expect(result.current.sourceAccess?.getFile()).toBe(file);
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(3);
  });

  it("rechecks the active mode when an asynchronous file read completes", async () => {
    const controlled = createControlledStreamFile(
      oversizedContents('{"loaded":true}'),
      "large.json",
    );
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => result.current.setMode("jsonl"));
    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(result.current.sourceAccess?.getFile()).toBe(controlled.file);
    expect(result.current.importedFile).toBeNull();
  });

  it("opens files and text returned by the host", async () => {
    const { file, stream } = createStreamFile('{"file":true}', "opened.json");
    const onRequestOpenFile = vi
      .fn<() => Promise<File | string | null>>()
      .mockResolvedValueOnce(file)
      .mockResolvedValueOnce('{"text":true}')
      .mockResolvedValueOnce(null);
    const { result } = setup({ onRequestOpenFile });

    await act(() => result.current.onOpenFile());
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.importedFile).toBe(file);

    await act(() => result.current.onOpenFile());
    expect(result.current.sourceText).toBe('{"text":true}');
    expect(result.current.importedFile).toBeNull();

    await act(() => result.current.onOpenFile());
    expect(result.current.sourceText).toBe('{"text":true}');
  });

  it("resolves streamed records before copying and surfaces copy failures", async () => {
    const { file } = createStreamFile(
      `{"value":1}\nraw line\n${"x".repeat(1_000_001)}`,
      "large.jsonl",
    );
    const { result } = setup();
    await act(() => result.current.onFileDrop(file));

    await act(() => result.current.onCopyRawLine(previewRecord(1)));
    expect(mocks.writeClipboardText).toHaveBeenCalledWith('{"value":1}');

    mocks.writeClipboardText.mockResolvedValue(false);
    await act(() => result.current.onCopyRawLine(previewRecord(2)));
    expect(mocks.writeClipboardText).toHaveBeenLastCalledWith("raw line");
    expect(toastMocks.error).toHaveBeenLastCalledWith("Copy failed");

    const readError = new Error("record read failed");
    const failure = createFailingStreamFile(readError, "broken.jsonl", "x".repeat(1_000_001));
    await act(() => result.current.onFileDrop(failure.file));
    await act(() => result.current.onCopyRawLine(previewRecord(3)));
    expect(toastMocks.error).toHaveBeenLastCalledWith("Failed to read file");
  });

  it("copies inline record text without resolving a file", async () => {
    const { result } = setup();

    await act(() => result.current.onCopyRawLine(parseJsonlRecordLine("invalid raw line", 1)));

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("invalid raw line");
  });
});
