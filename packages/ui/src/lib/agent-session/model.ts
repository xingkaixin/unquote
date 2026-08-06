import type {
  AgentConversationEntry,
  AgentConversationItem,
  AgentDetailSelection,
  AgentSession,
  AgentSessionDetail,
  AgentSessionIntegrityIssue,
  AgentSessionModel,
  AgentTimelineEvent,
  AgentToolStatus,
} from "./types";

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

export const createAgentSessionModel = (session: AgentSession): AgentSessionModel => {
  const events: AgentTimelineEvent[] = [];
  const conversation: AgentConversationEntry[] = [];
  const integrityIssues: AgentSessionIntegrityIssue[] = [];
  const eventById = new Map<string, AgentTimelineEvent>();
  const eventByRecordId = new Map<string, AgentTimelineEvent>();
  const conversationById = new Map<string, AgentConversationEntry>();
  const firstConversationByEventId = new Map<string, AgentConversationEntry>();
  const toolUseByCallId = new Map<string, AgentConversationItem>();
  const toolResultByCallId = new Map<string, AgentConversationItem>();

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
      const callId = toolUseBlock(item)?.toolCallId;
      if (callId) {
        toolUseByCallId.set(callId, item);
      }
      const resultId = toolResultBlock(item)?.toolCallId;
      if (resultId) {
        toolResultByCallId.set(resultId, item);
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

  // A tool call never carries its own outcome; only the paired result does.
  const resolveToolStatus = (item: AgentConversationItem): AgentToolStatus => {
    const result = toolResultBlock(item);
    if (result) {
      return result.status;
    }

    const callId = toolUseBlock(item)?.toolCallId;
    return (
      (callId ? toolResultBlock(toolResultByCallId.get(callId))?.status : undefined) ?? "pending"
    );
  };

  const resolveToolName = (item: AgentConversationItem): string | undefined => {
    const call = toolUseBlock(item);
    if (call) {
      return call.toolName;
    }

    const callId = toolResultBlock(item)?.toolCallId;
    return callId ? toolUseBlock(toolUseByCallId.get(callId))?.toolName : undefined;
  };

  return {
    events,
    conversation,
    integrityIssues,
    resolveDetail,
    selectEvent,
    selectConversation,
    resolveToolStatus,
    resolveToolName,
  };
};
