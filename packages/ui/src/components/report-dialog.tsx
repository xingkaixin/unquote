import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import type { MessageKey } from "../i18n/i18n";
import { downloadBlob } from "../lib/record-export";
import { Button } from "./button";

export interface ReportPreview {
  markdown: string;
  lineNumbers: readonly number[];
  redacted: number;
}

interface ReportDialogProps<Report extends ReportPreview> {
  title: string;
  description: string;
  markdownFileName: string;
  failedMessage: MessageKey;
  canBuild: boolean;
  selection: (invalidate: () => void) => ReactNode;
  build: (redactions: string, notes: string, signal: AbortSignal) => Promise<Report>;
  extraDownloads?: (report: Report | null) => ReactNode;
  onClose: () => void;
}

export const reportFieldClass =
  "w-full rounded-md border border-border-medium bg-surface-50 p-2 font-mono text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent";

const previewPageSize = 10_000;

export const ReportDialog = <Report extends ReportPreview>({
  title,
  description,
  markdownFileName,
  failedMessage,
  canBuild,
  selection,
  build,
  extraDownloads,
  onClose,
}: ReportDialogProps<Report>) => {
  const { t } = useTranslation();
  const [redactions, setRedactions] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<Report | null>(null);
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
  const run = async () => {
    invalidate();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const report = await build(redactions, notes, controller.signal);
      controller.signal.throwIfAborted();
      setResult(report);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(t(cause instanceof RangeError ? "report.limit" : failedMessage));
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
          <Dialog.Popup className="flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border-medium bg-surface-100 text-text-primary shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between border-b border-border p-4">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
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
                {description}
              </Dialog.Description>
              {selection(invalidate)}
              <label htmlFor="report-redact" className="block text-xs">
                {t("report.paths")}
              </label>
              <textarea
                id="report-redact"
                className={`${reportFieldClass} h-20`}
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
                className={`${reportFieldClass} h-20`}
                value={notes}
                onChange={(event) => {
                  invalidate();
                  setNotes(event.target.value);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !canBuild} onClick={() => void run()}>
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
                        markdownFileName,
                        "text/markdown;charset=utf-8",
                      );
                  }}
                >
                  {t("report.markdown")}
                </Button>
                {extraDownloads?.(result)}
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
                    {result.markdown.slice(page * previewPageSize, (page + 1) * previewPageSize)}
                  </pre>
                  {result.markdown.length > previewPageSize ? (
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
                        {page + 1} / {Math.ceil(result.markdown.length / previewPageSize)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(page + 1) * previewPageSize >= result.markdown.length}
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
