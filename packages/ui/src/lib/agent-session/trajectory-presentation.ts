import { truncateAtCodePointBoundary } from "@unquote/core";
import type { AgentSessionDetail, AgentSessionModel } from "./model-types";
import type {
  AgentTrajectoryItem,
  AgentTrajectoryItemKind,
  AgentTrajectoryTurn,
} from "./trajectory-types";
import { finiteTrajectoryNumber, type AgentTrajectoryTimeRange } from "./trajectory-time";
import type {
  AgentTrajectoryLane,
  AgentTrajectoryPresentation,
  AgentTrajectoryPresentationGroup,
  AgentTrajectoryPresentationItem,
} from "./trajectory-presentation-types";
import {
  addWarningCandidate,
  associateWarnings,
  createWarningGroupCollector,
  type WarningCandidateIndex,
  type WarningGroupCollector,
} from "./trajectory-presentation-warnings";
import {
  createTrajectoryPresentationSummary,
  createTrajectoryTimeDomain,
} from "./trajectory-presentation-summary";

export type { AgentTrajectoryTimeRange } from "./trajectory-time";
export type {
  AgentTrajectoryLane,
  AgentTrajectoryPresentation,
  AgentTrajectoryPresentationGroup,
  AgentTrajectoryPresentationItem,
  AgentTrajectoryPresentationSummary,
} from "./trajectory-presentation-types";
export {
  agentTrajectoryFilterKinds,
  agentTrajectoryFilterStatuses,
  filterAgentTrajectoryPresentation,
} from "./trajectory-presentation-filter";
export type {
  AgentTrajectoryFilterKind,
  AgentTrajectoryFilterStatus,
  AgentTrajectoryLedgerItemRow,
  AgentTrajectoryLedgerRow,
  AgentTrajectoryLedgerTurnHeader,
  AgentTrajectoryPresentationFilter,
  FilteredAgentTrajectoryPresentation,
} from "./trajectory-presentation-filter";
export { agentTrajectoryWarningKinds } from "./trajectory-presentation-warnings";
export type { AgentTrajectoryWarningGroup } from "./trajectory-presentation-warnings";

const TRAJECTORY_DISPLAY_CHARACTER_LIMIT = 240;
const UNASSIGNED_GROUP_ID = "unassigned";

interface PresentationItemDraft {
  item: AgentTrajectoryItem;
  detail: AgentSessionDetail | null;
  summary: string;
  lane: AgentTrajectoryLane;
  interval: AgentTrajectoryTimeRange | null;
  warningGroups: WarningGroupCollector;
  turn: AgentTrajectoryTurn | null;
}

interface PresentationGroupDraft {
  id: string;
  turn: AgentTrajectoryTurn | null;
  items: PresentationItemDraft[];
}

const nonEmptyText = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : undefined;
};

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

const previewFor = (detail: AgentSessionDetail | null) =>
  nonEmptyText(detail?.conversationItem?.block?.text)?.replace(/\s+/g, " ") ??
  nonEmptyText(detail?.event.preview);

const summaryFor = (item: AgentTrajectoryItem, detail: AgentSessionDetail | null) => {
  const event = detail?.event;
  const summary =
    previewFor(detail) ??
    nonEmptyText(event?.label) ??
    (item.kind === "tool" ? nonEmptyText(item.toolName) : undefined);
  return summary ? truncateTrajectoryDisplayText(summary) : "";
};

export const agentTrajectoryLaneFor = (kind: AgentTrajectoryItemKind): AgentTrajectoryLane => {
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
    previewFor(detail),
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

export const createAgentTrajectoryPresentation = (
  model: AgentSessionModel,
): AgentTrajectoryPresentation => {
  const trajectory = model.trajectory;
  const turnById = new Map(trajectory.turns.map((turn) => [turn.id, turn]));

  const drafts: PresentationItemDraft[] = [];
  const candidatesBySelection: WarningCandidateIndex<PresentationItemDraft> = new Map();
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
      lane: agentTrajectoryLaneFor(item.kind),
      interval: intervalFor(item),
      warningGroups: createWarningGroupCollector(),
      turn,
    };
    drafts.push(draft);
    addWarningCandidate(candidatesBySelection, draft, item);
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
    summary: createTrajectoryPresentationSummary(trajectory, toolCount, failedToolCount),
    unattachedWarningGroups: unattachedWarningGroups.groups,
    timeDomain: createTrajectoryTimeDomain(presentationItems, trajectory.turns),
    timedItemCount,
  };
};
