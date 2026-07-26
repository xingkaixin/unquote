import { describe, expect, it } from "vitest";
import {
  createAgentSessionModel,
  type AgentConversationItem,
  type AgentSession,
  type AgentTimelineEvent,
} from "../src/lib/agent-session";

const event = (
  id: string,
  recordId: string,
  conversationItems: AgentConversationItem[] = [],
): AgentTimelineEvent => ({
  id,
  recordId,
  lineNumber: Number(recordId.replace("record-", "")),
  category: "assistant",
  kind: "message",
  label: id,
  preview: "",
  conversationItems,
});

const session = (events: AgentTimelineEvent[]): AgentSession => ({
  fileType: "Codex",
  meta: { eventCount: events.length, turnCount: 1 },
  events,
  parseWarnings: [],
});

describe("createAgentSessionModel", () => {
  it("resolves timeline, conversation, and Record navigation through one association", () => {
    const first = event("event-1", "record-1");
    const second = event("event-2", "record-2", [{ id: "conversation-2", role: "assistant" }]);
    const model = createAgentSessionModel(session([first, second]));

    const timelineSelection = model.selectEvent("event-2");
    const conversationSelection = model.selectConversation("conversation-2");
    const recordSelection = { kind: "record", recordId: "record-2" } as const;

    expect(timelineSelection).toEqual({
      kind: "conversation",
      id: "conversation-2",
      recordId: "record-2",
    });
    expect(conversationSelection).toEqual(timelineSelection);

    for (const selection of [timelineSelection, conversationSelection, recordSelection]) {
      expect(model.resolveDetail(selection)).toEqual({
        event: second,
        conversationItem: second.conversationItems[0],
        recordId: "record-2",
      });
    }

    expect(model.resolveDetail(model.selectEvent("event-1"))).toEqual({
      event: first,
      recordId: "record-1",
    });
  });

  it("uses the linked Event as the canonical Record source", () => {
    const linkedEvent = event("event-1", "record-1", [{ id: "conversation-1", role: "user" }]);
    const model = createAgentSessionModel(session([linkedEvent]));

    expect(
      model.resolveDetail({
        kind: "conversation",
        id: "conversation-1",
        recordId: "wrong-record",
      }),
    ).toMatchObject({ event: linkedEvent, recordId: "record-1" });
    expect(
      model.resolveDetail({ kind: "event", id: "event-1", recordId: "wrong-record" }),
    ).toMatchObject({ event: linkedEvent, recordId: "record-1" });
  });

  it("defaults only an empty selection and rejects missing associations", () => {
    const first = event("event-1", "record-1");
    const model = createAgentSessionModel(session([first]));

    expect(model.resolveDetail(null)).toEqual({ event: first, recordId: "record-1" });
    expect(model.resolveDetail({ kind: "record", recordId: "missing" })).toBeNull();
    expect(model.resolveDetail({ kind: "event", id: "missing", recordId: "record-1" })).toBeNull();
    expect(
      model.resolveDetail({ kind: "conversation", id: "missing", recordId: "record-1" }),
    ).toBeNull();
  });

  it("reports ambiguous identities and excludes them from navigation", () => {
    const first = event("event-1", "record-1", [{ id: "conversation-1", role: "assistant" }]);
    const duplicateEvent = event("event-1", "record-2");
    const duplicateRecord = event("event-3", "record-1");
    const duplicateConversation = event("event-4", "record-4", [
      { id: "conversation-1", role: "user" },
    ]);
    const model = createAgentSessionModel(
      session([first, duplicateEvent, duplicateRecord, duplicateConversation]),
    );

    expect(model.integrityIssues).toEqual([
      { kind: "duplicate-event-id", id: "event-1" },
      { kind: "duplicate-record-id", recordId: "record-1" },
      { kind: "duplicate-conversation-id", id: "conversation-1" },
    ]);
    expect(model.events).toEqual([first, duplicateConversation]);
    expect(model.conversation).toHaveLength(1);
    expect(model.selectEvent("event-4")).toEqual({
      kind: "event",
      id: "event-4",
      recordId: "record-4",
    });
    expect(model.resolveDetail(model.selectEvent("event-4"))).toEqual({
      event: duplicateConversation,
      recordId: "record-4",
    });
  });
});
