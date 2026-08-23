import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentCanonicalSelection,
  AgentSessionDetail,
  AgentSessionModel,
  AgentTrajectoryItem,
  AgentTrajectoryItemKind,
  AgentTrajectoryTokenUsage,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "./types";
import {
  finiteTrajectoryNumber,
  trajectoryRangesOverlap,
  type AgentTrajectoryTimeRange,
  validTrajectoryRange,
} from "./trajectory-time";

export type { AgentTrajectoryTimeRange } from "./trajectory-time";

const agentTrajectoryWarningKindOrder = {
  "missing-timestamp": true,
  "missing-turn-start": true,
  "reversed-timestamp": true,
  "unpaired-tool-call": true,
  "unpaired-tool-result": true,
  "unpaired-tool-completion": true,
  "duplicate-tool-call-id": true,
  "duplicate-tool-result-id": true,
  "duplicate-tool-completion-id": true,
  "open-turn": true,
  "unattached-token-usage": true,
} as const satisfies Record<AgentTrajectoryWarning["kind"], true>;

export const agentTrajectoryWarningKinds = Object.freeze(
  Object.keys(agentTrajectoryWarningKindOrder) as AgentTrajectoryWarning["kind"][],
);

const TRAJECTORY_DISPLAY_CHARACTER_LIMIT = 240;
const SINGLE_POINT_DOMAIN_DURATION_MS = 1;
const UNASSIGNED_GROUP_ID = "unassigned";

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

export type AgentTrajectoryLane = "activity" | "model" | "tool";

export interface AgentTrajectoryPresentationSummary {
  readonly turns: number;
  readonly events: number;
  readonly tools: number;
  readonly failures: number;
  readonly durationMs?: number;
  readonly tokens: AgentTrajectoryTokenUsage;
  readonly warningCount: number;
}

export interface AgentTrajectoryPresentationItem {
  readonly ordinal: number;
  readonly item: AgentTrajectoryItem;
  readonly detail: AgentSessionDetail | null;
  readonly summary: string;
  readonly searchText: string;
  readonly lane: AgentTrajectoryLane;
  readonly interval: AgentTrajectoryTimeRange | null;
  readonly warningGroups: readonly AgentTrajectoryWarningGroup[];
  readonly turn: AgentTrajectoryTurn | null;
}

export interface AgentTrajectoryPresentationGroup {
  readonly ordinal: number;
  readonly id: string;
  readonly turn: AgentTrajectoryTurn | null;
  readonly items: readonly AgentTrajectoryPresentationItem[];
}

export interface AgentTrajectoryWarningGroup {
  readonly warning: AgentTrajectoryWarning;
  readonly count: number;
}

export interface AgentTrajectoryPresentation {
  readonly items: readonly AgentTrajectoryPresentationItem[];
  readonly groups: readonly AgentTrajectoryPresentationGroup[];
  readonly summary: AgentTrajectoryPresentationSummary;
  readonly unattachedWarningGroups: readonly AgentTrajectoryWarningGroup[];
  readonly timeDomain: AgentTrajectoryTimeRange | null;
  readonly timedItemCount: number;
}

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

interface PresentationItemDraft {
  item: AgentTrajectoryItem;
  detail: AgentSessionDetail | null;
  summary: string;
  lane: AgentTrajectoryLane;
  interval: AgentTrajectoryTimeRange | null;
  warningGroups: WarningGroupCollector;
  turn: AgentTrajectoryTurn | null;
}

interface WarningCandidate {
  draft: PresentationItemDraft;
  callId?: string;
}

interface WarningCandidateGroup {
  uniqueCandidate: PresentationItemDraft | null;
  candidatesByCallId: Map<string, PresentationItemDraft | null>;
}

interface WarningGroupDraft {
  warning: AgentTrajectoryWarning;
  count: number;
}

interface WarningGroupCollector {
  groups: WarningGroupDraft[];
  groupsByKind: Map<AgentTrajectoryWarning["kind"], WarningGroupDraft>;
}

interface PresentationGroupDraft {
  id: string;
  turn: AgentTrajectoryTurn | null;
  items: PresentationItemDraft[];
}

const finiteNonNegativeNumber = (value: number | undefined) => {
  const number = finiteTrajectoryNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
};

const nonEmptyText = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : undefined;
};

const nonEmptyCallId = (value: string | undefined) =>
  value !== undefined && value.length > 0 ? value : undefined;

