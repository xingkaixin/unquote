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
import { createAgentToolLifecycleIndex } from "./tool-lifecycle";
import { createAgentTrajectoryModelFromCanonicalSession } from "./trajectory-model";

const detailForEvent = (
  event: AgentTimelineEvent,
  conversationItem: AgentConversationEntry["item"] | undefined,
): AgentSessionDetail => ({
  event,
  ...(conversationItem ? { conversationItem } : {}),
  recordId: event.recordId,
});

export const createAgentSessionModel = (session: AgentSession): AgentSessionModel => {
  const canonicalSession = canonicalizeAgentSession(session);
  const toolLifecycle = createAgentToolLifecycleIndex(canonicalSession);
  const events: AgentTimelineEvent[] = [];
  const conversation: AgentConversationEntry[] = [];
  const eventById = new Map<string, AgentTimelineEvent>();
  const eventByRecordId = new Map<string, AgentTimelineEvent>();
  const conversationById = new Map<string, AgentConversationEntry>();
  const firstConversationByEventId = new Map<string, AgentConversationEntry>();

  for (const { event, conversationItems } of canonicalSession.events) {
    events.push(event);
    eventById.set(event.id, event);
    eventByRecordId.set(event.recordId, event);
    for (const item of conversationItems) {
      const entry = { item, event };
      conversation.push(entry);
      conversationById.set(item.id, entry);
      if (!firstConversationByEventId.has(event.id)) {
        firstConversationByEventId.set(event.id, entry);
      }
    }
  }

  let trajectoryProjection:
    | {
        model: AgentTrajectoryModel;
        itemById: ReadonlyMap<string, AgentTrajectoryItem>;
      }
    | undefined;

  const getTrajectoryProjection = () => {
    if (!trajectoryProjection) {
      const model = measurePerfFn("agentTrajectory:build", () =>
        createAgentTrajectoryModelFromCanonicalSession(canonicalSession, toolLifecycle),
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

  const resolveToolStatus = (item: AgentConversationItem): AgentToolStatus => {
    return toolLifecycle.stateByConversationItem.get(item)?.status ?? "pending";
  };

  const resolveToolName = (item: AgentConversationItem): string | undefined =>
    toolLifecycle.stateByConversationItem.get(item)?.toolName;

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
