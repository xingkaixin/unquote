import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/context";
import { createControlledStreamFile, createStreamFile } from "./helpers/stub-file";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => promise),
  warning: vi.fn(),
}));
const exportMocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));
vi.mock("../src/lib/record-export", async () => ({
  ...(await vi.importActual<typeof import("../src/lib/record-export")>("../src/lib/record-export")),
  downloadBlob: exportMocks.downloadBlob,
}));

import { useExportActions } from "../src/hooks/use-export-actions";
import type { LocalFileExportAccess } from "../src/hooks/use-export-actions";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import type { LocalFileAccess } from "../src/lib/local-file-source";
import {
  ExportSizeLimitError,
  addRecordsToBuilder,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
} from "../src/lib/record-export";

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const previewRecords = (lines: string[]) =>
  lines.map((line, index) => parsePreviewJsonlRecordLine(line, index + 1));
const fullRecords = (lines: string[]) =>
  parseInput(lines.join("\n"), { forcedFormat: "jsonl" }).records;

const downloadedText = () => {
  const parts = exportMocks.downloadBlob.mock.calls.at(-1)?.[0] as BlobPart[];
  return parts.join("");
};

const renderExport = ({
  visibleRecords,
  sourceAccess,
  format = "jsonl",
  resolveRecords = vi.fn(async (records: JsonlRecord[]) => records),
}: {
  visibleRecords: JsonlRecord[];
  sourceAccess: LocalFileExportAccess | null;
  format?: "json" | "jsonl";
  resolveRecords?: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
}) => ({
  resolveRecords,
  ...renderHook(
    ({ sourceRevision }: { sourceRevision: number }) =>
      useExportActions({
        visibleRecords,
        resolveRecords,
        sourceAccess,
        format,
        isCopyBlocked: false,
        sourceRevision,
      }),
    { wrapper, initialProps: { sourceRevision: 0 } },
  ),
});