export const truncateTrajectoryDisplayText = (text: string) => {
  if (text.length <= TRAJECTORY_DISPLAY_CHARACTER_LIMIT) {
    return text;
  }
  return `${truncateAtCodePointBoundary(text, TRAJECTORY_DISPLAY_CHARACTER_LIMIT - 1)}…`;
};

const boundedNonEmptyText = (value: string | undefined) => {
  const text = nonEmptyText(value);
  return text ? truncateTrajectoryDisplayText(text) : undefined;
};

const selectionKey = (selection: AgentCanonicalSelection) =>
  JSON.stringify([
    selection.kind,
    selection.recordId,
    selection.kind === "record" ? null : selection.id,
  ]);

const toolSelections = (item: AgentTrajectoryItem) => {
  if (item.kind !== "tool") {
    return [item.selection];
  }
  return [item.selection, item.callSelection, item.resultSelection, item.completionSelection];
};

const warningCallId = (warning: AgentTrajectoryWarning) => {
  if (!("callId" in warning)) {
    return undefined;
  }
  return nonEmptyCallId(warning.callId);
};

const summaryFor = (item: AgentTrajectoryItem, detail: AgentSessionDetail | null) => {
  const event = detail?.event;
  const summary =
    nonEmptyText(event?.preview) ??
    nonEmptyText(event?.label) ??
    (item.kind === "tool" ? nonEmptyText(item.toolName) : undefined);
  return summary ? truncateTrajectoryDisplayText(summary) : "";
};

const laneFor = (kind: AgentTrajectoryItemKind): AgentTrajectoryLane => {
  switch (kind) {
    case "user":
    case "system":
    case "compaction":
      return "activity";
    case "assistant":
    case "reasoning":
      return "model";
    case "tool":
    case "subagent":
      return "tool";
  }
};

const intervalFor = (item: AgentTrajectoryItem): AgentTrajectoryTimeRange | null => {
  if (item.kind !== "tool") {
    const timestamp = finiteTrajectoryNumber(item.timestamp);
    return timestamp === undefined ? null : { start: timestamp, end: timestamp };
  }

  const startedAt = finiteTrajectoryNumber(item.startedAt);
  const endedAt = finiteTrajectoryNumber(item.endedAt);
  if (startedAt !== undefined && endedAt !== undefined) {
    return startedAt <= endedAt ? { start: startedAt, end: endedAt } : null;
  }

  const point = finiteTrajectoryNumber(item.timestamp);
  return point === undefined ? null : { start: point, end: point };
};

const searchTextFor = (
  item: AgentTrajectoryItem,
  detail: AgentSessionDetail | null,
  turn: AgentTrajectoryTurn | null,
) => {
  const text = [
    detail?.event.label,
    detail?.event.preview,
    item.kind,
    item.status,
    item.kind === "tool" ? item.toolName : undefined,
    item.kind === "tool" ? item.callId : undefined,
    `line ${item.lineNumber}`,
    String(item.lineNumber),
    turn?.id,
    turn?.turnIndex === undefined ? undefined : `turn ${turn.turnIndex}`,
    item.turnIndex === undefined ? undefined : `turn ${item.turnIndex}`,
  ];
  const parts: string[] = [];
  for (const value of text) {
    const bounded = boundedNonEmptyText(value);
    if (bounded) {
      parts.push(bounded);
    }
  }
  return parts.join("\n").toLowerCase();
};

const addCandidate = (
  candidatesBySelection: Map<string, WarningCandidateGroup>,
  candidate: WarningCandidate,
  selection: AgentCanonicalSelection | undefined,
  seenKeys: Set<string>,
) => {
  if (!selection) {
    return;
  }
  const key = selectionKey(selection);
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);
  let group = candidatesBySelection.get(key);
  if (!group) {
    group = { uniqueCandidate: candidate.draft, candidatesByCallId: new Map() };
    candidatesBySelection.set(key, group);
  } else if (group.uniqueCandidate !== candidate.draft) {
    group.uniqueCandidate = null;
  }

  const callId = candidate.callId;
  if (callId === undefined) {
    return;
  }
  const candidateForCallId = group.candidatesByCallId.get(callId);
  if (candidateForCallId === undefined) {
    group.candidatesByCallId.set(callId, candidate.draft);
    return;
  }
  if (candidateForCallId !== candidate.draft) {
    group.candidatesByCallId.set(callId, null);
  }
};

const createWarningGroupCollector = (): WarningGroupCollector => ({
  groups: [],
  groupsByKind: new Map(),
});

