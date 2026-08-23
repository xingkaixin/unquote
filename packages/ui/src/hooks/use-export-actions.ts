import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import { reportDiagnostic } from "../lib/diagnostics";
import type { LocalFileAccess } from "../lib/local-file-source";
import {
  addRecordBodiesToBuilder,
  addRecordsToBuilder,
  createExportFilename,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
  downloadBlob,
  formatRecordsAsJsonForCopy,
  formatRecordsAsJsonlForCopy,
} from "../lib/record-export";
import type { ExportPartsBuilder } from "../lib/record-export";
import type { SourceRevision } from "../lib/source-revision";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

export type LocalFileExportAccess = Pick<LocalFileAccess, "readRecordText" | "streamRecords">;

interface UseExportActionsParams {
  visibleRecords: JsonlRecord[];
  resolveRecords: (records: JsonlRecord[], signal?: AbortSignal) => Promise<JsonlRecord[]>;
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

      const bodies = new Map<number, string>();
      await sourceAccess.streamRecords(
        new Set(visibleRecords.map((record) => record.lineNumber)),
        (record) => bodies.set(record.lineNumber, builder.bodyFor(record)),
        signal,
      );
      signal.throwIfAborted();

      return addRecordBodiesToBuilder(
        builder,
        visibleRecords,
        (record) => bodies.get(record.lineNumber) ?? builder.bodyFor(record),
        signal,
      );
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

  // Copy actions are invoked fire-and-forget from onClick, so a rejected file
  // read would become an unhandled rejection — surface it here instead.
  const resolveCopyRecords = useCallback(
    async (records: JsonlRecord[], signal: AbortSignal) => {
      try {
        return await resolveRecords(records, signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          return null;
        }
        reportDiagnostic("copy.resolve-records", error);
        toast.error(t("input.readFailed"));
        return null;
      }
    },
    [resolveRecords, t],
  );

  const acceptCopyPayload = useCallback(
    (text: string | null) => {
      if (text === null) {
        toast.warning(t("toolbar.copyBlocked"));
      }
      return text;
    },
    [t],
  );

  const onCopyJsonl = useCallback(async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    await copyText(async (signal) => {
      const records = await resolveCopyRecords(visibleRecords, signal);
      if (!records) {
        return null;
      }
      return acceptCopyPayload(formatRecordsAsJsonlForCopy(records));
    });
  }, [acceptCopyPayload, copyText, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onCopyFormattedJson = useCallback(async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    await copyText(async (signal) => {
      const records = await resolveCopyRecords(visibleRecords, signal);
      if (!records) {
        return null;
      }
      return acceptCopyPayload(formatRecordsAsJsonForCopy(records, format));
    });
  }, [acceptCopyPayload, copyText, format, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onExportJsonl = useCallback(() => {
    exportWithBuilder(createJsonlPartsBuilder(), "jsonl", "application/jsonl;charset=utf-8");
  }, [exportWithBuilder]);

  const onExportFormattedJson = useCallback(() => {
    exportWithBuilder(createJsonPartsBuilder(format), "json", "application/json;charset=utf-8");
  }, [exportWithBuilder, format]);

  const onCopyRecord = useCallback(
    (record: JsonlRecord) =>
      copyText(async (signal) => {
        const records = await resolveCopyRecords([record], signal);
        if (!records) {
          return null;
        }
        const [copyRecord = record] = records;
        return acceptCopyPayload(formatRecordsAsJsonForCopy([copyRecord], "json"));
      }),
    [acceptCopyPayload, copyText, resolveCopyRecords],
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
