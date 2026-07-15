import type { FileOverview as FileOverviewModel } from "../lib/file-overview";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileText,
  Layers,
  Search,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useTranslation } from "../i18n/context";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardTitle } from "./card";

interface FileOverviewProps {
  overview: FileOverviewModel;
  format: "json" | "jsonl";
  visibleCount: number;
  onSelectNestedPath: (pathText: string) => void;
  onSearchFieldValue: (value: string) => void;
  onSelectError: (recordId: string) => void;
}

interface MetricItem {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}

const errorPreviewLimit = 8;

const fieldLabel = (field: string) => {
  switch (field) {
    case "tool":
      return "tool";
    case "type":
      return "type";
    default:
      return "event";
  }
};

const EmptyList = ({ label }: { label: string }) => (
  <div className="border border-dashed border-border px-3 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
    {label}
  </div>
);

export const FileOverview = ({
  overview,
  format,
  visibleCount,
  onSelectNestedPath,
  onSearchFieldValue,
  onSelectError,
}: FileOverviewProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const filtered = visibleCount !== overview.total;
  const metrics: MetricItem[] = [
    {
      label: t("overview.total"),
      value: overview.total,
      icon: FileText,
      tone: "text-text-secondary",
    },
    {
      label: t("overview.success"),
      value: overview.success,
      icon: CheckCircle2,
      tone: "text-success",
    },
    {
      label: t("overview.failed"),
      value: overview.failed,
      icon: CircleAlert,
      tone: "text-error",
    },
    {
      label: t("overview.nestedRecords"),
      value: overview.nestedRecords,
      icon: Sparkles,
      tone: "text-warning",
    },
    {
      label: t("overview.maxDepth"),
      value: overview.maxDepth,
      icon: Layers,
      tone: "text-text-secondary",
    },
  ];
  const previewErrors = overview.errors.slice(0, errorPreviewLimit);
  const hiddenErrorCount = overview.errors.length - previewErrors.length;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle>{t("overview.title")}</CardTitle>
            <Badge>{format.toUpperCase()}</Badge>
            {filtered ? (
              <Badge>
                {t("overview.filteredScope", {
                  shown: visibleCount,
                  total: overview.total,
                })}
              </Badge>
            ) : null}
          </div>
          <CardDescription className="nf-mono-sub mt-1">{t("overview.fullScope")}</CardDescription>
        </div>
        <ChevronDown
          className={`uq-motion-transform size-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <CardContent className="flex flex-col gap-4 px-4 pb-4 pt-0">
        <div className="grid overflow-hidden border border-border bg-surface-100 sm:grid-cols-5">
          {metrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.label}
                className={`min-w-0 px-3 py-2.5 ${
                  index === 0 ? "" : "border-t border-border sm:border-l sm:border-t-0"
                }`}
              >
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <Icon className={`size-3.5 shrink-0 ${metric.tone}`} />
                  <span className="truncate">{metric.label}</span>
                </div>
                <div className="mt-1 font-mono text-[16px] leading-6 text-text-primary">
                  {metric.value}
                </div>
              </div>
            );
          })}
        </div>

        {open ? (
          <div className="grid gap-4 xl:grid-cols-3">
            <section className="min-w-0">
              <h3 className="mb-2 text-[11px] font-medium text-text-primary">
                {t("overview.topNestedPaths")}
              </h3>
              {overview.topNestedPaths.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {overview.topNestedPaths.map((item) => (
                    <Button
                      key={item.pathText}
                      variant="ghost"
                      size="sm"
                      className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left"
                      onClick={() => onSelectNestedPath(item.pathText)}
                      aria-label={t("overview.jumpToPath", { path: item.pathText })}
                    >
                      <Sparkles className="size-3.5 shrink-0 text-warning" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {item.pathText}
                      </span>
                      <span className="inline-flex shrink-0 border border-border bg-surface-200 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                        {t("overview.count", { count: item.count })}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <EmptyList label={t("overview.none")} />
              )}
            </section>

            <section className="min-w-0">
              <h3 className="mb-2 text-[11px] font-medium text-text-primary">
                {t("overview.topFieldValues")}
              </h3>
              {overview.topFieldValues.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {overview.topFieldValues.map((item) => (
                    <Button
                      key={`${item.field}:${item.pathText}:${item.value}`}
                      variant="ghost"
                      size="sm"
                      className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left"
                      onClick={() => onSearchFieldValue(item.value)}
                      aria-label={t("overview.searchValue", { value: item.value })}
                    >
                      <Search className="size-3.5 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px] text-text-primary">
                          {item.value}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-text-muted">
                          {fieldLabel(item.field)} · {item.pathText}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 border border-border bg-surface-200 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                        {t("overview.count", { count: item.count })}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <EmptyList label={t("overview.none")} />
              )}
            </section>

            <section className="min-w-0">
              <h3 className="mb-2 text-[11px] font-medium text-text-primary">
                {t("overview.errors")}
              </h3>
              {previewErrors.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {previewErrors.map((error) => (
                    <Button
                      key={error.recordId}
                      variant="ghost"
                      size="sm"
                      className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left"
                      onClick={() => onSelectError(error.recordId)}
                      aria-label={t("overview.jumpToError", { line: error.lineNumber })}
                    >
                      <CircleAlert className="size-3.5 shrink-0 text-error" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[11px] text-text-primary">
                          {t("overview.errorLine", { line: error.lineNumber })}
                        </span>
                        <span className="block truncate text-[11px] text-text-muted">
                          {error.message || error.summary}
                        </span>
                      </span>
                    </Button>
                  ))}
                  {hiddenErrorCount > 0 ? (
                    <div className="px-2 pt-1 text-[11px] text-text-muted">
                      {t("overview.errorMore", { count: hiddenErrorCount })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyList label={t("overview.none")} />
              )}
            </section>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
