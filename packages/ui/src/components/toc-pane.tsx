import type { JsonlRecord } from "@unquote/core";
import { Copy } from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { RecordInsight } from "../lib/record-insight";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { RecordInsightSummary } from "./record-insight";

interface TocPaneProps {
  records: JsonlRecord[];
  recordInsights: ReadonlyMap<string, RecordInsight>;
  totalCount: number;
  activeRecordId: string | null;
  selectedRecordId: string | null;
  onSelect: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
}

export const TocPane = ({
  records,
  recordInsights,
  totalCount,
  activeRecordId,
  selectedRecordId,
  onSelect,
  onCopyRawLine,
}: TocPaneProps) => {
  const { t } = useTranslation();
  const success = records.filter((record) => record.node || record.deferred).length;
  const failed = records.length - success;
  const description =
    records.length === totalCount
      ? t("toc.stats", { success, failed })
      : t("toc.filteredStats", { shown: records.length, total: totalCount, success, failed });

  return (
    <Card className="hidden min-h-0 flex-1 overflow-hidden lg:flex lg:flex-col">
      <CardHeader className="px-4 py-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>{t("toc.title")}</CardTitle>
          <CardDescription className="nf-mono-sub text-right">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col bg-surface-100 px-2 py-2">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-1">
            {records.map((record) => {
              const active = (selectedRecordId ?? activeRecordId) === record.id;
              const parsed = Boolean(record.node || record.deferred);
              const variant = parsed ? "success" : "danger";
              const insight = recordInsights.get(record.id);
              return (
                <div
                  key={record.id}
                  className={`flex items-stretch rounded-md border transition-colors ${
                    active
                      ? "border-border-medium bg-surface-50 shadow-[inset_2px_0_0_var(--color-accent)]"
                      : "border-transparent hover:border-border hover:bg-surface-50"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    onClick={() => onSelect(record)}
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-text-muted">
                          #{record.lineNumber}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`nf-led ${parsed ? "is-green is-static" : "is-red"}`}
                          />
                          <Badge variant={variant}>{parsed ? "ok" : "err"}</Badge>
                        </span>
                      </div>
                      <span className="truncate text-[12px] text-text-secondary">
                        {insight?.title ?? record.summary}
                      </span>
                      {insight ? <RecordInsightSummary insight={insight} compact /> : null}
                    </div>
                  </button>
                  {!parsed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="m-1 h-auto w-8 shrink-0 px-0"
                      aria-label={t("error.copyRawLine")}
                      title={t("error.copyRawLine")}
                      onClick={() => onCopyRawLine(record)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
