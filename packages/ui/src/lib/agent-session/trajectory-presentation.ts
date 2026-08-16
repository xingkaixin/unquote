import { truncateAtCodePointBoundary } from "@unquote/core";
import type {
  AgentCanonicalSelection,
  AgentSessionDetail,
  AgentSessionModel,
  AgentTrajectoryItem,
  AgentTrajectoryItemKind,
  AgentTrajectoryStatus,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "./types";

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
const MINIMUM_BUCKET_WIDTH_PX = 6;
const MAXIMUM_BUCKET_COUNT = 512;
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

export interface AgentTrajectoryTimeRange {
  readonly start: number;
  readonly end: number;
}

export interface AgentTrajectoryPresentationSummary {
  readonly turns: number;
  readonly events: number;
  readonly tools: number;
  readonly failures: number;
  readonly durationMs?: number;
  readonly tokens: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheCreationInputTokens?: number;
    readonly cacheReadInputTokens?: number;
    readonly reasoningOutputTokens?: number;
  };
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
  readonly groupId: string;
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

export interface AgentTrajectoryOverviewBucket {
  readonly count: number;
  readonly interval: AgentTrajectoryTimeRange | null;
  readonly status: AgentTrajectoryStatus | null;
  // Dominant item kind by count; ties keep the first observed kind.
  readonly kind: AgentTrajectoryItemKind | null;
}

export interface AgentTrajectoryOverview {
  readonly viewport: AgentTrajectoryTimeRange | null;
  readonly bucketCount: number;
  readonly lanes: Readonly<Record<AgentTrajectoryLane, readonly AgentTrajectoryOverviewBucket[]>>;
  readonly turnBoundaries: readonly AgentTrajectoryOverviewBucket[];
}

interface PresentationItemDraft {
  item: AgentTrajectoryItem;
  detail: AgentSessionDetail | null;
  summary: string;
  lane: AgentTrajectoryLane;
  interval: AgentTrajectoryTimeRange | null;
  warningGroups: WarningGroupCollector;
  turn: AgentTrajectoryTurn | null;
  groupId: string | null;
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

interface MutableOverviewBucket {
  count: number;
  interval: AgentTrajectoryTimeRange | null;
  status: AgentTrajectoryStatus | null;
  kind: AgentTrajectoryItemKind | null;
  kindCount: number;
  kindCounts: Map<AgentTrajectoryItemKind, number> | null;
}

const finiteNumber = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteNonNegativeNumber = (value: number | undefined) => {
  const number = finiteNumber(value);
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
    const timestamp = finiteNumber(item.timestamp);
    return timestamp === undefined ? null : { start: timestamp, end: timestamp };
  }

  const startedAt = finiteNumber(item.startedAt);
  const endedAt = finiteNumber(item.endedAt);
  if (startedAt !== undefined && endedAt !== undefined) {
    return startedAt <= endedAt ? { start: startedAt, end: endedAt } : null;
  }

  const point = finiteNumber(item.timestamp);
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

const summaryForPresentation = (model: AgentSessionModel): AgentTrajectoryPresentationSummary => {
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
    turns: model.trajectory.stats.turnCount,
    events: model.trajectory.stats.itemCount,
    tools: model.trajectory.stats.toolCount,
    failures: model.trajectory.stats.failedToolCount,
    ...(durationMs === undefined ? {} : { durationMs }),
    tokens,
    warningCount: model.trajectory.warnings.length,
  };
};

const addDomainPoint = (domain: { start?: number; end?: number }, value: number | undefined) => {
  const point = finiteNumber(value);
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
  const turnByItemId = new Map<string, AgentTrajectoryTurn>();
  for (const turn of trajectory.turns) {
    for (const item of turn.items) {
      if (!turnByItemId.has(item.id)) {
        turnByItemId.set(item.id, turn);
      }
    }
  }

  const drafts: PresentationItemDraft[] = [];
  const draftByItemId = new Map<string, PresentationItemDraft>();
  const draftBySourceItem = new Map<AgentTrajectoryItem, PresentationItemDraft>();
  const candidatesBySelection = new Map<string, WarningCandidateGroup>();
  for (const item of trajectory.items) {
    const detail = model.resolveDetail(item.selection);
    const turn = turnByItemId.get(item.id) ?? null;
    const draft: PresentationItemDraft = {
      item,
      detail,
      summary: summaryFor(item, detail),
      lane: laneFor(item.kind),
      interval: intervalFor(item),
      warningGroups: createWarningGroupCollector(),
      turn,
      groupId: null,
    };
    drafts.push(draft);
    draftBySourceItem.set(item, draft);
    if (!draftByItemId.has(item.id)) {
      draftByItemId.set(item.id, draft);
    }
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
  const assignedDrafts = new Set<PresentationItemDraft>();
  for (const turn of trajectory.turns) {
    const items: PresentationItemDraft[] = [];
    for (const turnItem of turn.items) {
      const draft = draftBySourceItem.get(turnItem) ?? draftByItemId.get(turnItem.id);
      if (!draft || assignedDrafts.has(draft)) {
        continue;
      }
      assignedDrafts.add(draft);
      draft.turn = turn;
      draft.groupId = turn.id;
      items.push(draft);
    }
    groupDrafts.push({ id: turn.id, turn, items });
  }

  const unassignedItems: PresentationItemDraft[] = [];
  for (const draft of drafts) {
    if (assignedDrafts.has(draft)) {
      continue;
    }
    assignedDrafts.add(draft);
    draft.turn = null;
    draft.groupId = UNASSIGNED_GROUP_ID;
    unassignedItems.push(draft);
  }
  if (unassignedItems.length > 0) {
    groupDrafts.push({ id: UNASSIGNED_GROUP_ID, turn: null, items: unassignedItems });
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
      groupId: draft.groupId ?? UNASSIGNED_GROUP_ID,
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
    summary: summaryForPresentation(model),
    unattachedWarningGroups: unattachedWarningGroups.groups,
    timeDomain: domainFor(presentationItems, trajectory.turns),
    timedItemCount,
  };
};

const validRange = (range: AgentTrajectoryTimeRange | null | undefined) => {
  const start = finiteNumber(range?.start);
  const end = finiteNumber(range?.end);
  return start === undefined || end === undefined || start > end ? null : { start, end };
};

const overlaps = (left: AgentTrajectoryTimeRange, right: AgentTrajectoryTimeRange) =>
  left.start <= right.end && left.end >= right.start;

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
  return !timeRange || !item.interval || overlaps(item.interval, timeRange);
};

export const filterAgentTrajectoryPresentation = (
  presentation: AgentTrajectoryPresentation,
  filter: AgentTrajectoryPresentationFilter = {},
): FilteredAgentTrajectoryPresentation => {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const kind = filter.kind ?? "all";
  const status = filter.status ?? "all";
  const timeRange = validRange(filter.timeRange);
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

export const trajectoryOverviewBucketCount = (widthPx: number, timedItemCount: number) => {
  if (!Number.isFinite(timedItemCount) || timedItemCount <= 0) {
    return 0;
  }
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return 1;
  }
  return Math.min(MAXIMUM_BUCKET_COUNT, Math.max(1, Math.floor(widthPx / MINIMUM_BUCKET_WIDTH_PX)));
};

const emptyBuckets = (bucketCount: number) => {
  const buckets: MutableOverviewBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    buckets.push({
      count: 0,
      interval: null,
      status: null,
      kind: null,
      kindCount: 0,
      kindCounts: null,
    });
  }
  return buckets;
};