const addWarningToGroups = (collector: WarningGroupCollector, warning: AgentTrajectoryWarning) => {
  const existing = collector.groupsByKind.get(warning.kind);
  if (existing) {
    existing.count += 1;
    return;
  }
  if (collector.groups.length === agentTrajectoryWarningKinds.length) {
    return;
  }
  const group = { warning, count: 1 };
  collector.groups.push(group);
  collector.groupsByKind.set(warning.kind, group);
};

const associateWarnings = (
  warnings: readonly AgentTrajectoryWarning[],
  candidatesBySelection: ReadonlyMap<string, WarningCandidateGroup>,
  unattachedWarningGroups: WarningGroupCollector,
) => {
  for (const warning of warnings) {
    const group = candidatesBySelection.get(selectionKey(warning.selection));
    if (!group) {
      addWarningToGroups(unattachedWarningGroups, warning);
      continue;
    }
    const callId = warningCallId(warning);
    const candidate =
      callId === undefined ? group.uniqueCandidate : group.candidatesByCallId.get(callId);
    if (!candidate) {
      addWarningToGroups(unattachedWarningGroups, warning);
      continue;
    }
    addWarningToGroups(candidate.warningGroups, warning);
  }
};

const sumKnownTurnDurations = (turns: readonly AgentTrajectoryTurn[]) => {
  let hasDuration = false;
  let total = 0;
  for (const turn of turns) {
    const duration = finiteNonNegativeNumber(turn.durationMs);
    if (duration === undefined) {
      continue;
    }
    hasDuration = true;
    total = Math.min(Number.MAX_VALUE, total + duration);
  }
  return hasDuration ? total : undefined;
};

const summaryTokenKeys = [
  "inputTokens",
  "outputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningOutputTokens",
] as const;

const summaryForPresentation = (
  model: AgentSessionModel,
  toolCount: number,
  failedToolCount: number,
): AgentTrajectoryPresentationSummary => {
  const tokenUsage = model.trajectory.stats.tokenUsage;
  const tokens: Partial<Record<(typeof summaryTokenKeys)[number], number>> = {};
  for (const key of summaryTokenKeys) {
    const value = finiteNonNegativeNumber(tokenUsage[key]);
    if (value !== undefined) {
      tokens[key] = value;
    }
  }
  const durationMs = sumKnownTurnDurations(model.trajectory.turns);
  return {
    turns: model.trajectory.turns.length,
    events: model.trajectory.items.length,
    tools: toolCount,
    failures: failedToolCount,
    ...(durationMs === undefined ? {} : { durationMs }),
    tokens,
    warningCount: model.trajectory.warnings.length,
  };
};

const addDomainPoint = (domain: { start?: number; end?: number }, value: number | undefined) => {
  const point = finiteTrajectoryNumber(value);
  if (point === undefined) {
    return;
  }
  domain.start = domain.start === undefined ? point : Math.min(domain.start, point);
  domain.end = domain.end === undefined ? point : Math.max(domain.end, point);
};

const domainFor = (
  items: readonly AgentTrajectoryPresentationItem[],
  turns: readonly AgentTrajectoryTurn[],
) => {
  const domain: { start?: number; end?: number } = {};
  for (const item of items) {
    addDomainPoint(domain, item.interval?.start);
    addDomainPoint(domain, item.interval?.end);
  }
  for (const turn of turns) {
    addDomainPoint(domain, turn.startedAt);
    addDomainPoint(domain, turn.endedAt);
  }
  if (domain.start === undefined || domain.end === undefined) {
    return null;
  }
  if (domain.start !== domain.end) {
    return { start: domain.start, end: domain.end };
  }
  const expandedEnd = domain.end + SINGLE_POINT_DOMAIN_DURATION_MS;
  if (Number.isFinite(expandedEnd) && expandedEnd > domain.end) {
    return { start: domain.start, end: expandedEnd };
  }
  const expandedStart = domain.start - SINGLE_POINT_DOMAIN_DURATION_MS;
  return Number.isFinite(expandedStart) && expandedStart < domain.start
    ? { start: expandedStart, end: domain.end }
    : { start: domain.start, end: domain.end };
};

