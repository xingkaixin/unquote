import { useVirtualizer } from "@tanstack/react-virtual";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentTimelineEvent } from "../lib/agent-session";
import { categoryConfig, formatTimestamp } from "./agent-session-format";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

export const timelineVirtualizationThreshold = 160;
const timelineEventEstimateSize = 54;
const timelineEventEstimateSizeWithPreview = 76;
const timelineEventGap = 4;

const TimelineEvent = ({
  event,
  selected,
  onSelect,
  virtualized = false,
  virtualIndex,
  style,
  measureRef,
}: {
  event: AgentTimelineEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
  virtualized?: boolean;
  virtualIndex?: number;
  style?: CSSProperties;
  measureRef?: (node: HTMLButtonElement | null) => void;
}) => {
  const { locale, t } = useTranslation();
  const config = categoryConfig(event.category, t);
  const Icon = config.icon;
  const timestamp = formatTimestamp(event.timestamp, event.timestampLabel, locale);

  return (
    <button
      ref={measureRef}
      type="button"
      data-index={virtualized ? virtualIndex : undefined}
      aria-label={`${t("agent.timeline")}: ${event.label}`}
      aria-pressed={selected}
      className={`flex w-full min-w-0 gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
        virtualized ? "absolute left-0 top-0" : ""
      } ${
        selected
          ? "border-accent bg-[rgba(229,112,62,0.08)]"
          : "border-transparent hover:border-border hover:bg-surface-100"
      }`}
      style={style}
      onClick={() => onSelect(event.id)}
    >
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${config.tone}`} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-text-primary">{event.label}</span>
          <span className="shrink-0 text-[10px] uppercase text-text-muted">{config.label}</span>
        </span>
        {event.preview ? (
          <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
            {event.preview}
          </span>
        ) : null}
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span>{t("agent.line", { line: event.lineNumber })}</span>
          {event.turnIndex ? <span>{t("agent.turn", { turn: event.turnIndex })}</span> : null}
          {timestamp ? <span className="truncate">{timestamp}</span> : null}
        </span>
      </span>
    </button>
  );
};

interface AgentTimelinePaneProps {
  events: AgentTimelineEvent[];
  highlightedRecordId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectEvent: (eventId: string) => void;
}

export const AgentTimelinePane = ({
  events,
  highlightedRecordId,
  collapsed,
  onToggleCollapsed,
  onSelectEvent,
}: AgentTimelinePaneProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = events.length > timelineVirtualizationThreshold;
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      events[index]?.preview ? timelineEventEstimateSizeWithPreview : timelineEventEstimateSize,
    overscan: 12,
    gap: timelineEventGap,
    getItemKey: (index) => events[index]?.id ?? index,
    measureElement: (element) =>
      element?.getBoundingClientRect().height ?? timelineEventEstimateSize,
    enabled: shouldVirtualize,
  });

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("agent.timeline")}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="uq-icon-button h-7 w-7 px-0"
          onClick={onToggleCollapsed}
          aria-label={t(collapsed ? "agent.expandTimeline" : "agent.collapseTimeline")}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-2">
          {shouldVirtualize ? (
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const event = events[virtualItem.index];
                if (!event) {
                  return null;
                }

                return (
                  <TimelineEvent
                    key={event.id}
                    event={event}
                    selected={highlightedRecordId === event.recordId}
                    onSelect={onSelectEvent}
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
              {events.map((event) => (
                <TimelineEvent
                  key={event.id}
                  event={event}
                  selected={highlightedRecordId === event.recordId}
                  onSelect={onSelectEvent}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
