import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { useCallback, useMemo } from "react";
import { useTranslation } from "../i18n/context";
import {
  createExportFilename,
  downloadBlob,
  formatRecordsAsJson,
  formatRecordsAsJsonParts,
  formatRecordsAsJsonl,
  formatRecordsAsJsonlParts,
  getCopyValue,
  yieldToMain,
} from "../lib/record-export";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

interface UseExportActionsParams {
  visibleRecords: JsonlRecord[];
  resolveRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
  format: "json" | "jsonl";
  isCopyBlocked: boolean;
}

export const useExportActions = ({
  visibleRecords,
  resolveRecords,
  format,
  isCopyBlocked,
}: UseExportActionsParams) => {
  const { t } = useTranslation();
  const copyText = useCopyToClipboard();

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
    const records = await resolveCopyRecords(visibleRecords);
    if (!records) {
      return;
    }
    await copyText(formatRecordsAsJsonl(records));
  }, [copyText, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onCopyFormattedJson = useCallback(async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    const records = await resolveCopyRecords(visibleRecords);
    if (!records) {
      return;
    }
    await copyText(formatRecordsAsJson(records, format));
  }, [copyText, format, isCopyBlocked, resolveCopyRecords, t, visibleRecords]);

  const onExportJsonl = useCallback(() => {
    toast.promise(
      (async () => {
        const records = await resolveRecords(visibleRecords);
        await yieldToMain();
        const parts = await formatRecordsAsJsonlParts(records);
        downloadBlob(parts, createExportFilename("jsonl"), "application/jsonl;charset=utf-8");
      })(),
      {
        loading: t("toolbar.exporting"),
        success: t("toolbar.exportDone"),
        error: t("toolbar.exportFailed"),
      },
    );
  }, [resolveRecords, t, visibleRecords]);

  const onExportFormattedJson = useCallback(() => {
    toast.promise(
      (async () => {
        const records = await resolveRecords(visibleRecords);
        await yieldToMain();
        const parts = await formatRecordsAsJsonParts(records, format);
        downloadBlob(parts, createExportFilename("json"), "application/json;charset=utf-8");
      })(),
      {
        loading: t("toolbar.exporting"),
        success: t("toolbar.exportDone"),
        error: t("toolbar.exportFailed"),
      },
    );
  }, [format, resolveRecords, t, visibleRecords]);

  const onCopyRecord = useCallback(
    async (record: JsonlRecord) => {
      const records = await resolveCopyRecords([record]);
      if (!records) {
        return;
      }
      const [copyRecord = record] = records;
      const value = getCopyValue(copyRecord);
      await copyText(JSON.stringify(value, null, 2));
    },
    [copyText, resolveCopyRecords],
  );

  const onCopyRecordError = useCallback(
    async (record: JsonlRecord) => {
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

      await copyText(details);
    },
    [copyText, t],
  );

  return useMemo(
    () => ({
      onCopyJsonl,
      onCopyFormattedJson,
      onExportJsonl,
      onExportFormattedJson,
      onCopyRecord,
      onCopyRecordError,
    }),
    [
      onCopyFormattedJson,
      onCopyJsonl,
      onCopyRecord,
      onCopyRecordError,
      onExportFormattedJson,
      onExportJsonl,
    ],
  );
};
