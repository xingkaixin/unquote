import type {
  AgentConversationItem,
  AgentSessionEvidence,
  AgentTimelineEvent,
  AgentToolCallEvidence,
  AgentToolCompletionEvidence,
  AgentToolLifecycleEvidence,
  AgentToolResultEvidence,
} from "./session-types";
import type { AgentToolStatus } from "./model-types";
import type { CanonicalAgentEvent, CanonicalAgentSession } from "./identity";
import {
  createToolCorrelationGroups,
  forEachToolCorrelationGroup,
  resolveToolCorrelationGroup,
  toolCorrelationGroupFor,
  toolCorrelationScope,
  type ToolCorrelationResolution,
} from "./tool-correlation";

export interface AgentToolLifecycleState {
  status: AgentToolStatus;
  toolName?: string;
}

export interface AgentToolLifecycleOccurrence<TEvidence extends AgentToolLifecycleEvidence> {
  evidence: TEvidence;
  event: AgentTimelineEvent;
  conversationItem?: AgentConversationItem;
}

type AgentToolCallOccurrence = AgentToolLifecycleOccurrence<AgentToolCallEvidence>;
type AgentToolResultOccurrence = AgentToolLifecycleOccurrence<AgentToolResultEvidence>;
type AgentToolCompletionOccurrence = AgentToolLifecycleOccurrence<AgentToolCompletionEvidence>;
export type AgentToolLifecycleResolution = ToolCorrelationResolution<
  AgentToolCallOccurrence,
  AgentToolResultOccurrence,
  AgentToolCompletionOccurrence
>;

export interface AgentToolLifecycleIndex {
  evidenceEvents: readonly AgentSessionEvidenceEvent[];
  groups: readonly AgentToolLifecycleResolution[];
  groupedEvidence: ReadonlySet<AgentToolLifecycleEvidence>;
  stateByConversationItem: ReadonlyMap<AgentConversationItem, AgentToolLifecycleState>;
}

export interface AgentSessionEvidenceEvent {
  evidence: readonly AgentSessionEvidence[];
  canonicalEvent: CanonicalAgentEvent;
}

const lifecycleOccurrence = <TEvidence extends AgentToolLifecycleEvidence>(
  evidence: TEvidence,
  event: AgentTimelineEvent,
  conversationItem: AgentConversationItem | undefined,
): AgentToolLifecycleOccurrence<TEvidence> => ({
  evidence,
  event,
  ...(conversationItem ? { conversationItem } : {}),
});

const finiteTurnIndex = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

const nonEmptyString = (value: string | undefined) =>
  value && value.length > 0 ? value : undefined;

export const resolveToolLifecycleStatus = (
  result: AgentToolResultEvidence["status"],
  completion: AgentToolCompletionEvidence["status"],
): AgentToolStatus => {
  if (result === "failed" || completion === "failed") {
    return "failed";
  }
  if (result === "completed" || completion === "completed") {
    return "completed";
  }
  return "pending";
};

const stateForEvidence = (
  call: AgentToolCallOccurrence | undefined,
  result: AgentToolResultOccurrence | undefined,
  completion: AgentToolCompletionOccurrence | undefined,
): AgentToolLifecycleState => ({
  status: resolveToolLifecycleStatus(result?.evidence.status, completion?.evidence.status),
  ...(call?.evidence.toolName ? { toolName: call.evidence.toolName } : {}),
});

const assignEvidenceState = (
  states: Map<AgentConversationItem, AgentToolLifecycleState>,
  occurrence: AgentToolCallOccurrence | AgentToolResultOccurrence | undefined,
  state: AgentToolLifecycleState,
) => {
  if (occurrence?.conversationItem) {
    states.set(occurrence.conversationItem, state);
  }
};

const finalizeEvidenceGroup = (
  states: Map<AgentConversationItem, AgentToolLifecycleState>,
  resolution: AgentToolLifecycleResolution,
) => {
  if (resolution.kind === "repeated") {
    for (const call of resolution.calls) {
      assignEvidenceState(states, call, stateForEvidence(call, undefined, undefined));
    }
    for (const result of resolution.results) {
      assignEvidenceState(states, result, stateForEvidence(undefined, result, undefined));
    }
    return;
  }

  const state = stateForEvidence(resolution.call, resolution.result, resolution.completion);
  assignEvidenceState(states, resolution.call, state);
  assignEvidenceState(states, resolution.result, state);
};

export const createAgentToolLifecycleIndex = (
  session: CanonicalAgentSession,
): AgentToolLifecycleIndex => {
  const evidenceEvents: AgentSessionEvidenceEvent[] = [];
  const stateByConversationItem = new Map<AgentConversationItem, AgentToolLifecycleState>();
  const groupedEvidence = new Set<AgentToolLifecycleEvidence>();
  const evidenceGroups = createToolCorrelationGroups<
    AgentToolCallOccurrence,
    AgentToolResultOccurrence,
    AgentToolCompletionOccurrence
  >();

  for (const canonicalEvent of session.events) {
    const { event } = canonicalEvent;
    const indexedEvidence: AgentSessionEvidence[] = [];
    for (const evidence of event.sessionEvidence ?? []) {
      indexedEvidence.push(evidence);
      if (evidence.kind !== "tool-lifecycle") {
        continue;
      }

      const conversationItem =
        evidence.phase !== "completion" &&
        evidence.conversationItem &&
        canonicalEvent.conversationItemSet.has(evidence.conversationItem)
          ? evidence.conversationItem
          : undefined;
      const callId = nonEmptyString(evidence.callId);
      if (!callId) {
        if (evidence.phase === "call") {
          const occurrence = lifecycleOccurrence(evidence, event, conversationItem);
          assignEvidenceState(
            stateByConversationItem,
            occurrence,
            stateForEvidence(occurrence, undefined, undefined),
          );
        } else if (evidence.phase === "result") {
          const occurrence = lifecycleOccurrence(evidence, event, conversationItem);
          assignEvidenceState(
            stateByConversationItem,
            occurrence,
            stateForEvidence(undefined, occurrence, undefined),
          );
        }
        continue;
      }

      const group = toolCorrelationGroupFor(
        evidenceGroups,
        toolCorrelationScope(evidence.turnId, finiteTurnIndex(event.turnIndex)),
        callId,
      );
      groupedEvidence.add(evidence);
      if (evidence.phase === "call") {
        group.calls.push(lifecycleOccurrence(evidence, event, conversationItem));
      } else if (evidence.phase === "result") {
        group.results.push(lifecycleOccurrence(evidence, event, conversationItem));
      } else {
        group.completions.push(lifecycleOccurrence(evidence, event, conversationItem));
      }
    }
    if (indexedEvidence.length > 0) {
      evidenceEvents.push({ evidence: indexedEvidence, canonicalEvent });
    }
  }

  const orderedGroups: AgentToolLifecycleResolution[] = [];
  forEachToolCorrelationGroup(evidenceGroups, (group) => {
    const resolution = resolveToolCorrelationGroup(group);
    orderedGroups.push(resolution);
    finalizeEvidenceGroup(stateByConversationItem, resolution);
  });

  return {
    evidenceEvents,
    groups: orderedGroups,
    groupedEvidence,
    stateByConversationItem,
  };
};
