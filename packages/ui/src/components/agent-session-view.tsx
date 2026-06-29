import {
  Bot,
  Brain,
  CircleAlert,
  Clock3,
  FileJson,
  Hash,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  TerminalSquare,
  UserRound,
  Wrench,
} from "lucide-react";
import type { JsonlRecord } from "@unquote/core";
import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import type {
  AgentContentBlock,
  AgentConversationItem,
  AgentConversationRole,
  AgentEventCategory,
  AgentSession,
  AgentTimelineEvent,
} from "../lib/agent-session";
import type { RecordInsight } from "../lib/record-insight";
import type { TreeRow } from "../lib/tree";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { JsonTree } from "./json-tree";

interface AgentSessionViewProps {
  session: AgentSession;
  recordsById: ReadonlyMap<string, JsonlRecord>;
  recordInsights: ReadonlyMap<string, RecordInsight>;
  expandedStringifiedPaths: Set<string>;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  selectedRecordId: string | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  onCopyError: (record: JsonlRecord) => void;
  onSelectNode: (record: JsonlRecord, row: TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
}

type AgentDetailSelection =
  | { kind: "event"; id: string }
  | { kind: "conversation"; id: string };

interface RoleConfig {
  label: string;
  icon: ComponentType<{ className?: string }>;
  variant: "default" | "warning" | "success" | "danger";
  align: "start" | "end";
}

const roleConfig = (
  role: AgentConversationRole,
  t: ReturnType<typeof useTranslation>["t"],
): RoleConfig => {
  switch (role) {
    case "user":
      return { label: t("agent.role.user"), icon: UserRound, variant: "default", align: "end" };
    case "assistant":
      return { label: t("agent.role.assistant"), icon: Bot, variant: "success", align: "start" };
    case "thinking":
      return { label: t("agent.role.thinking"), icon: Brain, variant: "default", align: "start" };
    case "tool_call":
      return { label: t("agent.role.toolCall"), icon: Wrench, variant: "warning", align: "start" };
    case "tool_result":
      return {
        label: t("agent.role.toolResult"),
        icon: TerminalSquare,
        variant: "warning",
        align: "start",
      };
    case "system":
      return { label: t("agent.role.system"), icon: FileJson, variant: "default", align: "start" };
  }
};

const categoryConfig = (
  category: AgentEventCategory,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  switch (category) {
    case "user":
      return { label: t("agent.category.user"), icon: UserRound, tone: "text-text-secondary" };
    case "assistant":
      return { label: t("agent.category.assistant"), icon: Bot, tone: "text-success" };
    case "thinking":
      return { label: t("agent.category.thinking"), icon: Brain, tone: "text-code-boolean" };
    case "tool":
      return { label: t("agent.category.tool"), icon: Wrench, tone: "text-warning" };
    case "system":
      return { label: t("agent.category.system"), icon: FileJson, tone: "text-text-muted" };
    case "meta":
      return { label: t("agent.category.meta"), icon: Hash, tone: "text-text-muted" };
    case "unknown":
      return { label: t("agent.category.unknown"), icon: CircleAlert, tone: "text-error" };
  }
};

const formatTimestamp = (timestamp: number | undefined, timestampLabel: string | undefined) => {
  if (timestampLabel) {
    return timestampLabel;
  }
  if (timestamp === undefined) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
};

const metricItems = (session: AgentSession, t: ReturnType<typeof useTranslation>["t"]) => {
  const toolCount = session.conversationItems.filter(
    (item) => item.role === "tool_call" || item.role === "tool_result",
  ).length;
  return [
    { label: t("agent.metric.events"), value: session.events.length },
    { label: t("agent.metric.messages"), value: session.conversationItems.length },
    { label: t("agent.metric.turns"), value: session.meta.turnCount },
    { label: t("agent.metric.tools"), value: toolCount },
  ];
};

const BlockText = ({ block }: { block: AgentContentBlock | undefined }) => {
  if (!block) {
    return null;
  }

  const codeLike = block.type === "tool_use" || block.toolCallId;
  return (
    <pre
      className={`mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-[12px] leading-5 ${
        codeLike
          ? "bg-surface-50 font-mono text-text-primary"
          : "bg-transparent font-sans text-text-secondary"
      }`}
    >
      {block.text}
    </pre>
  );
};

const ConversationItem = ({
  item,
  event,
  selected,
  onSelect,
}: {
  item: AgentConversationItem;
  event: AgentTimelineEvent | undefined;
  selected: boolean;
  onSelect: (itemId: string) => void;
}) => {
  const { t } = useTranslation();
  const config = roleConfig(item.role, t);
  const Icon = config.icon;
  const timestamp = formatTimestamp(event?.timestamp, event?.timestampLabel);

  return (
    <article className={`flex ${config.align === "end" ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        aria-label={`${t("agent.conversation")}: ${config.label}`}
        aria-pressed={selected}
        className={`min-w-0 max-w-[min(48rem,100%)] rounded-md border px-3 py-2 text-left shadow-sm transition-colors ${
          selected
            ? "border-accent bg-[rgba(229,112,62,0.08)]"
            : "border-border bg-surface-100 hover:border-accent/50"
        }`}
        onClick={() => onSelect(item.id)}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant={config.variant}>
            <Icon className="mr-1 size-3" />
            {config.label}
          </Badge>
          {item.block?.toolName ? <Badge variant="warning">{item.block.toolName}</Badge> : null}
          {item.block?.status ? <Badge>{item.block.status}</Badge> : null}
          {item.turnIndex ? <Badge>{t("agent.turn", { turn: item.turnIndex })}</Badge> : null}
          <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
            <Hash className="size-3" />
            {t("agent.line", { line: item.lineNumber })}
          </span>
          {timestamp ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-text-muted">
              <Clock3 className="size-3 shrink-0" />
              <span className="truncate">{timestamp}</span>
            </span>
          ) : null}
        </div>
        <BlockText block={item.block} />
      </button>
    </article>
  );
};

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

const RawJsonlPanel = ({
  event,
  item,
  record,
  insight,
  expandedStringifiedPaths,
  selectedPath,
  focusedPath,
  onCollapse,
  onTogglePath,
  onCopyRecord,
  onCopyRawLine,
  onCopyError,
  onSelectNode,
  onHydrateRecord,
  onClearFocus,
}: {
  event: AgentTimelineEvent;
  item: AgentConversationItem | undefined;
  record: JsonlRecord | undefined;
  insight: RecordInsight | undefined;
  expandedStringifiedPaths: Set<string>;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  onCollapse: () => void;
  onTogglePath: (path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  onCopyError: (record: JsonlRecord) => void;
  onSelectNode: (record: JsonlRecord, row: TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
}) => {
  const { t } = useTranslation();
  const role = item ? roleConfig(item.role, t) : null;
  const category = categoryConfig(event.category, t);
  const RoleIcon = role?.icon;
  const CategoryIcon = category.icon;
  const recordId = event.recordId;
  const timestamp = formatTimestamp(event.timestamp, event.timestampLabel);

  return (
    <section
      role="complementary"
      aria-label={t("agent.rawJsonl")}
      className="uq-agent-raw-panel min-w-0 overflow-hidden border border-border bg-surface-100"
    >
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {role && RoleIcon ? (
              <Badge variant={role.variant}>
                <RoleIcon className="mr-1 size-3" />
                {role.label}
              </Badge>
            ) : null}
            <Badge>
              <CategoryIcon className={`mr-1 size-3 ${category.tone}`} />
              {category.label}
            </Badge>
            <Badge>{t("agent.line", { line: event.lineNumber })}</Badge>
          </div>
          <CardTitle className="mt-2 truncate">{event.label}</CardTitle>
          <p className="mt-1 truncate font-mono text-[11px] text-text-muted">
            {recordId}
            {timestamp ? ` · ${timestamp}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          onClick={onCollapse}
          aria-label={t("agent.collapseRawData")}
        >
          <PanelRightClose className="size-3.5" />
        </Button>
      </CardHeader>

      <div className="min-h-0 overflow-auto p-2">
        {record ? (
          <JsonTree
            record={record}
            insight={insight}
            expandedStringifiedPaths={expandedStringifiedPaths}
            eager
            searchMatches={[]}
            activeMatch={null}
            scrollTarget={null}
            selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
            focusedPath={focusedPath?.recordId === record.id ? focusedPath : null}
            onTogglePath={onTogglePath}
            onCopyRecord={() => onCopyRecord(record)}
            onCopyRawLine={() => onCopyRawLine(record)}
            onCopyError={() => onCopyError(record)}
            onSelectNode={(row) => onSelectNode(record, row)}
            onHydrateRecord={onHydrateRecord}
            onClearFocus={onClearFocus}
          />
        ) : (
          <pre className="max-h-[64vh] min-h-[12rem] overflow-auto border border-border bg-surface-50 px-3 py-2 font-mono text-[11.5px] leading-5 text-text-primary">
            {event.rawLine}
          </pre>
        )}
      </div>

    </section>
  );
};

const RawJsonlRail = ({ onExpand }: { onExpand: () => void }) => {
  const { t } = useTranslation();

  return (
    <div className="uq-agent-raw-rail min-w-0 border border-border bg-surface-100">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 px-0"
        onClick={onExpand}
        aria-label={t("agent.expandRawData")}
      >
        <PanelRightOpen className="size-3.5" />
      </Button>
    </div>
  );
};

export const AgentSessionView = ({
  session,
  recordsById,
  recordInsights,
  expandedStringifiedPaths,
  selectedPath,
  focusedPath,
  selectedRecordId,
  onTogglePath,
  onCopyRecord,
  onCopyRawLine,
  onCopyError,
  onSelectNode,
  onHydrateRecord,
  onClearFocus,
}: AgentSessionViewProps) => {
  const { t } = useTranslation();
  const eventById = useMemo(
    () => new Map(session.events.map((event) => [event.id, event])),
    [session.events],
  );
  const eventByRecordId = useMemo(
    () => new Map(session.events.map((event) => [event.recordId, event])),
    [session.events],
  );
  const conversationById = useMemo(
    () => new Map(session.conversationItems.map((item) => [item.id, item])),
    [session.conversationItems],
  );
  const metrics = useMemo(() => metricItems(session, t), [session, t]);
  const [detailSelection, setDetailSelection] = useState<AgentDetailSelection | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const conversationRefs = useRef(new Map<string, HTMLDivElement>());
  const selectedItem =
    detailSelection?.kind === "conversation" ? conversationById.get(detailSelection.id) : undefined;
  const selectedEvent =
    detailSelection?.kind === "event"
      ? eventById.get(detailSelection.id)
      : selectedItem
        ? eventById.get(selectedItem.eventId)
        : selectedRecordId
          ? eventByRecordId.get(selectedRecordId)
          : undefined;
  const selectedConversationId = selectedItem?.id;
  const detailEvent = detailOpen ? (selectedEvent ?? session.events[0]) : undefined;
  const detailItem =
    selectedItem ??
    (detailEvent?.conversationItemIds[0]
      ? conversationById.get(detailEvent.conversationItemIds[0])
      : undefined);
  const highlightedRecordId =
    selectedItem?.recordId ?? selectedEvent?.recordId ?? selectedRecordId ?? detailEvent?.recordId;
  const showRawRail = !detailEvent && session.events.length > 0;

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    conversationRefs.current
      .get(selectedConversationId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedConversationId]);

  useEffect(() => {
    if (selectedRecordId) {
      setDetailOpen(true);
    }
  }, [selectedRecordId]);

  const handleSelectTimelineEvent = (eventId: string) => {
    const event = eventById.get(eventId);
    const conversationItemId = event?.conversationItemIds[0];

    setDetailSelection(
      conversationItemId
        ? { kind: "conversation", id: conversationItemId }
        : { kind: "event", id: eventId },
    );
    setDetailOpen(true);
  };

  return (
    <div
      className="uq-agent-shell flex flex-col gap-3"
      data-raw-open={detailEvent ? "true" : "false"}
      data-timeline-collapsed={timelineCollapsed ? "true" : "false"}
    >
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
        <div className="rounded-md border border-border bg-surface-100 px-4 py-3 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="success">{session.fileType}</Badge>
            {session.fileName ? <Badge>{session.fileName}</Badge> : null}
            {session.parseWarnings.length > 0 ? (
              <Badge variant="danger">
                {t("agent.warnings", { count: session.parseWarnings.length })}
              </Badge>
            ) : null}
          </div>
          <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
            {session.meta.sessionId ? (
              <div className="min-w-0">
                <dt className="text-text-muted">{t("agent.sessionId")}</dt>
                <dd className="truncate font-mono text-text-primary">{session.meta.sessionId}</dd>
              </div>
            ) : null}
            {session.meta.model ? (
              <div className="min-w-0">
                <dt className="text-text-muted">{t("agent.model")}</dt>
                <dd className="truncate font-mono text-text-primary">{session.meta.model}</dd>
              </div>
            ) : null}
            {session.meta.cwd ? (
              <div className="min-w-0">
                <dt className="text-text-muted">{t("agent.cwd")}</dt>
                <dd className="truncate font-mono text-text-primary">{session.meta.cwd}</dd>
              </div>
            ) : null}
            {session.meta.version ? (
              <div className="min-w-0">
                <dt className="text-text-muted">{t("agent.version")}</dt>
                <dd className="truncate font-mono text-text-primary">{session.meta.version}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="grid overflow-hidden rounded-md border border-border bg-surface-50 sm:grid-cols-4">
          {metrics.map((item, index) => (
            <div
              key={item.label}
              className={`px-3 py-2.5 ${
                index === 0 ? "" : "border-t border-border sm:border-l sm:border-t-0"
              }`}
            >
              <div className="text-[10px] font-medium uppercase text-text-muted">{item.label}</div>
              <div className="mt-1 font-mono text-[18px] leading-6 text-text-primary">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="uq-agent-workspace grid gap-3">
        <div className="uq-agent-main grid gap-3">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="uq-agent-timeline-header flex-row items-center justify-between gap-2">
              <CardTitle className="uq-agent-timeline-title">
                {t("agent.timeline")}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="uq-agent-timeline-toggle h-7 w-7 px-0"
                onClick={() => setTimelineCollapsed((current) => !current)}
                aria-label={t(
                  timelineCollapsed ? "agent.expandTimeline" : "agent.collapseTimeline",
                )}
              >
                {timelineCollapsed ? (
                  <PanelLeftOpen className="size-3.5" />
                ) : (
                  <PanelLeftClose className="size-3.5" />
              )}
            </Button>
          </CardHeader>
            <CardContent className="uq-agent-timeline-content max-h-[72vh] overflow-auto p-2">
              <div className="flex flex-col gap-1">
                {session.events.map((event) => (
                  <TimelineEvent
                    key={event.id}
                    event={event}
                    selected={highlightedRecordId === event.recordId}
                    onSelect={handleSelectTimelineEvent}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle>{t("agent.conversation")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {session.conversationItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-muted">
                  {t("agent.noConversation")}
                </div>
              ) : (
                session.conversationItems.map((item) => (
                  <div
                    key={item.id}
                    ref={(node) => {
                      if (node) {
                        conversationRefs.current.set(item.id, node);
                      } else {
                        conversationRefs.current.delete(item.id);
                      }
                    }}
                  >
                    <ConversationItem
                      item={item}
                      event={eventById.get(item.eventId)}
                      selected={selectedConversationId === item.id}
                      onSelect={(itemId) => {
                        setDetailSelection({ kind: "conversation", id: itemId });
                        setDetailOpen(true);
                      }}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {detailEvent ? (
          <RawJsonlPanel
            event={detailEvent}
            item={detailItem}
            record={recordsById.get(detailEvent.recordId)}
            insight={recordInsights.get(detailEvent.recordId)}
            expandedStringifiedPaths={expandedStringifiedPaths}
            selectedPath={selectedPath}
            focusedPath={focusedPath}
            onCollapse={() => setDetailOpen(false)}
            onTogglePath={onTogglePath}
            onCopyRecord={onCopyRecord}
            onCopyRawLine={onCopyRawLine}
            onCopyError={onCopyError}
            onSelectNode={onSelectNode}
            onHydrateRecord={onHydrateRecord}
            onClearFocus={onClearFocus}
          />
        ) : showRawRail ? (
          <RawJsonlRail onExpand={() => setDetailOpen(true)} />
        ) : null}
      </div>
    </div>
  );
};
