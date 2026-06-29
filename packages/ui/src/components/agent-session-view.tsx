import {
  Bot,
  Brain,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  FileJson,
  Hash,
  PanelRightClose,
  TerminalSquare,
  UserRound,
  Wrench,
} from "lucide-react";
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
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

interface AgentSessionViewProps {
  session: AgentSession;
  selectedRecordId: string | null;
  onSelectRecord: (recordId: string) => void;
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

const DetailRow = ({ label, value }: { label: string; value: string | number | undefined }) => {
  if (value === undefined || value === "") {
    return null;
  }

  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase text-text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words font-mono text-[12px] leading-5 text-text-primary">
        {value}
      </dd>
    </div>
  );
};

const formatUsage = (event: AgentTimelineEvent | undefined) => {
  if (!event?.usage) {
    return "";
  }

  const usage = event.usage;
  return [
    `input ${usage.inputTokens}`,
    `cache write ${usage.cacheCreationInputTokens}`,
    `cache read ${usage.cacheReadInputTokens}`,
    `output ${usage.outputTokens}`,
  ].join(" / ");
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

const DetailPanel = ({
  selection,
  event,
  item,
  onClose,
  onOpenRawJson,
}: {
  selection: AgentDetailSelection;
  event: AgentTimelineEvent | undefined;
  item: AgentConversationItem | undefined;
  onClose: () => void;
  onOpenRawJson: (recordId: string) => void;
}) => {
  const { t } = useTranslation();
  const role = item ? roleConfig(item.role, t) : null;
  const category = event ? categoryConfig(event.category, t) : null;
  const RoleIcon = role?.icon;
  const CategoryIcon = category?.icon;
  const recordId = item?.recordId ?? event?.recordId;
  const timestamp = formatTimestamp(event?.timestamp, event?.timestampLabel);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[31rem] flex-col border-l border-border bg-[var(--background)] shadow-2xl"
      aria-label={t("agent.detail")}
    >
      <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {role && RoleIcon ? (
              <Badge variant={role.variant}>
                <RoleIcon className="mr-1 size-3" />
                {role.label}
              </Badge>
            ) : null}
            {category && CategoryIcon ? (
              <Badge>
                <CategoryIcon className={`mr-1 size-3 ${category.tone}`} />
                {category.label}
              </Badge>
            ) : null}
            {selection.kind === "event" ? <Badge>{t("agent.detailEvent")}</Badge> : null}
          </div>
          <h3 className="mt-2 truncate text-[14px] font-semibold text-text-primary">
            {event?.label ?? item?.role ?? t("agent.detail")}
          </h3>
          {event?.preview ? (
            <p className="mt-1 max-h-10 overflow-hidden text-[12px] leading-5 text-text-secondary">
              {event.preview}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("agent.closeDetail")}>
          <PanelRightClose className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailRow label={t("agent.lineLabel")} value={item?.lineNumber ?? event?.lineNumber} />
          <DetailRow label={t("agent.kind")} value={event?.kind} />
          <DetailRow label={t("agent.turnLabel")} value={item?.turnIndex ?? event?.turnIndex} />
          <DetailRow label={t("agent.timestamp")} value={timestamp} />
          <DetailRow label={t("agent.recordId")} value={recordId} />
          <DetailRow label={t("agent.requestId")} value={event?.requestId} />
          <DetailRow label={t("agent.model")} value={event?.model} />
          <DetailRow label={t("agent.sessionId")} value={event?.sessionId} />
          <DetailRow label={t("agent.cwd")} value={event?.cwd} />
          <DetailRow label={t("agent.stopReason")} value={event?.stopReason} />
        </dl>

        {formatUsage(event) ? (
          <div className="mt-4 rounded-md border border-border bg-surface-50 px-3 py-2">
            <div className="text-[10px] font-medium uppercase text-text-muted">
              {t("agent.usage")}
            </div>
            <div className="mt-1 font-mono text-[12px] text-text-primary">{formatUsage(event)}</div>
          </div>
        ) : null}

        {item?.block ? (
          <section className="mt-4">
            <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase text-text-muted">
                {t("agent.content")}
              </span>
              {item.block.toolName ? <Badge variant="warning">{item.block.toolName}</Badge> : null}
              {item.block.toolCallId ? <Badge>{item.block.toolCallId}</Badge> : null}
              {item.block.status ? <Badge>{item.block.status}</Badge> : null}
            </div>
            <BlockText block={item.block} />
          </section>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={!item?.block?.text}
          onClick={() => {
            if (item?.block?.text) {
              void navigator.clipboard.writeText(item.block.text);
            }
          }}
        >
          <Copy className="size-3.5" />
          {t("agent.copyContent")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!recordId}
          onClick={() => {
            if (recordId) {
              onOpenRawJson(recordId);
            }
          }}
        >
          <ExternalLink className="size-3.5" />
          {t("agent.openJson")}
        </Button>
      </div>
    </aside>
  );
};

export const AgentSessionView = ({
  session,
  selectedRecordId,
  onSelectRecord,
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
  const highlightedRecordId = selectedItem?.recordId ?? selectedEvent?.recordId ?? selectedRecordId;
  const selectedConversationId = selectedItem?.id;

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    conversationRefs.current
      .get(selectedConversationId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedConversationId]);

  const handleSelectTimelineEvent = (eventId: string) => {
    const event = eventById.get(eventId);
    const conversationItemId = event?.conversationItemIds[0];

    setDetailSelection(
      conversationItemId
        ? { kind: "conversation", id: conversationItemId }
        : { kind: "event", id: eventId },
    );
  };

  return (
    <div className="flex flex-col gap-3">
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

      <div className="grid gap-3 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>{t("agent.timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[72vh] overflow-auto p-2">
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
                    onSelect={(itemId) => setDetailSelection({ kind: "conversation", id: itemId })}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {detailSelection ? (
        <DetailPanel
          selection={detailSelection}
          event={selectedEvent}
          item={selectedItem}
          onClose={() => setDetailSelection(null)}
          onOpenRawJson={onSelectRecord}
        />
      ) : null}
    </div>
  );
};
