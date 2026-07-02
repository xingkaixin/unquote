import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import { writeClipboardText } from "../lib/clipboard";
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

interface UseExportActionsParams {
  visibleRecords: JsonlRecord[];
  getFullRecords: (records: JsonlRecord[]) => Promise<JsonlRecord[]>;
  format: "json" | "jsonl";
  isCopyBlocked: boolean;
}

export const useExportActions = ({
  visibleRecords,
  getFullRecords,
  format,
  isCopyBlocked,
}: UseExportActionsParams) => {
  const { t } = useTranslation();

  const copyText = async (text: string) => {
    if (!(await writeClipboardText(text))) {
      toast.error(t("copy.failed"));
    }
  };

  // Copy actions are invoked fire-and-forget from onClick, so a rejected file
  // read would become an unhandled rejection — surface it here instead.
  const resolveCopyRecords = async (records: JsonlRecord[]) => {
    try {
      return await getFullRecords(records);
    } catch {
      toast.error(t("input.readFailed"));
      return null;
    }
  };

  const onCopyJsonl = async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    const records = await resolveCopyRecords(visibleRecords);
    if (!records) {
      return;
    }
    await copyText(formatRecordsAsJsonl(records));
  };

  const onCopyFormattedJson = async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    const records = await resolveCopyRecords(visibleRecords);
    if (!records) {
      return;
    }
    await copyText(formatRecordsAsJson(records, format));
  };

  const onExportJsonl = () => {
    toast.promise(
      (async () => {
        const records = await getFullRecords(visibleRecords);
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
  };

  const onExportFormattedJson = () => {
    toast.promise(
      (async () => {
        const records = await getFullRecords(visibleRecords);
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
  };

  const onCopyRecord = async (record: JsonlRecord) => {
    const records = await resolveCopyRecords([record]);
    if (!records) {
      return;
    }
    const [copyRecord = record] = records;
    const value = getCopyValue(copyRecord);
    await copyText(JSON.stringify(value, null, 2));
  };

  const onCopyRecordError = async (record: JsonlRecord) => {
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
  };

  return {
    onCopyJsonl,
    onCopyFormattedJson,
    onExportJsonl,
    onExportFormattedJson,
    onCopyRecord,
    onCopyRecordError,
  };
};