const statusPriority = (status: AgentTrajectoryStatus) => {
  if (status === "failed" || status === "aborted") {
    return 2;
  }
  return status === "running" ? 1 : 0;
};

const includeBucketFact = (
  bucket: MutableOverviewBucket,
  interval: AgentTrajectoryTimeRange,
  status: AgentTrajectoryStatus,
  kind?: AgentTrajectoryItemKind,
) => {
  bucket.count += 1;
  bucket.interval = bucket.interval
    ? {
        start: Math.min(bucket.interval.start, interval.start),
        end: Math.max(bucket.interval.end, interval.end),
      }
    : interval;
  if (!bucket.status || statusPriority(status) > statusPriority(bucket.status)) {
    bucket.status = status;
  }
  if (kind === undefined) {
    return;
  }
  bucket.kindCounts ??= new Map();
  const kindCount = (bucket.kindCounts.get(kind) ?? 0) + 1;
  bucket.kindCounts.set(kind, kindCount);
  if (kindCount > bucket.kindCount) {
    bucket.kindCount = kindCount;
    bucket.kind = kind;
  }
};

const clampRangeToDomain = (
  domain: AgentTrajectoryTimeRange,
  range: AgentTrajectoryTimeRange | null | undefined,
) => {
  const requested = validRange(range);
  if (!requested) {
    return domain;
  }
  const start = Math.max(domain.start, requested.start);
  const end = Math.min(domain.end, requested.end);
  return start <= end ? { start, end } : domain;
};

