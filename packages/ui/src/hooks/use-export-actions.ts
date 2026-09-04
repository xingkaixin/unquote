import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import { reportDiagnostic } from "../lib/diagnostics";
import { SourceReadLimitError } from "../lib/local-file-reader";
import type { LocalFileAccess } from "../lib/local-file-source";
import {
  addRecordsToBuilder,
  createExportFilename,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
  downloadBlob,
  exportChunkSize,
  copyBytesLimit,
  formatResolvedRecordsForCopy,
  yieldToMain,
} from "../lib/record-export";
import type { ExportPartsBuilder } from "../lib/record-export";
import type { SourceRevision } from "../lib/source-revision";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

export type LocalFileExportAccess = Pick<LocalFileAccess, "readRecordText" | "streamRecords">;

interface UseExportActionsParams {
  visibleRecords: JsonlRecord[];
  resolveRecords: (
    records: JsonlRecord[],
    signal?: AbortSignal,
    maxBytes?: number,
  ) => Promise<JsonlRecord[]>;
  sourceAccess: LocalFileExportAccess | null;
  format: "json" | "jsonl";
  isCopyBlocked: boolean;
  sourceRevision: SourceRevision;
}

const isAbortError = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";

export const useExportActions = ({
  visibleRecords,
  resolveRecords,
  sourceAccess,
  format,
  isCopyBlocked,
  sourceRevision,
}: UseExportActionsParams) => {
  const { t } = useTranslation();
  const copyText = useCopyToClipboard(sourceRevision);
  // One scope per Source Revision: replacing the source or unmounting stops an
  // export that is still resolving, serializing, or reading the previous source.
  const exportScopeRef = useRef<AbortController>(new AbortController());

  useEffect(() => {
    const scope = new AbortController();
    exportScopeRef.current = scope;
    return () => scope.abort();
  }, [sourceRevision]);

  /**
   * Builds the export payload without ever holding every Full Record at once.
   * With a local file the records are parsed in file order and serialized one
   * by one, so only the resulting text survives each step; the record order of
   * the output still follows `visibleRecords`.
   */
  const buildExportParts = useCallback(
    async (builder: ExportPartsBuilder, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!sourceAccess) {
        const records = await resolveRecords(visibleRecords, signal);
        signal.throwIfAborted();
        return addRecordsToBuilder(builder, records, signal);
      }

      let exportedCount = 0;
      await sourceAccess.streamRecords(
        new Set(visibleRecords.map((record) => record.lineNumber)),
        async (record) => {
          signal.throwIfAborted();
          const expectedRecord = visibleRecords[exportedCount];
          if (record.lineNumber !== expectedRecord?.lineNumber) {
            throw new TypeError(
              `Expected record line ${expectedRecord?.lineNumber ?? "none"}, received ${record.lineNumber}`,
            );
          }

          builder.addBody(builder.bodyFor(record));
          exportedCount += 1;
          if (exportedCount % exportChunkSize === 0) {
            await yieldToMain();
            signal.throwIfAborted();
          }
        },
        signal,
      );
      signal.throwIfAborted();
      const missingRecord = visibleRecords[exportedCount];
      if (missingRecord) {
        throw new TypeError(`Record line ${missingRecord.lineNumber} was not found`);
      }
      return builder.finish();
    },
    [resolveRecords, sourceAccess, visibleRecords],
  );

  const exportWithBuilder = useCallback(
    (builder: ExportPartsBuilder, extension: "json" | "jsonl", type: string) => {
      const { signal } = exportScopeRef.current;
      const operation = (async () => {
        const parts = await buildExportParts(builder, signal);
        signal.throwIfAborted();
        downloadBlob(parts, createExportFilename(extension), type);
      })();
      void operation.catch((error: unknown) => {
        if (!isAbortError(error)) {
          reportDiagnostic("export.build", error);
          toast.error(t("toolbar.exportFailed"));
        }
      });
      toast.promise(operation, {
        loading: t("toolbar.exporting"),
        success: t("toolbar.exportDone"),
      });
    },
    [buildExportParts, t],
  );

  const copyRecords = useCallback(
    (records: JsonlRecord[], outputFormat: "json" | "jsonl" | "array") =>
      copyText(async (signal) => {
        try {
          const text = await formatResolvedRecordsForCopy(
            records,
            outputFormat,
            async (record) => {
              const resolved = await resolveRecords([record], signal, copyBytesLimit);
              return resolved[0] ?? record;
            },
            signal,
          );
          if (text === null) {
            toast.warning(t("toolbar.copyBlocked"));
          }
          return text;
        } catch (error) {
          if (signal.aborted || isAbortError(error)) {
            return null;
          }
          if (error instanceof SourceReadLimitError) {
            toast.warning(t("toolbar.copyBlocked"));
            return null;
          }
          reportDiagnostic("copy.resolve-records", error);
          toast.error(t(error instanceof TypeError ? "copy.failed" : "input.readFailed"));
          return null;
        }
      }),
    [copyText, resolveRecords, t],
  );

  const onCopyJsonl = useCallback(() => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    return copyRecords(visibleRecords, "jsonl");
  }, [copyRecords, isCopyBlocked, t, visibleRecords]);
  const onCopyFormattedJson = useCallback(() => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    return copyRecords(visibleRecords, format === "json" ? "json" : "array");
  }, [copyRecords, format, isCopyBlocked, t, visibleRecords]);

  const onExportJsonl = useCallback(() => {
    exportWithBuilder(createJsonlPartsBuilder(), "jsonl", "application/jsonl;charset=utf-8");
  }, [exportWithBuilder]);

  const onExportFormattedJson = useCallback(() => {
    exportWithBuilder(createJsonPartsBuilder(format), "json", "application/json;charset=utf-8");
  }, [exportWithBuilder, format]);

  const onCopyRecord = useCallback(
    (record: JsonlRecord) => copyRecords([record], "json"),
    [copyRecords],
  );

  const onCopyRawLine = useCallback(
    (record: JsonlRecord) =>
      copyText(async (signal) => {
        if (!sourceAccess) {
          return record.status === "failed" ? record.rawLine : record.summary;
        }
        try {
          return await sourceAccess.readRecordText(record, signal);
        } catch (error) {
          if (signal.aborted || isAbortError(error)) {
            return null;
          }
          reportDiagnostic("copy.read-record", error);
          toast.error(t("input.readFailed"));
          return null;
        }
      }),
    [copyText, sourceAccess, t],
  );

  const onCopyRecordError = useCallback(
    (record: JsonlRecord) => {
      const message = record.error ?? t("error.parseFailed");
      const errorMeta = record.errorMeta;
      const details = errorMeta
        ? [
            t("error.message", { message }),
            t("error.location", { line: errorMeta.line, column: errorMeta.column }),
            `${t("error.rawLine")}:\n${errorMeta.rawLine}`,
            `${t("error.context")}:\n${errorMeta.context}`,
          ].join("\n")
        : t("error.message", { message });

      return copyText(() => details);
    },
    [copyText, t],
  );

  return useMemo(
    () => ({
      copyText,
      onCopyJsonl,
      onCopyFormattedJson,
      onExportJsonl,
      onExportFormattedJson,
      onCopyRecord,
      onCopyRawLine,
      onCopyRecordError,
    }),
    [
      copyText,
      onCopyFormattedJson,
      onCopyJsonl,
      onCopyRawLine,
      onCopyRecord,
      onCopyRecordError,
      onExportFormattedJson,
      onExportJsonl,
    ],
  );
};
