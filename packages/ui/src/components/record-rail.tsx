import { useVirtualizer } from "@tanstack/react-virtual";
import type { JsonlRecord } from "@unquote/core";
import { isParsed } from "@unquote/core";
import type { CSSProperties } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { MessageKey } from "../i18n/i18n";
import { formatClockTime } from "../lib/format";
import { preferredScrollBehavior } from "../lib/motion-preference";
import type { RecordInsight, RecordInsightKind } from "../lib/record-insight";
import { resolveRecordScrollIndex, type ScrollIntent } from "../lib/scroll-intent";

export const recordRailVirtualizationThreshold = 160;
// Rows are three truncated lines, so the virtualizer runs without measuring
// them — which only holds while the rendered row is exactly this tall.
export const railRowHeight = 86;

// The rail always paints the four real RecordInsight kinds plus `error` for
// records that never parsed; the agent-only six-way category split is not
// available for plain JSON and would need a second labelling system.
const kindDot: Record<RecordInsightKind, string> = {
  error: "var(--dot-error)",
  tool: "var(--dot-tool)",
  message: "var(--dot-message)",
  event: "var(--dot-event)",
};

const kindLabel: Record<RecordInsightKind, MessageKey> = {
  error: "insight.kind.error",
  tool: "insight.kind.tool",
  message: "insight.kind.message",
  event: "insight.kind.event",
};

const RailRow = ({
  record,
  insight,
  turnIndex,
  active,
  onSelect,
  virtualized = false,
  style,
}: {
  record: JsonlRecord;
  insight: RecordInsight | undefined;
  turnIndex: number | undefined;
  active: boolean;
  onSelect: (record: JsonlRecord) => void;
  virtualized?: boolean;
  style?: CSSProperties;
}) => {
  const { locale, t } = useTranslation();
  const parsed = isParsed(record);
  const kind: RecordInsightKind = parsed ? (insight?.kind ?? "event") : "error";
  const time = formatClockTime(insight?.timestamp, locale);
  const meta = [
    t("rail.line", { line: record.lineNumber }),
    time,
    turnIndex === undefined ? "" : t("rail.turn", { turn: turnIndex }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      aria-pressed={active}
      data-record-id={record.id}
      onClick={() => onSelect(record)}
      style={{ height: `${railRowHeight}px`, ...style }}
      className={`flex w-full gap-2.5 overflow-hidden border-b border-l-[3px] border-b-border px-3.5 py-[11px] text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
        virtualized ? "absolute left-0 top-0" : ""
      } ${active ? "border-l-accent bg-accent-soft" : "border-l-transparent hover:bg-surface-200"}`}
    >
      <span className="w-[18px] shrink-0 pt-px font-mono text-[11px] text-text-tertiary">
        #{record.lineNumber}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          {insight?.event ? (
            <span
              className={`min-w-0 truncate font-mono text-[11.5px] font-medium ${
                active ? "text-text-primary" : "text-text-secondary"
              }`}
            >
              {insight.event}
            </span>
          ) : null}
          <span className="uq-label ml-auto flex shrink-0 items-center gap-1.5">
            <span
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: kindDot[kind] }}
            />
            {parsed ? t(kindLabel[kind]) : t("error.parseFailed")}
          </span>
        </span>
        <span className="truncate text-[12px] text-text-secondary">
          {insight?.title ?? record.summary}
        </span>
        <span className="truncate font-mono text-[10px] text-text-tertiary">{meta}</span>
      </span>
    </button>
  );
};

export interface RecordRailProps {
  records: readonly JsonlRecord[];
  recordInsights: ReadonlyMap<string, RecordInsight>;
  turnIndexByRecordId: ReadonlyMap<string, number> | null;
  activeRecordId: string | null;
  scrollIntent: ScrollIntent | null;
  onSelect: (record: JsonlRecord) => void;
}

export const RecordRail = ({
  records,
  recordInsights,
  turnIndexByRecordId,
  activeRecordId,
  scrollIntent,
  onSelect,
}: RecordRailProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = records.length > recordRailVirtualizationThreshold;
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => railRowHeight,
    overscan: 12,
    getItemKey: (index) => records[index]?.id ?? index,
    enabled: shouldVirtualize,
  });

  const scrollToRecord = useCallback(
    (index: number) => {
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "center" });
        return;
      }

      const record = records[index];
      if (!record) {
        return;
      }

      const frame = requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`)
          ?.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
      });

      return () => cancelAnimationFrame(frame);
    },
    [records, rowVirtualizer, shouldVirtualize],
  );

  useLayoutEffect(() => {
    const index = resolveRecordScrollIndex(records, scrollIntent);
    if (index === -1) {
      return;
    }

    return scrollToRecord(index);
  }, [records, scrollIntent, scrollToRecord]);

  const renderRow = (record: JsonlRecord, style?: CSSProperties) => (
    <RailRow
      key={record.id}
      record={record}
      insight={recordInsights.get(record.id)}
      turnIndex={turnIndexByRecordId?.get(record.id)}
      active={record.id === activeRecordId}
      onSelect={onSelect}
      {...(style ? { virtualized: true, style } : {})}
    />
  );

  return (
    <div ref={scrollRef} data-record-rail className="min-h-0 flex-1 overflow-y-auto">
      {records.length === 0 ? (
        <p className="m-0 px-3.5 py-4 text-[12px] text-text-tertiary">{t("rail.empty")}</p>
      ) : shouldVirtualize ? (
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const record = records[virtualItem.index];
            return record
              ? renderRow(record, { transform: `translateY(${virtualItem.start}px)` })
              : null;
          })}
        </div>
      ) : (
        records.map((record) => renderRow(record))
      )}
    </div>
  );
};