const bucketIndexFor = (time: number, viewport: AgentTrajectoryTimeRange, bucketCount: number) => {
  const span = viewport.end - viewport.start;
  if (span <= 0 || !Number.isFinite(span)) {
    return 0;
  }
  const ratio = (Math.min(viewport.end, Math.max(viewport.start, time)) - viewport.start) / span;
  return Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio * bucketCount)));
};

const midpoint = (interval: AgentTrajectoryTimeRange) =>
  interval.start + (interval.end - interval.start) / 2;

const safeBucketCount = (bucketCount: number) =>
  Number.isFinite(bucketCount) && bucketCount > 0
    ? Math.min(MAXIMUM_BUCKET_COUNT, Math.floor(bucketCount))
    : 0;

export const createAgentTrajectoryOverview = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
  bucketCount: number,
): AgentTrajectoryOverview => {
  const domain = validRange(presentation.timeDomain);
  const count = safeBucketCount(bucketCount);
  if (!domain || count === 0) {
    return {
      viewport: null,
      bucketCount: 0,
      lanes: { activity: [], model: [], tool: [] },
      turnBoundaries: [],
    };
  }

  const activeViewport = clampRangeToDomain(domain, viewport);
  const scale = createTrajectoryTimeScale(presentation, activeViewport);
  const lanes: Record<AgentTrajectoryLane, MutableOverviewBucket[]> = {
    activity: emptyBuckets(count),
    model: emptyBuckets(count),
    tool: emptyBuckets(count),
  };
  const turnBoundaries = emptyBuckets(count);
  const bucketIndex = (time: number) =>
    scale
      ? Math.min(count - 1, Math.max(0, Math.floor(scale.toRatio(time) * count)))
      : bucketIndexFor(time, activeViewport, count);

  for (const item of presentation.items) {
    if (!item.interval || !overlaps(item.interval, activeViewport)) {
      continue;
    }
    const index = bucketIndex(midpoint(item.interval));
    includeBucketFact(lanes[item.lane][index]!, item.interval, item.item.status, item.item.kind);
  }

  for (const turn of presentation.groups) {
    const status = turn.turn?.status;
    if (!status) {
      continue;
    }
    for (const time of [turn.turn?.startedAt, turn.turn?.endedAt]) {
      const point = finiteNumber(time);
      if (point === undefined || point < activeViewport.start || point > activeViewport.end) {
        continue;
      }
      const index = bucketIndex(point);
      includeBucketFact(turnBoundaries[index]!, { start: point, end: point }, status);
    }
  }

  return {
    viewport: activeViewport,
    bucketCount: count,
    lanes: {
      activity: finalizeBuckets(lanes.activity),
      model: finalizeBuckets(lanes.model),
      tool: finalizeBuckets(lanes.tool),
    },
    turnBoundaries: finalizeBuckets(turnBoundaries),
  };
};