export const createAgentTrajectoryPresentation = (
  model: AgentSessionModel,
): AgentTrajectoryPresentation => {
  const trajectory = model.trajectory;
  const turnById = new Map(trajectory.turns.map((turn) => [turn.id, turn]));

  const drafts: PresentationItemDraft[] = [];
  const candidatesBySelection = new Map<string, WarningCandidateGroup>();
  let toolCount = 0;
  let failedToolCount = 0;
  for (const item of trajectory.items) {
    if (item.kind === "tool") {
      toolCount += 1;
      if (item.status === "failed") {
        failedToolCount += 1;
      }
    }
    const detail = model.resolveDetail(item.selection);
    const turn = item.turnId ? (turnById.get(item.turnId) ?? null) : null;
    const draft: PresentationItemDraft = {
      item,
      detail,
      summary: summaryFor(item, detail),
      lane: laneFor(item.kind),
      interval: intervalFor(item),
      warningGroups: createWarningGroupCollector(),
      turn,
    };
    drafts.push(draft);
    const callId = item.kind === "tool" ? nonEmptyCallId(item.callId) : undefined;
    const candidate: WarningCandidate = {
      draft,
      ...(callId === undefined ? {} : { callId }),
    };
    const candidateKeys = new Set<string>();
    for (const selection of toolSelections(item)) {
      addCandidate(candidatesBySelection, candidate, selection, candidateKeys);
    }
  }

  const unattachedWarningGroups = createWarningGroupCollector();
  associateWarnings(trajectory.warnings, candidatesBySelection, unattachedWarningGroups);

  const groupDrafts: PresentationGroupDraft[] = [];
  const groupDraftById = new Map<string, PresentationGroupDraft>();
  for (const turn of trajectory.turns) {
    const group = { id: turn.id, turn, items: [] };
    groupDrafts.push(group);
    groupDraftById.set(turn.id, group);
  }

  const unassignedGroup: PresentationGroupDraft = {
    id: UNASSIGNED_GROUP_ID,
    turn: null,
    items: [],
  };
  for (const draft of drafts) {
    const group = draft.item.turnId ? groupDraftById.get(draft.item.turnId) : undefined;
    (group ?? unassignedGroup).items.push(draft);
  }
  if (unassignedGroup.items.length > 0) {
    groupDrafts.push(unassignedGroup);
  }

  const presentationItems: AgentTrajectoryPresentationItem[] = [];
  const presentationItemByDraft = new Map<PresentationItemDraft, AgentTrajectoryPresentationItem>();
  for (const draft of drafts) {
    const item: AgentTrajectoryPresentationItem = {
      ordinal: presentationItems.length,
      item: draft.item,
      detail: draft.detail,
      summary: draft.summary,
      searchText: searchTextFor(draft.item, draft.detail, draft.turn),
      lane: draft.lane,
      interval: draft.interval,
      warningGroups: draft.warningGroups.groups,
      turn: draft.turn,
    };
    presentationItems.push(item);
    presentationItemByDraft.set(draft, item);
  }

  const groups: AgentTrajectoryPresentationGroup[] = [];
  for (const groupDraft of groupDrafts) {
    const items: AgentTrajectoryPresentationItem[] = [];
    for (const draft of groupDraft.items) {
      const item = presentationItemByDraft.get(draft);
      if (item) {
        items.push(item);
      }
    }
    groups.push({ ordinal: groups.length, id: groupDraft.id, turn: groupDraft.turn, items });
  }

  let timedItemCount = 0;
  for (const item of presentationItems) {
    if (item.interval) {
      timedItemCount += 1;
    }
  }

  return {
    items: presentationItems,
    groups,
    summary: summaryForPresentation(model, toolCount, failedToolCount),
    unattachedWarningGroups: unattachedWarningGroups.groups,
    timeDomain: domainFor(presentationItems, trajectory.turns),
    timedItemCount,
  };
};

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
    if (!matchesFilter(item, query, kind, status, timeRange)) {
      continue;
    }
    visibleItems.push(item);
    visibleItemSet.add(item);
  }

  const ledgerRows: AgentTrajectoryLedgerRow[] = [];
  const setSize = visibleItems.length;
  let positionInSet = 0;
  for (const group of presentation.groups) {
    const visibleGroupItems: AgentTrajectoryPresentationItem[] = [];
    for (const item of group.items) {
      if (visibleItemSet.has(item)) {
        visibleGroupItems.push(item);
      }
    }
    if (visibleGroupItems.length === 0) {
      continue;
    }
    ledgerRows.push({ type: "turn-header", group });
    for (const item of visibleGroupItems) {
      positionInSet += 1;
      ledgerRows.push({
        type: "item",
        group,
        item,
        positionInSet,
        setSize,
      });
    }
  }

  return { visibleItems, ledgerRows };
};
