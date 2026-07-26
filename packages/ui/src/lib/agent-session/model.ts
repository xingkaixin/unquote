import type {
  AgentConversationEntry,
  AgentDetailSelection,
  AgentSession,
  AgentSessionDetail,
  AgentSessionIntegrityIssue,
  AgentSessionModel,
  AgentTimelineEvent,
} from "./types";

const detailForEvent = (
  event: AgentTimelineEvent,
  conversationItem: AgentConversationEntry["item"] | undefined,
): AgentSessionDetail => ({
  event,
  ...(conversationItem ? { conversationItem } : {}),
  recordId: event.recordId,
});

export const createAgentSessionModel = (session: AgentSession): AgentSessionModel => {
  const events: AgentTimelineEvent[] = [];
  const conversation: AgentConversationEntry[] = [];
  const integrityIssues: AgentSessionIntegrityIssue[] = [];
  const eventById = new Map<string, AgentTimelineEvent>();
  const eventByRecordId = new Map<string, AgentTimelineEvent>();
  const conversationById = new Map<string, AgentConversationEntry>();
  const firstConversationByEventId = new Map<string, AgentConversationEntry>();

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

  return {
    events,
    conversation,
    integrityIssues,
    resolveDetail,
    selectEvent,
    selectConversation,
  };
};
