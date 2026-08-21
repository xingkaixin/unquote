import type {
  AgentConversationItem,
  AgentToolCallEvidence,
  AgentToolCompletionEvidence,
  AgentToolResultEvidence,
  AgentToolStatus,
} from "./types";
import type { CanonicalAgentSession } from "./identity";
import {
  createToolCorrelationGroups,
  forEachToolCorrelationGroup,
  hasRepeatedToolOccurrences,
  toolCorrelationGroupFor,
  toolCorrelationScope,
  type ToolCorrelationGroup,
} from "./tool-correlation";

interface ToolOccurrence<TEvidence> {
  evidence: TEvidence;
  item: AgentConversationItem | undefined;
}

type ToolCallOccurrence = ToolOccurrence<AgentToolCallEvidence>;
type ToolResultOccurrence = ToolOccurrence<AgentToolResultEvidence>;
type ToolCompletionOccurrence = ToolOccurrence<AgentToolCompletionEvidence>;
type ToolGroup = ToolCorrelationGroup<
  ToolCallOccurrence,
  ToolResultOccurrence,
  ToolCompletionOccurrence
>;

interface AgentToolLifecycleState {
  status: AgentToolStatus;
  toolName?: string;
}

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

const stateFor = (
  call: ToolCallOccurrence | undefined,
  result: ToolResultOccurrence | undefined,
  completion: ToolCompletionOccurrence | undefined,
): AgentToolLifecycleState => ({
  status: resolveToolLifecycleStatus(result?.evidence.status, completion?.evidence.status),
  ...(call?.evidence.toolName ? { toolName: call.evidence.toolName } : {}),
});

const assignState = (
  states: Map<AgentConversationItem, AgentToolLifecycleState>,
  occurrence: ToolCallOccurrence | ToolResultOccurrence | undefined,
  state: AgentToolLifecycleState,
) => {
  if (occurrence?.item) {
    states.set(occurrence.item, state);
  }
};

const finalizeGroup = (
  states: Map<AgentConversationItem, AgentToolLifecycleState>,
  group: ToolGroup,
) => {
  if (hasRepeatedToolOccurrences(group)) {
    for (const call of group.calls) {
      assignState(states, call, stateFor(call, undefined, undefined));
    }
    for (const result of group.results) {
      assignState(states, result, stateFor(undefined, result, undefined));
    }
    return;
  }

  const call = group.calls[0];
  const result = group.results[0];
  const state = stateFor(call, result, group.completions[0]);
  assignState(states, call, state);
  assignState(states, result, state);
};

export const createAgentToolLifecycleStates = (session: CanonicalAgentSession) => {
  const states = new Map<AgentConversationItem, AgentToolLifecycleState>();
  const groups = createToolCorrelationGroups<
    ToolCallOccurrence,
    ToolResultOccurrence,
    ToolCompletionOccurrence
  >();

  for (const { event, conversationItems } of session.events) {
    let conversationById: ReadonlyMap<string, AgentConversationItem> | undefined;
    for (const evidence of event.trajectoryEvidence ?? []) {
      if (evidence.kind !== "tool-lifecycle") {
        continue;
      }

      const callId = nonEmptyString(evidence.callId);
      const group = callId
        ? toolCorrelationGroupFor(
            groups,
            toolCorrelationScope(evidence.turnId, finiteTurnIndex(event.turnIndex)),
            callId,
          )
        : undefined;
      const item =
        evidence.phase !== "completion" && evidence.conversationItemId
          ? (conversationById ??= new Map(conversationItems.map((item) => [item.id, item]))).get(
              evidence.conversationItemId,
            )
          : undefined;
      if (evidence.phase === "call") {
        const occurrence: ToolCallOccurrence = { evidence, item };
        if (group) {
          group.calls.push(occurrence);
        } else {
          assignState(states, occurrence, stateFor(occurrence, undefined, undefined));
        }
      } else if (evidence.phase === "result") {
        const occurrence: ToolResultOccurrence = { evidence, item };
        if (group) {
          group.results.push(occurrence);
        } else {
          assignState(states, occurrence, stateFor(undefined, occurrence, undefined));
        }
      } else {
        group?.completions.push({ evidence, item: undefined });
      }
    }
  }

  forEachToolCorrelationGroup(groups, (group) => finalizeGroup(states, group));
  return states;
};
