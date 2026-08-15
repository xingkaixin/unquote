import type {
  AgentConversationEntry,
  AgentConversationItem,
  AgentDetailSelection,
  AgentSession,
  AgentSessionDetail,
  AgentSessionIntegrityIssue,
  AgentSessionModel,
  AgentTimelineEvent,
  AgentTrajectoryModel,
  AgentTrajectoryToolItem,
  AgentToolStatus,
} from "./types";
import { measurePerfFn } from "../perf";
import {
  createToolCorrelationGroups,
  toolCorrelationGroupFor,
  toolCorrelationScope,
  uniqueToolPair,
  type ToolCorrelationGroup,
} from "./tool-correlation";
import { createAgentTrajectoryModel } from "./trajectory-model";

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
  const events: AgentTimelineEvent[] = [];
  const conversation: AgentConversationEntry[] = [];
  const integrityIssues: AgentSessionIntegrityIssue[] = [];
  const eventById = new Map<string, AgentTimelineEvent>();
  const eventByRecordId = new Map<string, AgentTimelineEvent>();
  const conversationById = new Map<string, AgentConversationEntry>();
  const firstConversationByEventId = new Map<string, AgentConversationEntry>();
  const toolGroups = createToolCorrelationGroups<AgentConversationItem, AgentConversationItem>();
  const toolGroupByItem = new Map<AgentConversationItem, ToolGroup>();

  for (const event of session.events) {
    if (eventById.has(event.id)) {
      integrityIssues.push({ kind: "duplicate-event-id", id: event.id });
      continue;
    }
    if (eventByRecordId.has(event.recordId)) {
      integrityIssues.push({ kind: "duplicate-record-id", recordId: event.recordId });
      continue;
    }

    events.push(event);
    eventById.set(event.id, event);
    eventByRecordId.set(event.recordId, event);
    const evidenceTurnIds = explicitTurnIdsByConversationItem(event);

    for (const item of event.conversationItems) {
      if (conversationById.has(item.id)) {
        integrityIssues.push({ kind: "duplicate-conversation-id", id: item.id });
        continue;
      }
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

  const trajectory: AgentTrajectoryModel = measurePerfFn("agentTrajectory:build", () =>
    createAgentTrajectoryModel(session),
  );
  const trajectoryToolByConversationItem = new Map<
    AgentConversationItem,
    AgentTrajectoryToolItem
  >();

  for (const item of trajectory.items) {
    if (item.kind !== "tool") {
      continue;
    }
    for (const selection of [item.callSelection, item.resultSelection]) {
      if (!selection || selection.kind !== "conversation") {
        continue;
      }
      const entry = conversationById.get(selection.id);
      if (entry && entry.event.recordId === selection.recordId) {
        trajectoryToolByConversationItem.set(entry.item, item);
      }
    }
  }

  const resolveEvent = (event: AgentTimelineEvent) =>
    detailForEvent(event, firstConversationByEventId.get(event.id)?.item);

  const resolveDetail = (selection: AgentDetailSelection | null): AgentSessionDetail | null => {
    if (!selection) {
      const event = events[0];
      return event ? resolveEvent(event) : null;
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

  const uniqueToolPairFor = (item: AgentConversationItem) => {
    const group = toolGroupByItem.get(item);
    return group ? uniqueToolPair(group) : null;
  };

  const resolveToolStatus = (item: AgentConversationItem): AgentToolStatus => {
    const trajectoryTool = trajectoryToolByConversationItem.get(item);
    if (trajectoryTool) {
      return trajectoryTool.status === "running" ? "pending" : trajectoryTool.status;
    }

    const result = toolResultBlock(item);
    if (result) {
      return result.status;
    }

    const pair = uniqueToolPairFor(item);
    return pair ? (toolResultBlock(pair[1])?.status ?? "pending") : "pending";
  };

  const resolveToolName = (item: AgentConversationItem): string | undefined => {
    const trajectoryTool = trajectoryToolByConversationItem.get(item);
    if (trajectoryTool) {
      return trajectoryTool.toolName;
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
    integrityIssues,
    trajectory,
    resolveDetail,
    selectEvent,
    selectConversation,
    resolveToolStatus,
    resolveToolName,
  };
};
