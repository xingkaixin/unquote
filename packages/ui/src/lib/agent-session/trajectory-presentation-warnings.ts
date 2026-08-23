import { agentSelectionKey } from "./identity";
import type { AgentCanonicalSelection } from "./session-types";
import type { AgentTrajectoryItem, AgentTrajectoryWarning } from "./trajectory-types";

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

export interface AgentTrajectoryWarningGroup {
  readonly warning: AgentTrajectoryWarning;
  readonly count: number;
}

interface MutableWarningGroup {
  warning: AgentTrajectoryWarning;
  count: number;
}

export interface WarningGroupCollector {
  groups: MutableWarningGroup[];
  groupsByKind: Map<AgentTrajectoryWarning["kind"], MutableWarningGroup>;
}

interface WarningTarget {
  warningGroups: WarningGroupCollector;
}

interface WarningCandidateGroup<TTarget extends WarningTarget> {
  uniqueCandidate: TTarget | null;
  candidatesByCallId: Map<string, TTarget | null>;
}

export type WarningCandidateIndex<TTarget extends WarningTarget> = Map<
  string,
  WarningCandidateGroup<TTarget>
>;

const nonEmptyCallId = (value: string | undefined) =>
  value !== undefined && value.length > 0 ? value : undefined;

const warningCallId = (warning: AgentTrajectoryWarning) =>
  "callId" in warning ? nonEmptyCallId(warning.callId) : undefined;

const itemSelections = (item: AgentTrajectoryItem) =>
  item.kind === "tool"
    ? [item.selection, item.callSelection, item.resultSelection, item.completionSelection]
    : [item.selection];

const addCandidate = <TTarget extends WarningTarget>(
  candidates: WarningCandidateIndex<TTarget>,
  target: TTarget,
  callId: string | undefined,
  selection: AgentCanonicalSelection | undefined,
  seenKeys: Set<string>,
) => {
  if (!selection) {
    return;
  }
  const key = agentSelectionKey(selection);
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);

  let group = candidates.get(key);
  if (!group) {
    group = { uniqueCandidate: target, candidatesByCallId: new Map() };
    candidates.set(key, group);
  } else if (group.uniqueCandidate !== target) {
    group.uniqueCandidate = null;
  }

  if (callId === undefined) {
    return;
  }
  const candidateForCallId = group.candidatesByCallId.get(callId);
  if (candidateForCallId === undefined) {
    group.candidatesByCallId.set(callId, target);
  } else if (candidateForCallId !== target) {
    group.candidatesByCallId.set(callId, null);
  }
};

export const createWarningGroupCollector = (): WarningGroupCollector => ({
  groups: [],
  groupsByKind: new Map(),
});

export const addWarningCandidate = <TTarget extends WarningTarget>(
  candidates: WarningCandidateIndex<TTarget>,
  target: TTarget,
  item: AgentTrajectoryItem,
) => {
  const callId = item.kind === "tool" ? nonEmptyCallId(item.callId) : undefined;
  const seenKeys = new Set<string>();
  for (const selection of itemSelections(item)) {
    addCandidate(candidates, target, callId, selection, seenKeys);
  }
};

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

export const associateWarnings = <TTarget extends WarningTarget>(
  warnings: readonly AgentTrajectoryWarning[],
  candidates: ReadonlyMap<string, WarningCandidateGroup<TTarget>>,
  unattached: WarningGroupCollector,
) => {
  for (const warning of warnings) {
    const group = candidates.get(agentSelectionKey(warning.selection));
    const callId = warningCallId(warning);
    const target = group
      ? callId === undefined
        ? group.uniqueCandidate
        : group.candidatesByCallId.get(callId)
      : undefined;
    addWarningToGroups(target?.warningGroups ?? unattached, warning);
  }
};
