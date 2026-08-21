import type {
  AgentConversationItem,
  AgentSession,
  AgentSessionIntegrityIssue,
  AgentTimelineEvent,
} from "./types";

export interface CanonicalAgentEvent {
  event: AgentTimelineEvent;
  conversationItems: readonly AgentConversationItem[];
  conversationItemIds: ReadonlySet<string>;
}

export interface CanonicalAgentSession {
  events: readonly CanonicalAgentEvent[];
  integrityIssues: readonly AgentSessionIntegrityIssue[];
}

export const canonicalizeAgentSession = (session: AgentSession): CanonicalAgentSession => {
  const events: CanonicalAgentEvent[] = [];
  const integrityIssues: AgentSessionIntegrityIssue[] = [];
  const eventIds = new Set<string>();
  const recordIds = new Set<string>();
  const conversationIds = new Set<string>();

  for (const event of session.events) {
    if (eventIds.has(event.id)) {
      integrityIssues.push({ kind: "duplicate-event-id", id: event.id });
      continue;
    }
    if (recordIds.has(event.recordId)) {
      integrityIssues.push({ kind: "duplicate-record-id", recordId: event.recordId });
      continue;
    }

    eventIds.add(event.id);
    recordIds.add(event.recordId);
    const conversationItems: AgentConversationItem[] = [];
    const conversationItemIds = new Set<string>();
    for (const item of event.conversationItems) {
      if (conversationIds.has(item.id)) {
        integrityIssues.push({ kind: "duplicate-conversation-id", id: item.id });
        continue;
      }
      conversationIds.add(item.id);
      conversationItems.push(item);
      conversationItemIds.add(item.id);
    }
    events.push({ event, conversationItems, conversationItemIds });
  }

  return { events, integrityIssues };
};
