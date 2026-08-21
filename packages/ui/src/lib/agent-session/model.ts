import type {
  AgentConversationEntry,
  AgentConversationItem,
  AgentDetailSelection,
  AgentSession,
  AgentSessionDetail,
  AgentSessionModel,
  AgentTimelineEvent,
  AgentTrajectoryItem,
  AgentTrajectoryModel,
  AgentToolStatus,
} from "./types";
import { measurePerfFn } from "../perf";
import { canonicalizeAgentSession } from "./identity";
import {
  createToolCorrelationGroups,
  toolCorrelationGroupFor,
  toolCorrelationScope,
  uniqueToolPair,
  type ToolCorrelationGroup,
} from "./tool-correlation";
import { createAgentToolLifecycleStates } from "./tool-lifecycle";
import { createAgentTrajectoryModelFromCanonicalSession } from "./trajectory-model";

const detailForEvent = (
  event: AgentTimelineEvent,
  conversationItem: AgentConversationEntry["item"] | undefined,
): AgentSessionDetail => ({
  event,
  ...(conversationItem ? { conversationItem } : {}),
  recordId: event.recordId,
});

const toolUseBlock = (item: AgentConversationItem | undefined) =>
  item?.block?.type === "tool_use" ? item.block : undefined;

const toolResultBlock = (item: AgentConversationItem | undefined) =>
  item?.block?.type === "tool_result" ? item.block : undefined;

type ToolGroup = ToolCorrelationGroup<AgentConversationItem, AgentConversationItem>;

const finiteTurnIndex = (value: number | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

const explicitTurnIdsByConversationItem = (event: AgentTimelineEvent) => {
  const turnIds = new Map<string, string>();
  for (const evidence of event.trajectoryEvidence ?? []) {
    if (
      evidence.kind !== "model-output" &&
      (evidence.kind !== "tool-lifecycle" || evidence.phase === "completion")
    ) {
      continue;
    }
    if (evidence.conversationItemId && evidence.turnId) {
      turnIds.set(evidence.conversationItemId, evidence.turnId);
    }
  }
  return turnIds;
};

export const createAgentSessionModel = (session: AgentSession): AgentSessionModel => {
  const canonicalSession = canonicalizeAgentSession(session);
  const events: AgentTimelineEvent[] = [];
  const conversation: AgentConversationEntry[] = [];
  const eventById = new Map<string, AgentTimelineEvent>();
  const eventByRecordId = new Map<string, AgentTimelineEvent>();
  const conversationById = new Map<string, AgentConversationEntry>();
  const firstConversationByEventId = new Map<string, AgentConversationEntry>();
  const toolGroups = createToolCorrelationGroups<AgentConversationItem, AgentConversationItem>();
  const toolGroupByItem = new Map<AgentConversationItem, ToolGroup>();

  for (const { event, conversationItems } of canonicalSession.events) {
    events.push(event);
    eventById.set(event.id, event);
    eventByRecordId.set(event.recordId, event);
    const evidenceTurnIds = explicitTurnIdsByConversationItem(event);

    for (const item of conversationItems) {
      const entry = { item, event };
      conversation.push(entry);
      conversationById.set(item.id, entry);
      if (!firstConversationByEventId.has(event.id)) {
        firstConversationByEventId.set(event.id, entry);
      }

      const call = toolUseBlock(item);
      const result = toolResultBlock(item);
      const callId = call?.toolCallId ?? result?.toolCallId;
      if (!callId) {
        continue;
      }

      const scope = toolCorrelationScope(
        evidenceTurnIds.get(item.id),
        finiteTurnIndex(item.turnIndex) ?? finiteTurnIndex(event.turnIndex),
      );
      const group = toolCorrelationGroupFor(toolGroups, scope, callId);
      if (call) {
        group.calls.push(item);
      } else if (result) {
        group.results.push(item);
      }
      toolGroupByItem.set(item, group);
    }
  }

  const toolLifecycleStates = createAgentToolLifecycleStates(canonicalSession);
  let trajectoryProjection:
    | {
        model: AgentTrajectoryModel;
        itemById: ReadonlyMap<string, AgentTrajectoryItem>;
      }
    | undefined;

  const getTrajectoryProjection = () => {
    if (!trajectoryProjection) {
      const model = measurePerfFn("agentTrajectory:build", () =>
        createAgentTrajectoryModelFromCanonicalSession(canonicalSession),
      );
      trajectoryProjection = {
        model,
        itemById: new Map(model.items.map((item) => [item.id, item])),
      };
    }
    return trajectoryProjection;
  };

  const resolveEvent = (event: AgentTimelineEvent) =>
    detailForEvent(event, firstConversationByEventId.get(event.id)?.item);

  const resolveDetail = (selection: AgentDetailSelection | null): AgentSessionDetail | null => {
    if (!selection) {
      const event = events[0];
      return event ? resolveEvent(event) : null;
    }

    if (selection.kind === "trajectory") {
      const item = getTrajectoryProjection().itemById.get(selection.id);
      return item ? resolveDetail(item.selection) : null;
    }

    if (selection.kind === "conversation") {
      const entry = conversationById.get(selection.id);
      return entry ? detailForEvent(entry.event, entry.item) : null;
    }

    const event =
      selection.kind === "event"
        ? eventById.get(selection.id)
        : eventByRecordId.get(selection.recordId);
    return event ? resolveEvent(event) : null;
  };

  const selectEvent = (eventId: string): AgentDetailSelection | null => {
    const event = eventById.get(eventId);
    if (!event) {
      return null;
    }
    const entry = firstConversationByEventId.get(event.id);
    return entry
      ? { kind: "conversation", id: entry.item.id, recordId: event.recordId }
      : { kind: "event", id: event.id, recordId: event.recordId };
  };

  const selectConversation = (itemId: string): AgentDetailSelection | null => {
    const entry = conversationById.get(itemId);
    return entry
      ? { kind: "conversation", id: entry.item.id, recordId: entry.event.recordId }
      : null;
  };

  const selectTrajectory = (itemId: string): AgentDetailSelection | null => {
    const item = getTrajectoryProjection().itemById.get(itemId);
    return item ? { kind: "trajectory", id: item.id, recordId: item.recordId } : null;
  };

  const uniqueToolPairFor = (item: AgentConversationItem) => {
    const group = toolGroupByItem.get(item);
    return group ? uniqueToolPair(group) : null;
  };

  const resolveToolStatus = (item: AgentConversationItem): AgentToolStatus => {
    const lifecycleState = toolLifecycleStates.get(item);
    if (lifecycleState) {
      return lifecycleState.status;
    }

    const result = toolResultBlock(item);
    if (result) {
      return result.status;
    }

    const pair = uniqueToolPairFor(item);
    return pair ? (toolResultBlock(pair[1])?.status ?? "pending") : "pending";
  };

  const resolveToolName = (item: AgentConversationItem): string | undefined => {
    const lifecycleState = toolLifecycleStates.get(item);
    if (lifecycleState) {
      return lifecycleState.toolName;
    }

    const call = toolUseBlock(item);
    if (call) {
      return call.toolName;
    }

    const pair = uniqueToolPairFor(item);
    return pair ? toolUseBlock(pair[0])?.toolName : undefined;
  };

  return {
    events,
    conversation,
    integrityIssues: canonicalSession.integrityIssues,
    get trajectory() {
      return getTrajectoryProjection().model;
    },
    resolveDetail,
    selectEvent,
    selectConversation,
    selectTrajectory,
    resolveToolStatus,
    resolveToolName,
  };
};
