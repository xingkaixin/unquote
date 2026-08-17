import { useDeferredValue, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { isFullRecord, isParsed, stringifyJsonNodeBounded } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import type { TrajectoryFilters } from "../hooks/use-trajectory-filters";
import type {
  AgentCanonicalSelection,
  AgentDetailSelection,
  AgentSessionModel,
} from "../lib/agent-session/types";
import {
  agentTrajectoryFilterKinds,
  agentTrajectoryFilterStatuses,
  createAgentTrajectoryPresentation,
  filterAgentTrajectoryPresentation,
  type AgentTrajectoryFilterKind,
  type AgentTrajectoryFilterStatus,
  type AgentTrajectoryPresentationItem,
  type AgentTrajectoryPresentationSummary,
} from "../lib/agent-session/trajectory-presentation";
import { AgentTrajectoryDetail, type TrajectoryRawJson } from "./agent-trajectory-detail";
import { formatTrajectoryDuration } from "./agent-trajectory-format";
import { AgentTrajectoryLedger } from "./agent-trajectory-ledger";
import { AgentTrajectoryOverview } from "./agent-trajectory-overview";
import { Button } from "./button";
import { WorkspaceColumns } from "./workspace-columns";

const MISSING_METRIC_VALUE = "—";

const filterKindMessageKey: Record<AgentTrajectoryFilterKind, MessageKey> = {
  all: "trajectory.kind.all",
  user: "trajectory.kind.user",
  system: "trajectory.kind.system",
  assistant: "trajectory.kind.assistant",
  reasoning: "trajectory.kind.reasoning",
  tool: "trajectory.kind.tool",
  subagent: "trajectory.kind.subagent",
  compaction: "trajectory.kind.compaction",
};

const filterStatusMessageKey: Record<AgentTrajectoryFilterStatus, MessageKey> = {
  all: "trajectory.kind.all",
  completed: "trajectory.status.completed",
  running: "trajectory.status.running",
  failed: "trajectory.status.failed",
  aborted: "trajectory.status.aborted",
};

const isAgentTrajectoryFilterKind = (value: string): value is AgentTrajectoryFilterKind =>
  agentTrajectoryFilterKinds.some((kind) => kind === value);

const isAgentTrajectoryFilterStatus = (value: string): value is AgentTrajectoryFilterStatus =>
  agentTrajectoryFilterStatuses.some((status) => status === value);

const formatMetricNumber = (value: number | undefined, locale: string) => {
  if (value === undefined || !Number.isFinite(value)) {
    return MISSING_METRIC_VALUE;
  }
  return new Intl.NumberFormat(locale).format(value);
};

const MetricChip = ({
  id,
  label,
  actionLabel,
  onAction,
  children,
}: {
  id: string;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) => {
  const content = (
    <>
      <span className="uq-label">{label}</span>
      <span className="font-mono text-[12px] text-text-primary">{children}</span>
    </>
  );

  if (onAction) {
    return (
      <button
        type="button"
        data-trajectory-metric={id}
        aria-label={actionLabel}
        title={actionLabel}
        onClick={onAction}
        className="inline-flex items-baseline gap-1.5 rounded-sm px-1 -mx-1 text-left hover:bg-surface-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {content}
      </button>
    );
  }

  return (
    <span data-trajectory-metric={id} className="inline-flex items-baseline gap-1.5">
      {content}
    </span>
  );
};

interface TrajectoryHeaderBarProps {
  summary: AgentTrajectoryPresentationSummary;
  query: string;
  kind: AgentTrajectoryFilterKind;
  status: AgentTrajectoryFilterStatus;
  hasTimeRange: boolean;
  visibleCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: AgentTrajectoryFilterKind) => void;
  onStatusChange: (status: AgentTrajectoryFilterStatus) => void;
  onFilterFailures: () => void;
  onClear: () => void;
}

const TrajectoryHeaderBar = ({
  summary,
  query,
  kind,
  status,
  hasTimeRange,
  visibleCount,
  totalCount,
  onQueryChange,
  onKindChange,
  onStatusChange,
  onFilterFailures,
  onClear,
}: TrajectoryHeaderBarProps) => {
  const { locale, t } = useTranslation();
  const duration = formatTrajectoryDuration(summary.durationMs, locale) || MISSING_METRIC_VALUE;
  const hasFilters = query.length > 0 || kind !== "all" || status !== "all" || hasTimeRange;
  const selectClass =
    "h-7 rounded-md border border-border bg-surface-50 px-2 text-[12px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent";

  return (
    <section
      aria-label={t("trajectory.summary")}
      data-trajectory-summary
      className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-100"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
        <MetricChip id="turns" label={t("trajectory.metric.turns")}>
          {formatMetricNumber(summary.turns, locale)}
        </MetricChip>
        <MetricChip id="events" label={t("trajectory.metric.events")}>
          {formatMetricNumber(summary.events, locale)}
        </MetricChip>
        <MetricChip id="tools" label={t("trajectory.metric.tools")}>
          {formatMetricNumber(summary.tools, locale)}
        </MetricChip>
        <MetricChip
          id="failures"
          label={t("trajectory.metric.failures")}
          {...(summary.failures > 0
            ? { onAction: onFilterFailures, actionLabel: t("trajectory.filterFailures") }
            : {})}
        >
          {formatMetricNumber(summary.failures, locale)}
        </MetricChip>
        <MetricChip id="duration" label={t("trajectory.metric.duration")}>
          {duration}
        </MetricChip>
        <MetricChip id="tokens" label={t("trajectory.metric.tokens")}>
          <span className="inline-flex flex-wrap gap-x-2">
            <span>
              {t("trajectory.token.input")} {formatMetricNumber(summary.tokens.inputTokens, locale)}
            </span>
            <span>
              {t("trajectory.token.output")}{" "}
              {formatMetricNumber(summary.tokens.outputTokens, locale)}
            </span>
            {summary.tokens.cacheReadInputTokens === undefined ? null : (
              <span className="text-text-secondary">
                {t("trajectory.token.cacheRead")}{" "}
                {formatMetricNumber(summary.tokens.cacheReadInputTokens, locale)}
              </span>
            )}
            {summary.tokens.cacheCreationInputTokens === undefined ? null : (
              <span className="text-text-secondary">
                {t("trajectory.token.cacheWrite")}{" "}
                {formatMetricNumber(summary.tokens.cacheCreationInputTokens, locale)}
              </span>
            )}
            {summary.tokens.reasoningOutputTokens === undefined ? null : (
              <span className="text-text-secondary">
                {t("trajectory.token.reasoning")}{" "}
                {formatMetricNumber(summary.tokens.reasoningOutputTokens, locale)}
              </span>
            )}
          </span>
        </MetricChip>
        <span
          data-trajectory-warning-count
          className="inline-flex items-baseline gap-1.5 font-mono text-[10.5px] text-text-secondary"
        >
          {t("trajectory.warnings")} {formatMetricNumber(summary.warningCount, locale)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border px-3 py-1.5">
        <input
          type="search"
          value={query}
          aria-label={t("trajectory.search")}
          placeholder={t("trajectory.searchPlaceholder")}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          className="h-7 min-w-[160px] flex-1 rounded-md border border-border bg-surface-50 px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <select
          value={kind}
          aria-label={t("trajectory.kind")}
          onChange={(event) => {
            const nextKind = event.currentTarget.value;
            if (isAgentTrajectoryFilterKind(nextKind)) {
              onKindChange(nextKind);
            }
          }}
          className={selectClass}
        >
          {agentTrajectoryFilterKinds.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(filterKindMessageKey[candidate])}
            </option>
          ))}
        </select>
        <select
          value={status}
          aria-label={t("trajectory.statusFilter")}
          onChange={(event) => {
            const nextStatus = event.currentTarget.value;
            if (isAgentTrajectoryFilterStatus(nextStatus)) {
              onStatusChange(nextStatus);
            }
          }}
          className={selectClass}
        >
          {agentTrajectoryFilterStatuses.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(filterStatusMessageKey[candidate])}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" disabled={!hasFilters} onClick={onClear}>
          {t("trajectory.clearFilters")}
        </Button>
        <p aria-live="polite" className="m-0 font-mono text-[10.5px] text-text-tertiary">
          {t("trajectory.visibleCount", { visible: visibleCount, total: totalCount })}
        </p>
      </div>
    </section>
  );
};

