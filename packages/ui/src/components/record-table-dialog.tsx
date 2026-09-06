import { FieldProfiles } from "./field-profiles";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { PublishedSourceRevision } from "../lib/published-source";
import { downloadBlob } from "../lib/record-export";
import { exportTableCsv, scanRecordTable } from "../lib/record-table";
import type { TableColumn, TableOperator, TableResult } from "../lib/record-table";
import { Button } from "./button";

interface RecordTableDialogProps {
  source: PublishedSourceRevision;
  records: JsonlRecord[];
  selectedPath: string | undefined;
  onOpenRecord: (id: string) => void;
  onClose: () => void;
}
const fieldClass =
  "min-w-0 rounded-md border border-border-medium bg-surface-50 p-2 font-mono text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent";
const operators: TableOperator[] = [
  "any",
  "equals",
  "contains",
  "greater",
  "less",
  "missing",
  "kind",
  "empty",
];

export const RecordTableDialog = ({
  source,
  records,
  selectedPath,
  onOpenRecord,
  onClose,
}: RecordTableDialogProps) => {
  const { t } = useTranslation();
  const [columns, setColumns] = useState<TableColumn[]>([
    { path: selectedPath ?? "$", operator: "any", value: "" },
  ]);
  const [result, setResult] = useState<TableResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
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
  const update = (index: number, patch: Partial<TableColumn>) => {
    invalidate();
    setColumns((current) =>
      current.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    );
  };
  const execute = async (work: (signal: AbortSignal) => Promise<void>) => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(t(cause instanceof RangeError ? "table.limit" : "table.failed"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const scan = (nextColumns = columns) => {
    setResult(null);
    setProgress(0);
    setPage(0);
    return execute(async (signal) => {
      const next = await scanRecordTable(source, records, nextColumns, signal, (count) => {
        if (!signal.aborted) setProgress(count);
      });
      signal.throwIfAborted();
      setResult(next);
    });
  };
  const exportCsv = () =>
    execute(async (signal) => {
      if (!result) return;
      const parts = await exportTableCsv(result, signal);
      signal.throwIfAborted();
      downloadBlob(parts, "unquote-table.csv", "text/csv;charset=utf-8");
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
            <div className="flex items-center justify-between border-b border-border p-4">
              <Dialog.Title className="text-sm font-semibold">{t("table.title")}</Dialog.Title>
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
                {t("table.description")}
              </Dialog.Description>
              <div className="space-y-2">
                {columns.map((column, index) => (
                  <fieldset key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <legend className="sr-only">{t("table.column", { count: index + 1 })}</legend>
                    <label htmlFor={`table-path-${index}`} className="grid gap-1 text-xs">
                      {t("table.path")}
                      <input
                        id={`table-path-${index}`}
                        className={fieldClass}
                        value={column.path}
                        onChange={(event) => update(index, { path: event.target.value })}
                      />
                    </label>
                    <label htmlFor={`table-op-${index}`} className="grid gap-1 text-xs">
                      {t("table.condition")}
                      <select
                        id={`table-op-${index}`}
                        className={fieldClass}
                        value={column.operator}
                        onChange={(event) =>
                          update(index, { operator: event.target.value as TableOperator })
                        }
                      >
                        {operators.map((op) => (
                          <option key={op} value={op}>
                            {t(`table.${op}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label htmlFor={`table-value-${index}`} className="grid gap-1 text-xs">
                      {t("table.value")}
                      <input
                        id={`table-value-${index}`}
                        className={fieldClass}
                        disabled={
                          column.operator === "any" ||
                          column.operator === "missing" ||
                          column.operator === "empty"
                        }
                        value={column.value}
                        onChange={(event) => update(index, { value: event.target.value })}
                      />
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-end"
                      disabled={columns.length === 1}
                      onClick={() => {
                        invalidate();
                        setColumns(columns.filter((_, i) => i !== index));
                      }}
                    >
                      {t("table.remove")}
                    </Button>
                  </fieldset>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={columns.length >= 12}
                  onClick={() => {
                    invalidate();
                    setColumns([...columns, { path: "", operator: "any", value: "" }]);
                  }}
                >
                  {t("table.add")}
                </Button>
                <Button size="sm" disabled={busy || !records.length} onClick={() => void scan()}>
                  {t("table.scan")}
                </Button>
                {busy ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      operation.current?.abort();
                      setBusy(false);
                    }}
                  >
                    {t("table.cancel")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !result}
                  onClick={() => void exportCsv()}
                >
                  {t("table.export")}
                </Button>
              </div>
              {busy ? (
                <p role="status" className="text-xs">
                  {t("table.progress", { count: progress, total: records.length })}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-xs text-error">
                  {error}
                </p>
              ) : null}
              {result ? (
                <section className="space-y-3">
                  <p role="status" className="text-xs">
                    {t("table.summary", {
                      count: result.rows.length,
                      total: result.scanned,
                      failed: result.failed,
                    })}
                  </p>
                  <FieldProfiles
                    columns={result.columns}
                    profiles={result.profiles}
                    onSelect={(index, kind) => {
                      const nextColumns = result.columns.map((column, i): TableColumn => ({
                        ...column,
                        operator:
                          i !== index
                            ? "any"
                            : kind === "missing"
                              ? "missing"
                              : kind === "empty"
                                ? "empty"
                                : "kind",
                        value: i === index ? kind : "",
                      }));
                      setColumns(nextColumns);
                      void scan(nextColumns);
                    }}
                  />
                  <p className="text-xs text-text-tertiary">{t("table.csvHint")}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left font-mono text-xs">
                      <caption className="sr-only">{t("table.title")}</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border p-2">
                            {t("table.line")}
                          </th>
                          {result.columns.map((column, index) => (
                            <th key={index} scope="col" className="border-b border-border p-2">
                              {column.path}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.slice(page * 50, page * 50 + 50).map((row) => (
                          <tr key={row.recordId}>
                            <th scope="row" className="border-b border-border p-2">
                              <button
                                type="button"
                                className="text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
                                onClick={() => {
                                  onOpenRecord(row.recordId);
                                  onClose();
                                }}
                              >
                                {row.lineNumber}
                              </button>
                            </th>
                            {row.cells.map((cell, index) => (
                              <td
                                key={index}
                                className="max-w-80 border-b border-border p-2 align-top"
                              >
                                <span className="block whitespace-pre-wrap break-all">
                                  {cell.kind === "missing"
                                    ? t("table.missing")
                                    : cell.text.length > 250
                                      ? cell.text.slice(0, 250) + "…"
                                      : cell.text}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {result.rows.length > 50 ? (
                    <div className="flex items-center gap-3 text-xs">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        {t("table.previous")}
                      </Button>
                      <span>
                        {page + 1} / {Math.ceil(result.rows.length / 50)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(page + 1) * 50 >= result.rows.length}
                        onClick={() => setPage(page + 1)}
                      >
                        {t("table.next")}
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