const finalizeBuckets = (
  buckets: readonly MutableOverviewBucket[],
): AgentTrajectoryOverviewBucket[] =>
  buckets.map(({ count, interval, status, kind }) => ({ count, interval, status, kind }));

// An idle stretch must span at least this fraction of the viewport before the
// axis compresses it — high enough that ordinary pauses between sparse events
// never fold — and it then occupies this much of the compressed width.
const TIME_SCALE_GAP_MIN_FRACTION = 0.25;
const TIME_SCALE_GAP_MIN_MS = 60_000;
const TIME_SCALE_GAP_COMPRESSED_FRACTION = 0.03;

export interface TrajectoryTimeScale {
  readonly viewport: AgentTrajectoryTimeRange;
  // Idle stretches (in real time) that the axis compresses.
  readonly gaps: readonly AgentTrajectoryTimeRange[];
  readonly toRatio: (time: number) => number;
  readonly fromRatio: (ratio: number) => number;
}

interface TimeScaleSegment {
  readonly start: number;
  readonly end: number;
  readonly weight: number;
  readonly cumulativeBefore: number;
}

const linearTimeScale = (
  viewport: AgentTrajectoryTimeRange,
  span: number,
): TrajectoryTimeScale => ({
  viewport,
  gaps: [],
  toRatio: (time) => Math.min(1, Math.max(0, (time - viewport.start) / span)),
  fromRatio: (ratio) => viewport.start + Math.min(1, Math.max(0, ratio)) * span,
});

/**
 * A piecewise-linear axis over the viewport: stretches with no observed
 * activity longer than a tenth of the viewport collapse to a sliver so the
 * active clusters get the horizontal space instead of real idle time.
 */
export const createTrajectoryTimeScale = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
): TrajectoryTimeScale | null => {
  const active = validRange(viewport);
  if (!active) {
    return null;
  }
  const span = active.end - active.start;
  if (!Number.isFinite(span) || span <= 0) {
    return null;
  }

  const covered: { start: number; end: number }[] = [];
  for (const item of presentation.items) {
    if (!item.interval || !overlaps(item.interval, active)) {
      continue;
    }
    covered.push({
      start: Math.max(active.start, item.interval.start),
      end: Math.min(active.end, item.interval.end),
    });
  }
  for (const group of presentation.groups) {
    for (const time of [group.turn?.startedAt, group.turn?.endedAt]) {
      const point = finiteNumber(time);
      if (point !== undefined && point >= active.start && point <= active.end) {
        covered.push({ start: point, end: point });
      }
    }
  }
  if (covered.length === 0) {
    return linearTimeScale(active, span);
  }

  covered.sort((left, right) => left.start - right.start);
  const minGap = Math.max(span * TIME_SCALE_GAP_MIN_FRACTION, TIME_SCALE_GAP_MIN_MS);
  const gaps: AgentTrajectoryTimeRange[] = [];
  let coveredUntil = active.start;
  for (const range of covered) {
    if (range.start - coveredUntil > minGap) {
      gaps.push({ start: coveredUntil, end: range.start });
    }
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (active.end - coveredUntil > minGap) {
    gaps.push({ start: coveredUntil, end: active.end });
  }
  if (gaps.length === 0) {
    return linearTimeScale(active, span);
  }

  // Each gap should occupy a fixed share of the *compressed* width, so solve
  // w / (activeWeight + gapCount * w) = share for the gap weight w.
  const gapShare = TIME_SCALE_GAP_COMPRESSED_FRACTION;
  const activeWeight = span - gaps.reduce((total, gap) => total + (gap.end - gap.start), 0);
  const compressedWeight =
    activeWeight > 0 && gaps.length * gapShare < 1
      ? (gapShare * activeWeight) / (1 - gaps.length * gapShare)
      : span * gapShare;
  const segments: TimeScaleSegment[] = [];
  let cursor = active.start;
  let cumulative = 0;
  const pushSegment = (start: number, end: number, weight: number) => {
    if (end <= start) {
      return;
    }
    segments.push({ start, end, weight, cumulativeBefore: cumulative });
    cumulative += weight;
  };
  for (const gap of gaps) {
    pushSegment(cursor, gap.start, gap.start - cursor);
    pushSegment(gap.start, gap.end, compressedWeight);
    cursor = gap.end;
  }
  pushSegment(cursor, active.end, active.end - cursor);
  const totalWeight = cumulative;
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return linearTimeScale(active, span);
  }

  const toRatio = (time: number) => {
    const clamped = Math.min(active.end, Math.max(active.start, time));
    for (const segment of segments) {
      if (clamped <= segment.end) {
        const within = (clamped - segment.start) / (segment.end - segment.start);
        return (segment.cumulativeBefore + within * segment.weight) / totalWeight;
      }
    }
    return 1;
  };
  const fromRatio = (ratio: number) => {
    const target = Math.min(1, Math.max(0, ratio)) * totalWeight;
    for (const segment of segments) {
      if (target <= segment.cumulativeBefore + segment.weight) {
        const within =
          segment.weight > 0 ? (target - segment.cumulativeBefore) / segment.weight : 0;
        return segment.start + within * (segment.end - segment.start);
      }
    }
    return active.end;
  };

  return { viewport: active, gaps, toRatio, fromRatio };
};

