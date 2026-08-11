import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentTimelineEvent } from "../lib/agent-session";
import { formatClockTime } from "../lib/format";
import { categoryConfig, formatEventMeta } from "./agent-session-format";

export const timelineVirtualizationThreshold = 160;
const timelineEventEstimateSize = 44;

const TimelineEvent = ({
  event,
  selected,
  onSelect,
  virtualized = false,
  virtualIndex,
  collectionSize,
  positionInSet,
  style,
}: {
  event: AgentTimelineEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
  virtualized?: boolean;
  virtualIndex?: number;
  collectionSize?: number;
  positionInSet?: number;
  style?: CSSProperties;
}) => {
  const { locale, t } = useTranslation();
  const config = categoryConfig(event.category, t);
  const time = formatClockTime(event.timestamp ?? event.timestampLabel, locale);

  return (
    <div
      role="listitem"
      aria-current={selected ? "true" : undefined}
      aria-setsize={collectionSize}
      aria-posinset={positionInSet}
      data-index={virtualized ? virtualIndex : undefined}
      className={virtualized ? "absolute left-0 top-0 w-full" : ""}
      style={style}
    >
      <button
        type="button"
        aria-label={`${t("agent.timeline")}: ${config.label} · ${event.label}`}
        className={`flex h-11 w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
          selected ? "bg-accent-soft" : "hover:bg-surface-200"
        }`}
        onClick={() => onSelect(event.id)}
      >
        <span className="flex shrink-0 flex-col items-center gap-1 pt-1">
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: config.dot }} />
          <span className="w-px flex-1 bg-border" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[12px] font-medium text-text-primary">
              {config.label}
            </span>
            <span className="truncate text-[10px] text-text-tertiary">· {event.label}</span>
          </span>
          <span className="truncate font-mono text-[10px] text-text-tertiary">
            {formatEventMeta(event.lineNumber, time, event.turnIndex, t)}
          </span>
        </span>
      </button>
    </div>
  );
};

interface AgentTimelinePaneProps {
  events: readonly AgentTimelineEvent[];
  highlightedRecordId: string | undefined;
  onSelectEvent: (eventId: string) => void;
}

export const AgentTimelinePane = ({
  events,
  highlightedRecordId,
  onSelectEvent,
}: AgentTimelinePaneProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = events.length > timelineVirtualizationThreshold;
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => timelineEventEstimateSize,
    overscan: 12,
    getItemKey: (index) => events[index]?.id ?? index,
    enabled: shouldVirtualize,
  });
  const firstTurnIndex = events[0]?.turnIndex;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="uq-label m-0 flex shrink-0 items-center gap-1 px-3.5 pb-2 pt-4">
        {t("agent.timeline")}
        {firstTurnIndex === undefined ? null : (
          <span>· {t("agent.turn", { turn: firstTurnIndex })}</span>
        )}
      </h2>
      <div
        ref={scrollRef}
        role="list"
        aria-label={t("agent.timeline")}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {shouldVirtualize ? (
          <div
            role="presentation"
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
                  collectionSize={events.length}
                  positionInSet={virtualItem.index + 1}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                />
              );
            })}
          </div>
        ) : (
          events.map((event) => (
            <TimelineEvent
              key={event.id}
              event={event}
              selected={highlightedRecordId === event.recordId}
              onSelect={onSelectEvent}
            />
          ))
        )}
      </div>
    </div>
  );
};
