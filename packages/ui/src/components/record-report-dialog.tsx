import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { PublishedSourceRevision } from "../lib/published-source";
import { buildRecordReport } from "../lib/record-report";
import type { RecordReport } from "../lib/record-report";
import { downloadBlob } from "../lib/record-export";
import { Button } from "./button";

interface RecordReportDialogProps {
  source: PublishedSourceRevision;
  records: JsonlRecord[];
  activeLine: number;
  onClose: () => void;
}
const fieldClass =
  "w-full rounded-md border border-border-medium bg-surface-50 p-2 font-mono text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent";

export const RecordReportDialog = ({
  source,
  records,
  activeLine,
  onClose,
}: RecordReportDialogProps) => {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(String(activeLine));
  const [redactions, setRedactions] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<RecordReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const invalidate = () => {
    operation.current?.abort();
    setBusy(false);
    setResult(null);
    setError("");
    setPage(0);
  };
  const build = async () => {
    invalidate();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const report = await buildRecordReport(
        source,
        records,
        selection,
        redactions,
        notes,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setResult(report);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(t(cause instanceof RangeError ? "report.limit" : "report.failed"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="uq-dialog-backdrop fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <Dialog.Popup className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-xl border border-border-medium bg-surface-100 text-text-primary shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between border-b border-border p-4">
              <Dialog.Title className="text-sm font-semibold">{t("report.title")}</Dialog.Title>
              <Dialog.Close
                render={
                  <Button variant="outline" size="sm">
                    {t("import.back")}
                  </Button>
                }
              />
            </div>
            <div className="space-y-4 overflow-y-auto p-4">
              <Dialog.Description className="text-xs text-text-secondary">
                {t("report.description")}
              </Dialog.Description>
              <label htmlFor="report-lines" className="block text-xs">
                {t("report.lines")}
              </label>
              <input
                id="report-lines"
                className={fieldClass}
                value={selection}
                placeholder="1, 3-5"
                onChange={(event) => {
                  invalidate();
                  setSelection(event.target.value);
                }}
              />
              <label htmlFor="report-redact" className="block text-xs">
                {t("report.paths")}
              </label>
              <textarea
                id="report-redact"
                className={`${fieldClass} h-20`}
                placeholder="$.headers.authorization"
                value={redactions}
                onChange={(event) => {
                  invalidate();
                  setRedactions(event.target.value);
                }}
              />
              <p className="text-xs text-text-secondary">{t("report.redactionHint")}</p>
              <label htmlFor="report-notes" className="block text-xs">
                {t("report.notes")}
              </label>
              <textarea
                id="report-notes"
                className={`${fieldClass} h-20`}
                value={notes}
                onChange={(event) => {
                  invalidate();
                  setNotes(event.target.value);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !selection.trim()} onClick={() => void build()}>
                  {t(busy ? "report.building" : "report.preview")}
                </Button>
                {busy ? (
                  <Button variant="outline" size="sm" onClick={invalidate}>
                    {t("report.cancel")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!result}
                  onClick={() => {
                    if (result)
                      downloadBlob(
                        [result.markdown],
                        "unquote-report.md",
                        "text/markdown;charset=utf-8",
                      );
                  }}
                >
                  {t("report.markdown")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!result}
                  onClick={() => {
                    if (result)
                      downloadBlob([result.jsonl], "unquote-report.jsonl", "application/x-ndjson");
                  }}
                >
                  {t("report.jsonl")}
                </Button>
              </div>
              {error ? (
                <p role="alert" className="text-xs text-error">
                  {error}
                </p>
              ) : null}
              {result ? (
                <section className="space-y-3">
                  <p role="status" className="text-xs">
                    {t("report.summary", {
                      count: result.lineNumbers.length,
                      redacted: result.redacted,
                    })}
                  </p>
                  <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-border p-3 font-mono text-xs">
                    {result.markdown.slice(page * 10_000, (page + 1) * 10_000)}
                  </pre>
                  {result.markdown.length > 10_000 ? (
                    <div className="flex items-center gap-3 text-xs">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        {t("report.previous")}
                      </Button>
                      <span>
                        {page + 1} / {Math.ceil(result.markdown.length / 10_000)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(page + 1) * 10_000 >= result.markdown.length}
                        onClick={() => setPage(page + 1)}
                      >
                        {t("report.next")}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
