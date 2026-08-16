import { useDeferredValue, useMemo } from "react";
import type { ReactNode } from "react";
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
  type AgentTrajectoryPresentationSummary,
} from "../lib/agent-session/trajectory-presentation";
import { AgentTrajectoryDetail } from "./agent-trajectory-detail";
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

const MetricCard = ({
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
      <span className="font-mono text-[14px] text-text-primary">{children}</span>
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
        className="flex min-w-0 flex-col gap-1.5 bg-surface-100 px-3 py-2.5 text-left hover:bg-surface-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-trajectory-metric={id}
      className="flex min-w-0 flex-col gap-1.5 bg-surface-100 px-3 py-2.5"
    >
      {content}
    </div>
  );
};

const TrajectorySummary = ({
  summary,
  isDesktop,
  onFilterFailures,
}: {
  summary: AgentTrajectoryPresentationSummary;
  isDesktop: boolean;
  onFilterFailures?: () => void;
}) => {
  const { locale, t } = useTranslation();
  const duration = formatTrajectoryDuration(summary.durationMs, locale) || MISSING_METRIC_VALUE;

  return (
    <section
      aria-label={t("trajectory.summary")}
      data-trajectory-summary
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-100${
        isDesktop ? "" : " shrink-0"
      }`}
    >
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard id="turns" label={t("trajectory.metric.turns")}>
          {formatMetricNumber(summary.turns, locale)}
        </MetricCard>
        <MetricCard id="events" label={t("trajectory.metric.events")}>
          {formatMetricNumber(summary.events, locale)}
        </MetricCard>
        <MetricCard id="tools" label={t("trajectory.metric.tools")}>
          {formatMetricNumber(summary.tools, locale)}
        </MetricCard>
        <MetricCard
          id="failures"
          label={t("trajectory.metric.failures")}
          {...(summary.failures > 0 && onFilterFailures
            ? { onAction: onFilterFailures, actionLabel: t("trajectory.filterFailures") }
            : {})}
        >
          {formatMetricNumber(summary.failures, locale)}
        </MetricCard>
        <MetricCard id="duration" label={t("trajectory.metric.duration")}>
          {duration}
        </MetricCard>
        <MetricCard id="tokens" label={t("trajectory.metric.tokens")}>
          <span className="flex flex-wrap gap-x-2 gap-y-1">
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
        </MetricCard>
      </div>
      <p
        data-trajectory-warning-count
        className="m-0 border-t border-border px-3 py-1.5 font-mono text-[10.5px] text-text-secondary"
      >
        {t("trajectory.warnings")} {formatMetricNumber(summary.warningCount, locale)}
      </p>
    </section>
  );
};

interface TrajectoryFilterControlsProps {
  query: string;
  kind: AgentTrajectoryFilterKind;
  status: AgentTrajectoryFilterStatus;
  hasTimeRange: boolean;
  visibleCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: AgentTrajectoryFilterKind) => void;
  onStatusChange: (status: AgentTrajectoryFilterStatus) => void;
  onClear: () => void;
}

const TrajectoryFilterControls = ({
  query,
  kind,
  status,
  hasTimeRange,
  visibleCount,
  totalCount,
  onQueryChange,
  onKindChange,
  onStatusChange,
  onClear,
}: TrajectoryFilterControlsProps) => {
  const { t } = useTranslation();
  const hasFilters = query.length > 0 || kind !== "all" || status !== "all" || hasTimeRange;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <h1 className="uq-label m-0">{t("trajectory.title")}</h1>
      <label className="flex flex-col gap-1.5">
        <span className="uq-label">{t("trajectory.search")}</span>
        <input
          type="search"
          value={query}
          placeholder={t("trajectory.searchPlaceholder")}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          className="h-8 rounded-md border border-border bg-surface-50 px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="uq-label">{t("trajectory.kind")}</span>
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.currentTarget.value;
            if (isAgentTrajectoryFilterKind(nextKind)) {
              onKindChange(nextKind);
            }
          }}
          className="h-8 rounded-md border border-border bg-surface-50 px-2 text-[12px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        >
          {agentTrajectoryFilterKinds.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(filterKindMessageKey[candidate])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="uq-label">{t("trajectory.statusFilter")}</span>
        <select
          value={status}
          onChange={(event) => {
            const nextStatus = event.currentTarget.value;
            if (isAgentTrajectoryFilterStatus(nextStatus)) {
              onStatusChange(nextStatus);
            }
          }}
          className="h-8 rounded-md border border-border bg-surface-50 px-2 text-[12px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        >
          {agentTrajectoryFilterStatuses.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(filterStatusMessageKey[candidate])}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasFilters}
        onClick={onClear}
        className="w-full"
      >
        {t("trajectory.clearFilters")}
      </Button>
      <p aria-live="polite" className="m-0 font-mono text-[10.5px] text-text-tertiary">
        {t("trajectory.visibleCount", { visible: visibleCount, total: totalCount })}
      </p>
    </div>
  );
};

export interface AgentTrajectoryViewProps {
  model: AgentSessionModel;
  isDesktop: boolean;
  filters: TrajectoryFilters;
  detailSelection: AgentDetailSelection | null;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onOpenRecord: (selection: AgentDetailSelection, endpointRecordId: string) => void;
}

export const AgentTrajectoryView = ({
  model,
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
        leftWidth={260}
        rightWidth={310}
        leftMobileHeight="30vh"
        rightLabel={t("trajectory.detail")}
        left={
          <TrajectoryFilterControls
            query={query}
            kind={kind}
            status={status}
            hasTimeRange={timeRange !== null}
            visibleCount={filteredPresentation.visibleItems.length}
            totalCount={presentation.items.length}
            onQueryChange={filters.setQuery}
            onKindChange={filters.setKind}
            onStatusChange={filters.setStatus}
            onClear={filters.clear}
          />
        }
        center={
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 py-3 ${
              isDesktop ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"
            }`}
          >
            <TrajectorySummary
              summary={presentation.summary}
              isDesktop={isDesktop}
              onFilterFailures={() => filters.setStatus("failed")}
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
            onOpenSelection={openSelectedItemSelection}
            onOpenUnattachedWarning={openUnattachedWarning}
          />
        }
      />
    </div>
  );
};