// Raw JSON shown inline in the detail pane stays bounded; the full Record is
// one click away.
const RAW_JSON_CHARACTER_LIMIT = 20_000;

export interface AgentTrajectoryViewProps {
  model: AgentSessionModel;
  records: readonly JsonlRecord[];
  // Streamed sources hold Preview Records; these swap in and request the
  // cached Full Record so the detail pane can show real JSON.
  resolveRecord: (record: JsonlRecord) => JsonlRecord;
  requestFullRecord: (record: JsonlRecord) => void;
  isDesktop: boolean;
  filters: TrajectoryFilters;
  detailSelection: AgentDetailSelection | null;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onOpenRecord: (selection: AgentDetailSelection, endpointRecordId: string) => void;
}

const rawRecordIdsFor = (item: AgentTrajectoryPresentationItem | null): string[] => {
  if (!item) {
    return [];
  }
  const trajectoryItem = item.item;
  const ids: string[] = [];
  if (trajectoryItem.kind === "tool") {
    const callRecordId = trajectoryItem.callSelection?.recordId;
    const resultRecordId = trajectoryItem.resultSelection?.recordId;
    if (callRecordId !== undefined) {
      ids.push(callRecordId);
    }
    if (resultRecordId !== undefined && resultRecordId !== callRecordId) {
      ids.push(resultRecordId);
    }
  }
  if (ids.length === 0) {
    ids.push(trajectoryItem.recordId);
  }
  return ids;
};

