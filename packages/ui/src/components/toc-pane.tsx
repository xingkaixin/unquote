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
  onSelect: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
}

export const TocPane = ({
  records,
  recordInsights,
  totalCount,
  activeRecordId,
  onSelect,
  onCopyRawLine,
}: TocPaneProps) => {
  const { t } = useTranslation();
  const success = records.filter((record) => record.node).length;
  const failed = records.length - success;
  const description =
    records.length === totalCount
      ? t("toc.stats", { success, failed })
      : t("toc.filteredStats", { shown: records.length, total: totalCount, success, failed });

  return (
    <Card className="hidden min-h-0 flex-1 overflow-hidden bg-surface-50 lg:flex lg:flex-col">
      <CardHeader>
        <CardTitle>{t("toc.title")}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <div className="flex flex-col gap-1">
            {records.map((record) => {
              const active = activeRecordId === record.id;
              const variant = record.node ? "success" : "danger";
              const insight = recordInsights.get(record.id);
              return (
                <div
                  key={record.id}
                  className={`flex items-stretch rounded-md border ${active ? "border-border bg-surface-100 shadow-sm" : "border-transparent"}`}
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
                        <Badge variant={variant}>{record.node ? "ok" : "err"}</Badge>
                      </div>
                      <span className="truncate text-[13px] text-text-secondary">
                        {insight?.title ?? record.summary}
                      </span>
                      {insight ? <RecordInsightSummary insight={insight} compact /> : null}
                    </div>
                  </button>
                  {!record.node ? (
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
