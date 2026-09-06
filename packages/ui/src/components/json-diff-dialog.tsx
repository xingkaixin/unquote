import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { PublishedSourceRevision } from "../lib/published-source";
import {
  compareJsonNodes,
  diffInputBytes,
  formatDiffInput,
  parseIgnoredPaths,
} from "../lib/json-diff";
import type { JsonDifference } from "../lib/json-diff";
import { createRecordParser } from "../lib/record-parser";
import { reportDiagnostic } from "../lib/diagnostics";
import { Button } from "./button";

interface JsonDiffDialogProps {
  source: PublishedSourceRevision;
  records: JsonlRecord[];
  activeRecord: JsonlRecord | null;
  onClose: () => void;
}

const fieldClass =
  "w-full rounded-md border border-border-medium bg-surface-50 p-2 font-mono text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent";

export const JsonDiffDialog = ({ source, records, activeRecord, onClose }: JsonDiffDialogProps) => {
  const { t } = useTranslation();
  const [inputs, setInputs] = useState(["", ""]);
  const [lines, setLines] = useState([
    activeRecord?.lineNumber ?? 1,
    activeRecord?.lineNumber ?? 1,
  ]);
  const [ignored, setIgnored] = useState("");
  const [changes, setChanges] = useState<JsonDifference[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const parser = useRef<ReturnType<typeof createRecordParser> | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      parser.current?.dispose();
      parser.current = null;
    },
    [],
  );

  const invalidate = () => {
    operation.current?.abort();
    setBusy(false);
    setChanges(null);
    setError("");
    setPage(0);
  };
  const updateInput = (index: number, value: string) => {
    invalidate();
    setInputs((current) => current.map((input, i) => (i === index ? value : input)));
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    invalidate();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      await work(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) reportDiagnostic("diff.compare", cause);
      if (!controller.signal.aborted)
        setError(t(cause instanceof RangeError ? "diff.limit" : "diff.failed"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const loadFile = (index: number, file: File) =>
    run(async (signal) => {
      if (file.size > diffInputBytes) throw new RangeError("diff-limit");
      const text = await file.text();
      signal.throwIfAborted();
      setInputs((current) => current.map((input, i) => (i === index ? text : input)));
    });
  const loadRecord = (index: number) =>
    run(async (signal) => {
      const record = records.find((item) => item.lineNumber === lines[index]);
      if (!record) throw new Error("missing-record");
      const full =
        record.status === "preview" && source.kind === "local-file"
          ? (await source.access.resolveRecords([record], signal, diffInputBytes))[0]
          : record;
      signal.throwIfAborted();
      if (!full || full.status !== "full") throw new Error("invalid-record");
      const text = formatDiffInput(full.node);
      setInputs((current) => current.map((input, i) => (i === index ? text : input)));
    });
  const compare = () =>
    run(async (signal) => {
      if (inputs.some((text) => new TextEncoder().encode(text).byteLength > diffInputBytes))
        throw new RangeError("diff-limit");
      const paths = parseIgnoredPaths(ignored);
      parser.current ??= createRecordParser();
      const parsed = await parser.current.parse(
        new Map(inputs.map((text, index) => [index + 1, text])),
        signal,
      );
      const before = parsed.get(1);
      const after = parsed.get(2);
      if (before?.status !== "full" || after?.status !== "full") throw new Error("invalid-json");
      const result = await compareJsonNodes(before.node, after.node, paths, signal);
      signal.throwIfAborted();
      setChanges(result);
    });

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
          <Dialog.Popup className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-border-medium bg-surface-100 text-text-primary shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <Dialog.Title className="text-sm font-semibold">{t("diff.title")}</Dialog.Title>
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
                {t("diff.description")}
              </Dialog.Description>
              <div className="grid gap-4 md:grid-cols-2">
                {inputs.map((input, index) => (
                  <fieldset key={index} className="min-w-0 space-y-2">
                    <legend className="mb-2 text-xs font-semibold">
                      {t(index === 0 ? "diff.before" : "diff.after")}
                    </legend>
                    <label htmlFor={`diff-input-${index}`} className="sr-only">
                      {t(index === 0 ? "diff.before" : "diff.after")}
                    </label>
                    <textarea
                      id={`diff-input-${index}`}
                      className={`${fieldClass} h-40`}
                      value={input}
                      spellCheck={false}
                      onChange={(event) => updateInput(index, event.target.value)}
                    />
                    <label htmlFor={`diff-file-${index}`} className="block text-xs">
                      {t("diff.file")}
                    </label>
                    <input
                      id={`diff-file-${index}`}
                      type="file"
                      accept=".json,application/json"
                      className="w-full text-xs"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void loadFile(index, file);
                        event.target.value = "";
                      }}
                    />
                    <div className="flex items-end gap-2">
                      <label className="min-w-0 flex-1 text-xs" htmlFor={`diff-line-${index}`}>
                        {t("diff.line")}
                        <input
                          id={`diff-line-${index}`}
                          className={fieldClass}
                          type="number"
                          min={1}
                          step={1}
                          value={lines[index]}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((line, i) =>
                                i === index ? Number(event.target.value) : line,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !records.length}
                        onClick={() => void loadRecord(index)}
                      >
                        {t("diff.loadRecord")}
                      </Button>
                    </div>
                  </fieldset>
                ))}
              </div>
              <label htmlFor="diff-ignore" className="block text-xs">
                {t("diff.ignore")}
              </label>
              <textarea
                id="diff-ignore"
                className={`${fieldClass} h-16`}
                placeholder="$.timestamp"
                value={ignored}
                onChange={(event) => {
                  invalidate();
                  setIgnored(event.target.value);
                }}
              />
              <Button
                size="sm"
                disabled={busy || inputs.some((input) => !input.trim())}
                onClick={() => void compare()}
              >
                {t(busy ? "diff.comparing" : "diff.compare")}
              </Button>
              {error ? (
                <p role="alert" className="text-xs text-error">
                  {error}
                </p>
              ) : null}
              {changes ? (
                <section className="space-y-3">
                  <p role="status" className="text-xs">
                    {changes.length ? t("diff.count", { count: changes.length }) : t("diff.equal")}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse text-left text-xs">
                      <caption className="sr-only">{t("diff.title")}</caption>
                      <thead>
                        <tr>
                          {["diff.path", "diff.before", "diff.after"].map((key) => (
                            <th scope="col" className="border-b border-border p-2" key={key}>
                              {t(key as "diff.path")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {changes.slice(page * 50, page * 50 + 50).map((change) => (
                          <tr key={change.path}>
                            <th
                              scope="row"
                              className="border-b border-border p-2 text-left align-top font-normal"
                            >
                              <code className="break-all">{change.path}</code>
                              <span className="mt-1 block text-accent">
                                {t(`diff.${change.kind}`)}
                              </span>
                            </th>
                            <td className="border-b border-border p-2 align-top">
                              <pre className="whitespace-pre-wrap break-all">{change.before}</pre>
                            </td>
                            <td className="border-b border-border p-2 align-top">
                              <pre className="whitespace-pre-wrap break-all">{change.after}</pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {changes.length > 50 ? (
                    <div className="flex items-center gap-3 text-xs">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        {t("diff.previous")}
                      </Button>
                      <span>
                        {page + 1} / {Math.ceil(changes.length / 50)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(page + 1) * 50 >= changes.length}
                        onClick={() => setPage(page + 1)}
                      >
                        {t("diff.next")}
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
