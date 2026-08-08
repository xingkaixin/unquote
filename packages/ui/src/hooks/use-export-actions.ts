import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { LocalFileAccess } from "../lib/local-file-source";
import {
  addRecordsToBuilder,
  createExportFilename,
  createJsonPartsBuilder,
  createJsonlPartsBuilder,
  downloadBlob,
  formatRecord,
  formatRecordsAsJson,
  formatRecordsAsJsonl,
} from "../lib/record-export";
import type { ExportPartsBuilder } from "../lib/record-export";
import type { SourceRevision } from "../lib/source-revision";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

interface UseExportActionsParams {
  visibleRecords: JsonlRecord[];
  resolveRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
  sourceAccess: LocalFileAccess | null;
  format: "json" | "jsonl";
  isCopyBlocked: boolean;
  sourceRevision: SourceRevision;
}

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
  // export that is still reading the previous file.
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
    async (builder: ExportPartsBuilder) => {
      if (!sourceAccess) {
        return addRecordsToBuilder(builder, await resolveRecords(visibleRecords));
      }

      const { signal } = exportScopeRef.current;
      const bodies = new Map<number, string>();
      await sourceAccess.streamRecords(
        new Set(visibleRecords.map((record) => record.lineNumber)),
        (record) => bodies.set(record.lineNumber, builder.bodyFor(record)),
        signal,
      );
      if (signal.aborted) {
        throw new DOMException("Export superseded by a new source", "AbortError");
      }

      for (const record of visibleRecords) {
        builder.addBody(bodies.get(record.lineNumber) ?? builder.bodyFor(record));
      }
      return builder.finish();
    },
    [resolveRecords, sourceAccess, visibleRecords],
  );

  // Copy actions are invoked fire-and-forget from onClick, so a rejected file
  // read would become an unhandled rejection — surface it here instead.
  const resolveCopyRecords = useCallback(
    async (records: JsonlRecord[]) => {
      try {
        return await resolveRecords(records);
      } catch {
        toast.error(t("input.readFailed"));
        return null;
      }
    },
    [resolveRecords, t],
  );

  const onCopyJsonl = useCallback(async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    await copyText(async () => {
      const records = await resolveCopyRecords(visibleRecords);
      return records && formatRecordsAsJsonl(records);
    });
  }, [copyText, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onCopyFormattedJson = useCallback(async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    await copyText(async () => {
      const records = await resolveCopyRecords(visibleRecords);
      return records && formatRecordsAsJson(records, format);
    });
  }, [copyText, format, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onExportJsonl = useCallback(() => {
    toast.promise(
      (async () => {
        const parts = await buildExportParts(createJsonlPartsBuilder());
        downloadBlob(parts, createExportFilename("jsonl"), "application/jsonl;charset=utf-8");
      })(),
      {
        loading: t("toolbar.exporting"),
        success: t("toolbar.exportDone"),
        error: t("toolbar.exportFailed"),
      },
    );
  }, [buildExportParts, t]);

  const onExportFormattedJson = useCallback(() => {
    toast.promise(
      (async () => {
        const parts = await buildExportParts(createJsonPartsBuilder(format));
        downloadBlob(parts, createExportFilename("json"), "application/json;charset=utf-8");
      })(),
      {
        loading: t("toolbar.exporting"),
        success: t("toolbar.exportDone"),
        error: t("toolbar.exportFailed"),
      },
    );
  }, [buildExportParts, format, t]);

  const onCopyRecord = useCallback(
    (record: JsonlRecord) =>
      copyText(async () => {
        const records = await resolveCopyRecords([record]);
        if (!records) {
          return null;
        }
        const [copyRecord = record] = records;
        return formatRecord(copyRecord, 2);
      }),
    [copyText, resolveCopyRecords],
  );

  const onCopyRawLine = useCallback(
    (record: JsonlRecord) =>
      copyText(async () => {
        if (!sourceAccess) {
          return record.status === "failed" ? record.rawLine : record.summary;
        }
        try {
          return await sourceAccess.readRecordText(record);
        } catch {
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