export interface AgentTrajectoryOverviewSpan {
  readonly item: AgentTrajectoryPresentationItem;
  // Position within the viewport, both clamped to [0, 1].
  readonly startRatio: number;
  readonly endRatio: number;
}

/**
 * Projects each timed item inside the viewport onto viewport-relative ratios,
 * or returns null when more than `limit` items intersect it — the signal to
 * fall back to bucket aggregation.
 */
export const trajectoryOverviewSpans = (
  presentation: AgentTrajectoryPresentation,
  viewport: AgentTrajectoryTimeRange | null,
  limit: number,
): AgentTrajectoryOverviewSpan[] | null => {
  const scale = createTrajectoryTimeScale(presentation, viewport);
  if (!scale || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }

  const spans: AgentTrajectoryOverviewSpan[] = [];
  for (const item of presentation.items) {
    if (!item.interval || !overlaps(item.interval, scale.viewport)) {
      continue;
    }
    if (spans.length >= limit) {
      return null;
    }
    spans.push({
      item,
      startRatio: scale.toRatio(item.interval.start),
      endRatio: scale.toRatio(item.interval.end),
    });
  }
  return spans;
};

const expandedDomain = (domain: AgentTrajectoryTimeRange | null) => {
  const valid = validRange(domain);
  if (!valid) {
    return null;
  }
  if (valid.start !== valid.end) {
    return valid;
  }
  const end = valid.end + SINGLE_POINT_DOMAIN_DURATION_MS;
  return Number.isFinite(end) && end > valid.end ? { start: valid.start, end } : valid;
};

export const zoomTrajectoryViewport = (
  domain: AgentTrajectoryTimeRange | null,
  viewport: AgentTrajectoryTimeRange | null,
  factor: number,
): AgentTrajectoryTimeRange | null => {
  const fullDomain = expandedDomain(domain);
  if (!fullDomain || !Number.isFinite(factor) || factor <= 0) {
    return fullDomain;
  }
  const requestedViewport = validRange(viewport);
  if (!requestedViewport) {
    return fullDomain;
  }
  const currentViewport = clampRangeToDomain(fullDomain, requestedViewport);
  const domainSpan = fullDomain.end - fullDomain.start;
  const currentSpan = currentViewport.end - currentViewport.start;
  const nextSpan = Math.min(domainSpan, currentSpan / factor);
  if (!Number.isFinite(nextSpan) || nextSpan <= 0) {
    return fullDomain;
  }

  const center = currentViewport.start + currentSpan / 2;
  let start = center - nextSpan / 2;
  let end = center + nextSpan / 2;
  if (start < fullDomain.start) {
    start = fullDomain.start;
    end = start + nextSpan;
  }
  if (end > fullDomain.end) {
    end = fullDomain.end;
    start = end - nextSpan;
  }
  return { start, end };
};
