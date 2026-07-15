import { parseInput } from "@unquote/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExportActions } from "../src/hooks/use-export-actions";
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
}: {
  getFullRecords?: (records: (typeof validRecord)[]) => Promise<(typeof validRecord)[]>;
  isCopyBlocked?: boolean;
} = {}) =>
  renderHook(
    () =>
      useExportActions({
        visibleRecords: [validRecord],
        getFullRecords,
        format: "json",
        isCopyBlocked,
      }),
    { wrapper },
  );

describe("useExportActions", () => {
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

  it("falls back to the requested record when hydration returns no records", async () => {
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

  it("copies parse errors with and without structured metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.onCopyRecordError(failedRecord);
      await result.current.onCopyRecordError({
        id: "record-2",
        lineNumber: 2,
        node: null,
        summary: "failed",
      });
    });

    expect(writeText.mock.calls[0]?.[0]).toContain("Line 1, column 2");
    expect(writeText.mock.calls[0]?.[0]).toContain("Raw line:");
    expect(writeText.mock.calls[1]?.[0]).toBe("Error: Parse failed");
  });
});