export const AgentTrajectoryView = ({
  model,
  records,
  resolveRecord,
  requestFullRecord,
  isDesktop,
  filters,
  detailSelection,
  onDetailSelectionChange,
  onOpenRecord,
}: AgentTrajectoryViewProps) => {
  const { t } = useTranslation();
  const { query, kind, status, timeRange } = filters;
  const deferredQuery = useDeferredValue(query);
  const presentation = useMemo(() => createAgentTrajectoryPresentation(model), [model]);
  const itemsById = useMemo(
    () => new Map(presentation.items.map((item) => [item.item.id, item])),
    [presentation],
  );
  const recordById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );
  const resolveRawJson = (recordId: string): TrajectoryRawJson | null => {
    const record = recordById.get(recordId);
    if (!record || !isParsed(record)) {
      return null;
    }
    const resolved = resolveRecord(record);
    if (!isParsed(resolved)) {
      return null;
    }
    if (!isFullRecord(resolved)) {
      return { kind: "preview" };
    }
    const preview = stringifyJsonNodeBounded(resolved.node, RAW_JSON_CHARACTER_LIMIT, {
      indent: 2,
    });
    return { kind: "full", ...preview };
  };
  const filteredPresentation = useMemo(
    () =>
      filterAgentTrajectoryPresentation(presentation, {
        query: deferredQuery,
        kind,
        status,
        timeRange,
      }),
    [deferredQuery, kind, presentation, status, timeRange],
  );
  const selectedItemId = detailSelection?.kind === "trajectory" ? detailSelection.id : undefined;
  const selectedItem = selectedItemId ? (itemsById.get(selectedItemId) ?? null) : null;

  // Ask a streamed source for the Full Records of the selected item's raw
  // blocks; the cache update re-renders the detail pane with the JSON.
  useEffect(() => {
    for (const recordId of rawRecordIdsFor(selectedItem)) {
      const record = recordById.get(recordId);
      if (record && isParsed(record) && !isFullRecord(resolveRecord(record))) {
        requestFullRecord(record);
      }
    }
  }, [recordById, requestFullRecord, resolveRecord, selectedItem]);

  const selectItem = (itemId: string) => {
    const selection = model.selectTrajectory(itemId);
    if (!selection || selection.kind !== "trajectory") {
      return;
    }
    onDetailSelectionChange(selection);
  };

  const selectedTrajectorySelection = () => {
    if (!selectedItem) {
      return null;
    }

    const selection = model.selectTrajectory(selectedItem.item.id);
    return selection?.kind === "trajectory" ? selection : null;
  };

  const openSelection = (selection: AgentDetailSelection, endpoint: AgentCanonicalSelection) => {
    onOpenRecord(selection, endpoint.recordId);
  };

  const openSelectedItemSelection = (endpoint: AgentCanonicalSelection) => {
    const selection = selectedTrajectorySelection();
    if (!selection) {
      return;
    }

    openSelection(selection, endpoint);
  };

  const openUnattachedWarning = (warning: AgentCanonicalSelection) => {
    openSelection(selectedTrajectorySelection() ?? warning, warning);
  };

  return (
    <div data-trajectory-ready className="uq-agent-shell flex min-h-0 flex-1 flex-col">
      <WorkspaceColumns
        isDesktop={isDesktop}
        rightWidth={380}
        rightLabel={t("trajectory.detail")}
        center={
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 py-3 ${
              isDesktop ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"
            }`}
          >
            <TrajectoryHeaderBar
              summary={presentation.summary}
              query={query}
              kind={kind}
              status={status}
              hasTimeRange={timeRange !== null}
              visibleCount={filteredPresentation.visibleItems.length}
              totalCount={presentation.items.length}
              onQueryChange={filters.setQuery}
              onKindChange={filters.setKind}
              onStatusChange={filters.setStatus}
              onFilterFailures={() => filters.setStatus("failed")}
              onClear={filters.clear}
            />
            <AgentTrajectoryOverview
              presentation={presentation}
              timeRange={timeRange}
              onTimeRangeChange={filters.setTimeRange}
              selectedItemId={selectedItemId}
              onSelectItem={selectItem}
              className={isDesktop ? "" : "shrink-0"}
            />
            <section
              className={`flex flex-col overflow-hidden rounded-lg border border-border bg-surface-100 ${
                isDesktop ? "min-h-0 flex-1" : "h-72 shrink-0"
              }`}
            >
              <h2 className="uq-label m-0 shrink-0 border-b border-border px-3 py-2">
                {t("trajectory.ledger")}
              </h2>
              <AgentTrajectoryLedger
                rows={filteredPresentation.ledgerRows}
                selectedItemId={selectedItemId}
                onSelectItem={selectItem}
              />
            </section>
          </div>
        }
        right={
          <AgentTrajectoryDetail
            item={selectedItem}
            unattachedWarningGroups={presentation.unattachedWarningGroups}
            resolveRawJson={resolveRawJson}
            onOpenSelection={openSelectedItemSelection}
            onOpenUnattachedWarning={openUnattachedWarning}
          />
        }
      />
    </div>
  );
};
