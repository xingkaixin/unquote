import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { AgentTimelineEvent } from "../lib/agent-session";
import { categoryConfig, formatTimestamp } from "./agent-session-format";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

const TimelineEvent = ({
  event,
  selected,
  onSelect,
}: {
  event: AgentTimelineEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) => {
  const { t } = useTranslation();
  const config = categoryConfig(event.category, t);
  const Icon = config.icon;
  const timestamp = formatTimestamp(event.timestamp, event.timestampLabel);

  return (
    <button
      type="button"
      aria-label={`${t("agent.timeline")}: ${event.label}`}
      aria-pressed={selected}
      className={`flex w-full min-w-0 gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
        selected
          ? "border-accent bg-[rgba(229,112,62,0.08)]"
          : "border-transparent hover:border-border hover:bg-surface-100"
      }`}
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

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="uq-agent-timeline-header flex-row items-center justify-between gap-2">
        <CardTitle className="uq-agent-timeline-title">{t("agent.timeline")}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="uq-agent-timeline-toggle h-7 w-7 px-0"
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
      <CardContent className="uq-agent-timeline-content max-h-[72vh] overflow-auto p-2">
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
      </CardContent>
    </Card>
  );
};
