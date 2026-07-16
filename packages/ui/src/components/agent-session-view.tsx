import { PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { JsonlRecord } from "@unquote/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentConversationItem, AgentSession, AgentTimelineEvent } from "../lib/agent-session";
import {
  getExpandedStringifiedPaths,
  type ExpandedStringifiedPathsByRecord,
} from "../lib/record-expansion";
import type { RecordInsight } from "../lib/record-insight";
import { resolveHydratedRecord } from "../lib/record-resolution";
import type { SearchMatch, TreeRow } from "../lib/tree";
import type { AgentDetailSelection as WorkspaceAgentDetailSelection } from "../lib/workspace-selection";
import { AgentConversationPane } from "./agent-conversation-pane";
import { categoryConfig, formatTimestamp, roleConfig } from "./agent-session-format";
import { AgentTimelinePane } from "./agent-timeline-pane";
import { Badge } from "./badge";
import { Button } from "./button";
import { CardHeader, CardTitle } from "./card";
import { JsonTree } from "./json-tree";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizablePanelGroupLayout,
} from "./resizable";

const noSearchMatches: SearchMatch[] = [];

export type AgentDetailSelection = WorkspaceAgentDetailSelection;

interface AgentSessionViewProps {
  session: AgentSession;
  recordsById: ReadonlyMap<string, JsonlRecord>;
  hydratedRecords: ReadonlyMap<number, JsonlRecord>;
  recordInsights: ReadonlyMap<string, RecordInsight>;
  expandedStringifiedPathsByRecord: ExpandedStringifiedPathsByRecord;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  detailSelection: AgentDetailSelection | null;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onTogglePath: (recordId: string, path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  onCopyError: (record: JsonlRecord) => void;
  onSelectNode: (record: JsonlRecord, row: TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
}

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
  expandedStringifiedPaths: ReadonlySet<string>;
  selectedPath: { recordId: string; pathText: string } | null;
  focusedPath: { recordId: string; pathText: string } | null;
  onCollapse: () => void;
  onTogglePath: (recordId: string, path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyRawLine: (record: JsonlRecord) => void;
  onCopyError: (record: JsonlRecord) => void;
  onSelectNode: (record: JsonlRecord, row: TreeRow) => void;
  onHydrateRecord: (record: JsonlRecord) => void;
  onClearFocus: () => void;
}) => {
  const { locale, t } = useTranslation();
  const role = item ? roleConfig(item.role, t) : null;
  const category = categoryConfig(event.category, t);
  const RoleIcon = role?.icon;
  const CategoryIcon = category.icon;
  const recordId = event.recordId;
  const timestamp = formatTimestamp(event.timestamp, event.timestampLabel, locale);

  return (
    <section
      role="complementary"
      aria-label={t("agent.rawJsonl")}
      className="flex h-full min-w-0 flex-col overflow-hidden border border-border bg-surface-100"
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
          className="uq-icon-button h-7 w-7 px-0"
          onClick={onCollapse}
          aria-label={t("agent.collapseRawData")}
        >
          <PanelRightClose className="size-3.5" />
        </Button>
      </CardHeader>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {record ? (
          <JsonTree
            record={record}
            insight={insight}
            expandedStringifiedPaths={expandedStringifiedPaths}
            eager
            searchMatches={noSearchMatches}
            activeMatch={null}
            scrollTarget={null}
            selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
            focusedPath={focusedPath?.recordId === record.id ? focusedPath : null}
            onTogglePath={onTogglePath}
            onCopyRecord={onCopyRecord}
            onCopyRawLine={onCopyRawLine}
            onCopyError={onCopyError}
            onSelectNode={onSelectNode}
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

export const AgentSessionView = ({
  session,
  recordsById,
  hydratedRecords,
  recordInsights,
  expandedStringifiedPathsByRecord,
  selectedPath,
  focusedPath,
  detailSelection,
  onDetailSelectionChange,
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
  const [detailOpen, setDetailOpen] = useState(true);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellWidth, setShellWidth] = useState(0);
  const selectedItem =
    detailSelection?.kind === "conversation" ? conversationById.get(detailSelection.id) : undefined;
  const selectedEvent =
    detailSelection?.kind === "event"
      ? eventById.get(detailSelection.id)
      : selectedItem
        ? eventById.get(selectedItem.eventId)
        : detailSelection
          ? eventByRecordId.get(detailSelection.recordId)
          : undefined;
  const detailEvent = detailOpen ? (selectedEvent ?? session.events[0]) : undefined;
  const detailItem =
    selectedItem ??
    (detailEvent?.conversationItemIds[0]
      ? conversationById.get(detailEvent.conversationItemIds[0])
      : undefined);
  const selectedConversationId = detailItem?.id;
  const highlightedRecordId = detailSelection?.recordId ?? detailEvent?.recordId;
  const rawCollapsed = !detailEvent && session.events.length > 0;
  const detailRecord = detailEvent ? recordsById.get(detailEvent.recordId) : undefined;
  const renderedDetailRecord = detailRecord
    ? resolveHydratedRecord(detailRecord, hydratedRecords)
    : undefined;
  const panelIds = useMemo(
    () => [
      ...(timelineCollapsed ? [] : ["timeline"]),
      "conversation",
      ...(detailEvent ? ["raw"] : []),
    ],
    [detailEvent, timelineCollapsed],
  );
  const { defaultLayout, onLayoutChanged } = useResizablePanelGroupLayout({
    id: "uq-agent-workspace",
    panelIds,
  });

  useEffect(() => {
    if (detailSelection) {
      setDetailOpen(true);
    }
  }, [detailSelection]);

  // The three panels resize side by side only when the shell is wide enough;
  // narrower shells (mobile, split source view) fall back to a stacked layout.
  useLayoutEffect(() => {
    const element = shellRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setShellWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleSelectTimelineEvent = (eventId: string) => {
    const event = eventById.get(eventId);
    const conversationItemId = event?.conversationItemIds[0];
    if (!event) {
      return;
    }

    onDetailSelectionChange(
      conversationItemId
        ? { kind: "conversation", id: conversationItemId, recordId: event.recordId }
        : { kind: "event", id: eventId, recordId: event.recordId },
    );
    setDetailOpen(true);
  };

  // Collapsing a side panel releases its grid column entirely; its expand
  // control relocates into the always-present conversation header.
  const timelineExpandControl = timelineCollapsed ? (
    <Button
      variant="ghost"
      size="sm"
      className="uq-icon-button h-7 w-7 px-0"
      onClick={() => setTimelineCollapsed(false)}
      aria-label={t("agent.expandTimeline")}
    >
      <PanelLeftOpen className="size-3.5" />
    </Button>
  ) : null;
  const rawExpandControl = rawCollapsed ? (
    <Button
      variant="ghost"
      size="sm"
      className="uq-icon-button h-7 w-7 px-0"
      onClick={() => setDetailOpen(true)}
      aria-label={t("agent.expandRawData")}
    >
      <PanelRightOpen className="size-3.5" />
    </Button>
  ) : null;

  const horizontal = shellWidth >= 832;
  const timelinePane = (
    <AgentTimelinePane
      events={session.events}
      highlightedRecordId={highlightedRecordId}
      collapsed={timelineCollapsed}
      onToggleCollapsed={() => setTimelineCollapsed((current) => !current)}
      onSelectEvent={handleSelectTimelineEvent}
    />
  );
  const conversationPane = (
    <AgentConversationPane
      items={session.conversationItems}
      eventById={eventById}
      selectedConversationId={selectedConversationId}
      detailSelection={detailSelection}
      onSelectItem={(itemId, recordId) => {
        onDetailSelectionChange({ kind: "conversation", id: itemId, recordId });
        setDetailOpen(true);
      }}
      headerStart={timelineExpandControl}
      headerEnd={rawExpandControl}
    />
  );
  const rawPane = detailEvent ? (
    <RawJsonlPanel
      event={detailEvent}
      item={detailItem}
      record={renderedDetailRecord}
      insight={recordInsights.get(detailEvent.recordId)}
      expandedStringifiedPaths={getExpandedStringifiedPaths(
        expandedStringifiedPathsByRecord,
        detailEvent.recordId,
      )}
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
  ) : null;

  return (
    <div
      ref={shellRef}
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
        <div
          className="grid overflow-hidden rounded-md border border-border bg-surface-100 sm:grid-cols-4"
          data-agent-metrics={metrics.length}
        >
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

      {horizontal ? (
        <div className="h-[calc(100vh-12rem)] min-h-[26rem]">
          <ResizablePanelGroup
            id="uq-agent-workspace"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            {timelineCollapsed ? null : (
              <>
                <ResizablePanel id="timeline" defaultSize="22%" minSize="14%" className="min-w-0">
                  {timelinePane}
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel
              id="conversation"
              defaultSize={detailEvent ? "52%" : "78%"}
              minSize="28%"
              className="min-w-0"
            >
              {conversationPane}
            </ResizablePanel>
            {detailEvent ? (
              <>
                <ResizableHandle />
                <ResizablePanel id="raw" defaultSize="26%" minSize="16%" className="min-w-0">
                  {rawPane}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {timelineCollapsed ? null : <div className="h-[45vh]">{timelinePane}</div>}
          <div className="h-[62vh]">{conversationPane}</div>
          {detailEvent ? <div className="h-[62vh]">{rawPane}</div> : null}
        </div>
      )}
    </div>
  );
};
