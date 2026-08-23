import type {
  AgentTrajectoryPresentation,
  AgentTrajectoryPresentationGroup,
  AgentTrajectoryPresentationItem,
} from "./trajectory-presentation";
import {
  trajectoryRangesOverlap,
  type AgentTrajectoryTimeRange,
  validTrajectoryRange,
} from "./trajectory-time";

export const agentTrajectoryFilterKinds = [
  "all",
  "user",
  "system",
  "assistant",
  "reasoning",
  "tool",
  "subagent",
  "compaction",
] as const;

export type AgentTrajectoryFilterKind = (typeof agentTrajectoryFilterKinds)[number];

export const agentTrajectoryFilterStatuses = [
  "all",
  "completed",
  "running",
  "failed",
  "aborted",
] as const;

export type AgentTrajectoryFilterStatus = (typeof agentTrajectoryFilterStatuses)[number];

export interface AgentTrajectoryPresentationFilter {
  readonly query?: string;
  readonly kind?: AgentTrajectoryFilterKind;
  readonly status?: AgentTrajectoryFilterStatus;
  readonly timeRange?: AgentTrajectoryTimeRange | null;
}

export interface AgentTrajectoryLedgerTurnHeader {
  readonly type: "turn-header";
  readonly group: AgentTrajectoryPresentationGroup;
}

export interface AgentTrajectoryLedgerItemRow {
  readonly type: "item";
  readonly group: AgentTrajectoryPresentationGroup;
  readonly item: AgentTrajectoryPresentationItem;
  readonly positionInSet: number;
  readonly setSize: number;
}

export type AgentTrajectoryLedgerRow =
  | AgentTrajectoryLedgerTurnHeader
  | AgentTrajectoryLedgerItemRow;

export interface FilteredAgentTrajectoryPresentation {
  readonly visibleItems: readonly AgentTrajectoryPresentationItem[];
  readonly ledgerRows: readonly AgentTrajectoryLedgerRow[];
}

const matchesFilter = (
  item: AgentTrajectoryPresentationItem,
  query: string,
  kind: AgentTrajectoryFilterKind,
  status: AgentTrajectoryFilterStatus,
  timeRange: AgentTrajectoryTimeRange | null,
) => {
  if (kind !== "all" && item.item.kind !== kind) {
    return false;
  }
  if (status !== "all" && item.item.status !== status) {
    return false;
  }
  if (query && !item.searchText.includes(query)) {
    return false;
  }
  return !timeRange || !item.interval || trajectoryRangesOverlap(item.interval, timeRange);
};

export const filterAgentTrajectoryPresentation = (
  presentation: AgentTrajectoryPresentation,
  filter: AgentTrajectoryPresentationFilter = {},
): FilteredAgentTrajectoryPresentation => {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const kind = filter.kind ?? "all";
  const status = filter.status ?? "all";
  const timeRange = validTrajectoryRange(filter.timeRange);
  const visibleItems: AgentTrajectoryPresentationItem[] = [];
  const visibleItemSet = new Set<AgentTrajectoryPresentationItem>();
  for (const item of presentation.items) {
    if (matchesFilter(item, query, kind, status, timeRange)) {
      visibleItems.push(item);
      visibleItemSet.add(item);
    }
  }

  const ledgerRows: AgentTrajectoryLedgerRow[] = [];
  const setSize = visibleItems.length;
  let positionInSet = 0;
  for (const group of presentation.groups) {
    const visibleGroupItems = group.items.filter((item) => visibleItemSet.has(item));
    if (visibleGroupItems.length === 0) {
      continue;
    }
    ledgerRows.push({ type: "turn-header", group });
    for (const item of visibleGroupItems) {
      positionInSet += 1;
      ledgerRows.push({ type: "item", group, item, positionInSet, setSize });
    }
  }

  return { visibleItems, ledgerRows };
};
