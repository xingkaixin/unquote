import { toast } from "sonner";
import type { JsonlRecord } from "@unquote/core";
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

  const onCopyJsonl = async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    const records = await getFullRecords(visibleRecords);
    await navigator.clipboard.writeText(formatRecordsAsJsonl(records));
  };

  const onCopyFormattedJson = async () => {
    if (isCopyBlocked) {
      toast.warning(t("toolbar.copyBlocked"));
      return;
    }
    const records = await getFullRecords(visibleRecords);
    await navigator.clipboard.writeText(formatRecordsAsJson(records, format));
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
    const [copyRecord = record] = await getFullRecords([record]);
    const value = getCopyValue(copyRecord);
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
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

    await navigator.clipboard.writeText(details);
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