const fixtureLines = [
  '{"id":1,"nested":"{\\"deep\\":true}"}',
  "not json at all",
  '{"id":3,"text":"unicode ✓"}',
  '{"id":4}',
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("streaming export", () => {
  it("does not download a partial export when a preview record cannot be resolved", async () => {
    const { file } = createStreamFile("null", "missing.jsonl");
    const { result } = renderExport({
      visibleRecords: previewRecords(["null", "true"]),
      sourceAccess: createLocalFileAccess(file),
    });
    await act(async () => {
      result.current.onExportJsonl();
      const pending = toastMocks.promise.mock.calls.at(-1)![0];
      await expect(pending).rejects.toThrow(TypeError);
    });
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Export failed");
  });

  it.each(["jsonl", "json"] as const)(
    "produces byte-identical %s output without materializing every record",
    async (format) => {
      const contents = fixtureLines.join("\n");
      const { file } = createStreamFile(contents, "fixture.jsonl");
      const access = createLocalFileAccess(file);
      const records = previewRecords(fixtureLines);
      const builder =
        format === "jsonl" ? createJsonlPartsBuilder() : createJsonPartsBuilder("jsonl");
      const baseline = await addRecordsToBuilder(builder, await access.resolveRecords(records));

      const { result, resolveRecords } = renderExport({
        visibleRecords: records,
        sourceAccess: access,
        format: "jsonl",
      });
      await act(async () => {
        if (format === "jsonl") {
          result.current.onExportJsonl();
        } else {
          result.current.onExportFormattedJson();
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(downloadedText()).toBe(baseline.join(""));
      // The whole point: the export never asks for every Full Record at once.
      expect(resolveRecords).not.toHaveBeenCalled();
    },
  );

  it("keeps CRLF lines and source order for a filtered subset", async () => {
    const contents = `${fixtureLines.join("\r\n")}\r\n`;
    const { file } = createStreamFile(contents, "crlf.jsonl");
    const access = createLocalFileAccess(file);
    const filtered = [previewRecords(fixtureLines)[0]!, previewRecords(fixtureLines)[2]!];

    const { result } = renderExport({ visibleRecords: filtered, sourceAccess: access });
    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
      await Promise.resolve();
    });

    const [first, third] = downloadedText().split("\n");
    expect(JSON.parse(first!)).toEqual({ id: 1, nested: { deep: true } });
    expect(JSON.parse(third!)).toEqual({ id: 3, text: "unicode ✓" });
  });

  it("exports a single record as a JSON value", async () => {
    const contents = fixtureLines.join("\n");
    const { file } = createStreamFile(contents, "fixture.jsonl");
    const access = createLocalFileAccess(file);

    const { result } = renderExport({
      visibleRecords: [previewRecords(fixtureLines)[0]!],
      sourceAccess: access,
      format: "json",
    });
    await act(async () => {
      result.current.onExportFormattedJson();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(downloadedText())).toEqual({ id: 1, nested: { deep: true } });
  });

  it("keeps a failed line's diagnostics in the export", async () => {
    const contents = fixtureLines.join("\n");
    const { file } = createStreamFile(contents, "fixture.jsonl");
    const access = createLocalFileAccess(file);

    const { result } = renderExport({
      visibleRecords: [previewRecords(fixtureLines)[1]!],
      sourceAccess: access,
    });
    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(downloadedText())).toMatchObject({
      lineNumber: 2,
      rawLine: "not json at all",
    });
  });

  it("aborts an export whose source was replaced mid-read", async () => {
    const stream = createControlledStreamFile(fixtureLines.join("\n"), "slow.jsonl");
    const access = createLocalFileAccess(stream.file);
    const { result, rerender } = renderExport({
      visibleRecords: previewRecords(fixtureLines),
      sourceAccess: access,
    });

    let settled: unknown;
    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
    });
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    pending?.catch((error: unknown) => (settled = error));

    // The reader is still waiting on its first chunk; aborting cancels it, so
    // the export never sees the rest of the file.
    rerender({ sourceRevision: 1 });
    await act(async () => {
      for (let tick = 0; tick < 5; tick += 1) {
        await Promise.resolve();
      }
    });
    expect(stream.file.name).toBe("slow.jsonl");

    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect((settled as Error | undefined)?.name).toBe("AbortError");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("aborts an in-memory export whose source changes after a builder yield", async () => {
    vi.useFakeTimers();
    const lines = Array.from({ length: 401 }, (_, index) => `{"id":${index + 1}}`);
    const { result, rerender } = renderExport({
      visibleRecords: fullRecords(lines),
      sourceAccess: null,
    });

    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
      await Promise.resolve();
    });
    let settled: unknown;
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    pending?.catch((error: unknown) => (settled = error));

    rerender({ sourceRevision: 1 });
    await act(async () => vi.runAllTimersAsync());

    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect((settled as Error | undefined)?.name).toBe("AbortError");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("aborts a local export whose source changes during a streamed builder yield", async () => {
    vi.useFakeTimers();
    const lines = Array.from({ length: 401 }, (_, index) => `{"id":${index + 1}}`);
    const records = fullRecords(lines);
    const sourceAccess: LocalFileExportAccess = {
      readRecordText: vi.fn(),
      streamRecords: vi.fn(
        async (
          _lineNumbers: ReadonlySet<number>,
          onRecord: (record: JsonlRecord) => void | Promise<void>,
        ) => {
          for (const record of records) {
            await onRecord(record);
          }
        },
      ),
    };
    const { result, rerender } = renderExport({ visibleRecords: records, sourceAccess });

    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
      await Promise.resolve();
    });
    let settled: unknown;
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    pending?.catch((error: unknown) => (settled = error));

    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    rerender({ sourceRevision: 1 });
    await act(async () => vi.runAllTimersAsync());

    expect((settled as Error | undefined)?.name).toBe("AbortError");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("does not build resolved records after their source revision changes", async () => {
    const records = fullRecords(['{"id":1}']);
    const resolvedRecord = { ...records[0]! };
    let serialized = false;
    Object.defineProperty(resolvedRecord, "status", {
      get: () => {
        serialized = true;
        return records[0]!.status;
      },
    });
    let settleResolution!: (records: JsonlRecord[]) => void;
    const controlledResolve = vi.fn(
      () =>
        new Promise<JsonlRecord[]>((resolve) => {
          settleResolution = resolve;
        }),
    );
    const { result, rerender } = renderExport({
      visibleRecords: records,
      sourceAccess: null,
      resolveRecords: controlledResolve,
    });

    result.current.onExportJsonl();
    let settled: unknown;
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    pending?.catch((error: unknown) => (settled = error));
    rerender({ sourceRevision: 1 });
    await act(async () => {
      settleResolution([resolvedRecord]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(serialized).toBe(false);
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect((settled as Error | undefined)?.name).toBe("AbortError");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("aborts an in-memory export when its owner unmounts", async () => {
    vi.useFakeTimers();
    const lines = Array.from({ length: 401 }, (_, index) => `{"id":${index + 1}}`);
    const { result, unmount } = renderExport({
      visibleRecords: fullRecords(lines),
      sourceAccess: null,
    });

    await act(async () => {
      result.current.onExportJsonl();
      await Promise.resolve();
      await Promise.resolve();
    });
    let settled: unknown;
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    pending?.catch((error: unknown) => (settled = error));

    unmount();
    await act(async () => vi.runAllTimersAsync());

    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect((settled as Error | undefined)?.name).toBe("AbortError");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("reports a genuine in-memory export failure", async () => {
    const { result } = renderExport({
      visibleRecords: fullRecords(['{"id":1}']),
      sourceAccess: null,
      resolveRecords: vi.fn().mockRejectedValue(new Error("read failed")),
    });

    result.current.onExportJsonl();
    const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
    await act(async () => {
      await pending?.catch(() => undefined);
    });

    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Export failed");
  });

  it("scales to a large record count without resolving every record", async () => {
    const lineCount = 20_000;
    const lines = Array.from({ length: lineCount }, (_, index) => `{"id":${index + 1}}`);
    const { file } = createStreamFile(lines.join("\n"), "large.jsonl");
    const access = createLocalFileAccess(file);
    let liveRecords = 0;
    let peakLiveRecords = 0;
    const observed: LocalFileAccess = {
      ...access,
      streamRecords: (lineNumbers, onRecord, signal) =>
        access.streamRecords(
          lineNumbers,
          async (record) => {
            liveRecords += 1;
            peakLiveRecords = Math.max(peakLiveRecords, liveRecords);
            try {
              await onRecord(record);
            } finally {
              liveRecords -= 1;
            }
          },
          signal,
        ),
    };

    const { result, resolveRecords } = renderExport({
      visibleRecords: previewRecords(lines),
      sourceAccess: observed,
    });
    await act(async () => {
      result.current.onExportJsonl();
      const pending = toastMocks.promise.mock.calls.at(-1)?.[0] as Promise<unknown> | undefined;
      await pending;
    });

    expect(downloadedText().split("\n")).toHaveLength(lineCount);
    expect(resolveRecords).not.toHaveBeenCalled();
    expect(peakLiveRecords).toBe(1);
  });
});

it("does not download an oversized export and explains the size limit", async () => {
  const { result } = renderExport({
    visibleRecords: fullRecords(['{"id":1}']),
    sourceAccess: {
      readRecordText: vi.fn(),
      streamRecords: vi.fn().mockRejectedValue(new ExportSizeLimitError()),
    },
  });
  result.current.onExportJsonl();
  await act(async () => {
    await toastMocks.promise.mock.calls.at(-1)![0].catch(() => undefined);
  });
  expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
  expect(toastMocks.error).toHaveBeenCalledWith(
    "Export exceeds 64 MiB. Filter fewer records and try again.",
  );
});
