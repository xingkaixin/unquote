import { useVirtualizer } from "@tanstack/react-virtual";
import type { JsonlRecord } from "@unquote/core";
import { isParsed } from "@unquote/core";
import { Copy } from "lucide-react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { RecordInsight } from "../lib/record-insight";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { RecordInsightSummary } from "./record-insight";

export const tocVirtualizationThreshold = 160;
const tocRowEstimateSize = 64;
const tocRowGap = 4;

const TocRow = ({
  record,
  active,
  insight,
  onSelect,
  onCopyRawLine,
  virtualized = false,
  virtualIndex,
  style,
  measureRef,
}: {
  record: JsonlRecord;
  active: boolean;
  insight: RecordInsight | undefined;
  onSelect: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  virtualized?: boolean;
  virtualIndex?: number;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}) => {
  const { t } = useTranslation();
  const parsed = isParsed(record);
  const variant = parsed ? "success" : "danger";

  return (
    <div
      ref={measureRef}
      data-index={virtualized ? virtualIndex : undefined}
      className={`flex items-stretch rounded-md border transition-colors ${
        virtualized ? "absolute left-0 top-0 w-full" : ""
      } ${
        active
          ? "border-border-medium bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shadow-[inset_2px_0_0_var(--color-accent)]"
          : "border-transparent hover:border-border hover:bg-surface-200"
      }`}
      style={style}
    >
      <button
        type="button"
        aria-pressed={active}
        className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={() => onSelect(record)}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-text-muted">#{record.lineNumber}</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`nf-led ${parsed ? "is-green is-static" : "is-red"}`} />
              <Badge variant={variant} translate="no">
                {parsed ? "ok" : "err"}
              </Badge>
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
};

interface TocPaneProps {
  records: JsonlRecord[];
  recordInsights: ReadonlyMap<string, RecordInsight>;
  stats: { total: number; success: number; failed: number };
  totalCount: number;
  activeRecordId: string | null;
  selectedRecordId: string | null;
  onSelect: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
}

export const TocPane = ({
  records,
  recordInsights,
  stats,
  totalCount,
  activeRecordId,
  selectedRecordId,
  onSelect,
  onCopyRawLine,
}: TocPaneProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = records.length > tocVirtualizationThreshold;
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => tocRowEstimateSize,
    overscan: 12,
    gap: tocRowGap,
    getItemKey: (index) => records[index]?.id ?? index,
    measureElement: (element) => element?.getBoundingClientRect().height ?? tocRowEstimateSize,
    enabled: shouldVirtualize,
  });
  const description =
    stats.total === totalCount
      ? t("toc.stats", { success: stats.success, failed: stats.failed })
      : t("toc.filteredStats", {
          shown: stats.total,
          total: totalCount,
          success: stats.success,
          failed: stats.failed,
        });

  return (
    <Card className="hidden min-h-0 flex-1 overflow-hidden lg:flex lg:flex-col">
      <CardHeader className="px-4 py-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>{t("toc.title")}</CardTitle>
          <CardDescription className="nf-mono-sub text-right">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col bg-surface-100 px-2 py-2">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {shouldVirtualize ? (
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const record = records[virtualItem.index];
                if (!record) {
                  return null;
                }

                return (
                  <TocRow
                    key={record.id}
                    record={record}
                    active={(selectedRecordId ?? activeRecordId) === record.id}
                    insight={recordInsights.get(record.id)}
                    onSelect={onSelect}
                    onCopyRawLine={onCopyRawLine}
                    virtualized
                    virtualIndex={virtualItem.index}
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                    measureRef={(node) => {
                      if (node) {
                        rowVirtualizer.measureElement(node);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {records.map((record) => (
                <TocRow
                  key={record.id}
                  record={record}
                  active={(selectedRecordId ?? activeRecordId) === record.id}
                  insight={recordInsights.get(record.id)}
                  onSelect={onSelect}
                  onCopyRawLine={onCopyRawLine}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
