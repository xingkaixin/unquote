import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExportActions } from "../src/hooks/use-export-actions";
import type { LocalFileExportAccess } from "../src/hooks/use-export-actions";
import { I18nProvider } from "../src/i18n/context";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => promise),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const originalClipboard = navigator.clipboard;
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
const validRecord = parseInput('{"ok":true}', { forcedFormat: "json" }).records[0]!;
const validRecords = [validRecord];
const failedRecord = parseInput("{bad}", { forcedFormat: "jsonl" }).records[0]!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
});

const renderActions = ({
  getFullRecords = vi.fn(async (records) => records),
  isCopyBlocked = false,
  sourceAccess = null,
}: {
  getFullRecords?: (
    records: (typeof validRecord)[],
    signal?: AbortSignal,
  ) => Promise<(typeof validRecord)[]>;
  isCopyBlocked?: boolean;
  sourceAccess?: LocalFileExportAccess | null;
} = {}) =>
  renderHook(
    ({ sourceRevision }: { sourceRevision: number }) =>
      useExportActions({
        visibleRecords: validRecords,
        resolveRecords: getFullRecords,
        sourceAccess,
        format: "json",
        isCopyBlocked,
        sourceRevision,
      }),
    { wrapper, initialProps: { sourceRevision: 0 } },
  );

describe("useExportActions", () => {
  it("blocks copy when record resolution leaves a preview", async () => {
    const preview = parsePreviewJsonlRecordLine("null", 1);
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { result } = renderActions({ getFullRecords: vi.fn(async () => [preview]) });
    await act(async () => {
      await result.current.onCopyJsonl();
      await result.current.onCopyFormattedJson();
      await result.current.onCopyRecord(preview);
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledTimes(3);
    expect(toastMocks.error).toHaveBeenCalledWith("Copy failed");
  });

  it("keeps action references stable while inputs are unchanged", () => {
    const { result, rerender } = renderActions();
    const actions = result.current;

    rerender({ sourceRevision: 0 });

    expect(result.current).toBe(actions);
  });

  it("blocks both bulk copy formats before resolving records", async () => {
    const getFullRecords = vi.fn(async (records: (typeof validRecord)[]) => records);
    const { result } = renderActions({ getFullRecords, isCopyBlocked: true });

    await act(async () => {
      await result.current.onCopyJsonl();
      await result.current.onCopyFormattedJson();
    });

    expect(getFullRecords).not.toHaveBeenCalled();
    expect(toastMocks.warning).toHaveBeenCalledTimes(2);
  });

  it("reports record-resolution failures for both bulk copy formats", async () => {
    const getFullRecords =
      vi.fn<(records: (typeof validRecord)[]) => Promise<(typeof validRecord)[]>>();
    getFullRecords.mockRejectedValue(new Error("read failed"));
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions({ getFullRecords });

    await act(async () => {
      await result.current.onCopyJsonl();
      await result.current.onCopyFormattedJson();
    });

    expect(toastMocks.error).toHaveBeenNthCalledWith(1, "Failed to read file");
    expect(toastMocks.error).toHaveBeenNthCalledWith(2, "Failed to read file");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies formatted JSON and reports clipboard rejection", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.onCopyFormattedJson();
    });

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
    expect(toastMocks.error).toHaveBeenCalledWith("Copy failed");
  });

  it("falls back to the requested record when Full Record resolution returns no records", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions({ getFullRecords: vi.fn(async () => []) });

    await act(async () => {
      await result.current.onCopyRecord(validRecord);
    });

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
  });

  it("copies parse errors with structured diagnostics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.onCopyRecordError(failedRecord);
    });

    expect(writeText.mock.calls[0]?.[0]).toContain("Line 1, column 2");
    expect(writeText.mock.calls[0]?.[0]).toContain("Raw line:");
  });

  it("copies inline record text when no local file backs the source", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.onCopyRawLine(failedRecord);
    });

    expect(writeText).toHaveBeenCalledWith("{bad}");
  });

  it("reads the raw line from the local file and reports a read failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const readRecordText = vi.fn().mockResolvedValue('{"raw":true}');
    const sourceAccess: LocalFileExportAccess = { readRecordText, streamRecords: vi.fn() };
    const { result } = renderActions({ sourceAccess });

    await act(async () => {
      await result.current.onCopyRawLine(validRecord);
    });
    expect(writeText).toHaveBeenCalledWith('{"raw":true}');

    readRecordText.mockRejectedValue(new Error("record read failed"));
    await act(async () => {
      await result.current.onCopyRawLine(validRecord);
    });
    expect(toastMocks.error).toHaveBeenLastCalledWith("Failed to read file");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("lets the newest copy win across different copy entry points", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let resolveSlow!: (records: (typeof validRecord)[]) => void;
    let slowSignal: AbortSignal | undefined;
    const getFullRecords = vi.fn(
      (_records: (typeof validRecord)[], signal?: AbortSignal) =>
        new Promise<(typeof validRecord)[]>((resolve) => {
          slowSignal = signal;
          resolveSlow = resolve;
        }),
    );
    const { result } = renderActions({ getFullRecords });

    // Started outside `act` so the faster copy below can overtake it.
    const bulkCopy = result.current.onCopyJsonl();
    await act(async () => {
      await result.current.onCopyRecordError(failedRecord);
    });
    await act(async () => {
      resolveSlow(validRecords);
      await bulkCopy;
    });

    expect(slowSignal?.aborted).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Raw line:");
  });

  it("drops an in-flight copy once the source is replaced", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let resolvePending!: (records: (typeof validRecord)[]) => void;
    const getFullRecords = vi.fn(
      () =>
        new Promise<(typeof validRecord)[]>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const { result, rerender } = renderActions({ getFullRecords });

    const copy = result.current.onCopyJsonl();
    rerender({ sourceRevision: 1 });
    await act(async () => {
      resolvePending(validRecords);
      await copy;
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("does not report a stale record-resolution failure after the source is replaced", async () => {
    let copySignal: AbortSignal | undefined;
    const getFullRecords = vi.fn(
      (_records: (typeof validRecord)[], signal?: AbortSignal) =>
        new Promise<(typeof validRecord)[]>((_resolve, reject) => {
          copySignal = signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const { result, rerender } = renderActions({ getFullRecords });

    const copy = result.current.onCopyJsonl();
    rerender({ sourceRevision: 1 });
    await act(async () => {
      await copy;
    });

    expect(copySignal?.aborted).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("does not report a stale raw-line failure after the source is replaced", async () => {
    let copySignal: AbortSignal | undefined;
    const readRecordText = vi.fn(
      (_record: typeof validRecord, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          copySignal = signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const sourceAccess: LocalFileExportAccess = { readRecordText, streamRecords: vi.fn() };
    const { result, rerender } = renderActions({ sourceAccess });

    const copy = result.current.onCopyRawLine(validRecord);
    rerender({ sourceRevision: 1 });
    await act(async () => {
      await copy;
    });

    expect(copySignal?.aborted).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
