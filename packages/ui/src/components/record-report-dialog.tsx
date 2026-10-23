import { useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { PublishedSourceRevision } from "../lib/published-source";
import { buildRecordReport } from "../lib/record-report";
import { downloadBlob } from "../lib/record-export";
import { Button } from "./button";
import { ReportDialog, reportFieldClass } from "./report-dialog";

interface RecordReportDialogProps {
  source: PublishedSourceRevision;
  records: JsonlRecord[];
  activeLine: number;
  onClose: () => void;
}

export const RecordReportDialog = ({
  source,
  records,
  activeLine,
  onClose,
}: RecordReportDialogProps) => {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(String(activeLine));
  return (
    <ReportDialog
      title={t("report.title")}
      description={t("report.description")}
      markdownFileName="unquote-report.md"
      failedMessage="report.failed"
      canBuild={Boolean(selection.trim())}
      selection={(invalidate) => (
        <>
          <label htmlFor="report-lines" className="block text-xs">
            {t("report.lines")}
          </label>
          <input
            id="report-lines"
            className={reportFieldClass}
            value={selection}
            placeholder="1, 3-5"
            onChange={(event) => {
              invalidate();
              setSelection(event.target.value);
            }}
          />
        </>
      )}
      build={(redactions, notes, signal) =>
        buildRecordReport(source, records, selection, redactions, notes, signal)
      }
      extraDownloads={(report) => (
        <Button
          variant="outline"
          size="sm"
          disabled={!report}
          onClick={() => {
            if (report)
              downloadBlob([report.jsonl], "unquote-report.jsonl", "application/x-ndjson");
          }}
        >
          {t("report.jsonl")}
        </Button>
      )}
      onClose={onClose}
    />
  );
};
