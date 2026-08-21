import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentConversationItem,
  type AgentSession,
  type AgentTimelineEvent,
  type AgentTrajectoryToolItem,
} from "../src/lib/agent-session";

const trajectoryMeasureName = "unquote:agentTrajectory:build";

afterEach(() => {
  vi.restoreAllMocks();
  performance.clearMeasures(trajectoryMeasureName);
});

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
  meta: { turnCount: 1 },
  events,
  parseWarnings: [],
  parseWarningCount: 0,
});

describe("createAgentSessionModel", () => {
  it("owns the trajectory derived from the supplied session", () => {
    const source = session([
      {
        ...event("event-1", "record-1"),
        trajectoryEvidence: [
          { kind: "turn-lifecycle", phase: "start", turnId: "turn-1" },
          { kind: "turn-lifecycle", phase: "complete", turnId: "turn-1" },
        ],
      },
    ]);

    const model = createAgentSessionModel(source);

    expect(model.trajectory).toEqual(createAgentTrajectoryModel(source));
  });

  it("records one finite, non-negative trajectory build measure on first access", () => {
    performance.clearMeasures(trajectoryMeasureName);

    const model = createAgentSessionModel(session([event("event-1", "record-1")]));

    expect(performance.getEntriesByName(trajectoryMeasureName, "measure")).toHaveLength(0);

    const trajectory = model.trajectory;

    const measures = performance.getEntriesByName(trajectoryMeasureName, "measure");
    expect(measures).toHaveLength(1);
    expect(measures[0]?.duration).toSatisfy(
      (duration) => typeof duration === "number" && Number.isFinite(duration) && duration >= 0,
    );
    expect(model.trajectory).toBe(trajectory);
    expect(performance.getEntriesByName(trajectoryMeasureName, "measure")).toHaveLength(1);
  });

  it("keeps direct trajectory construction free of User Timing", () => {
    performance.clearMeasures(trajectoryMeasureName);

    createAgentTrajectoryModel(session([event("event-1", "record-1")]));

    expect(performance.getEntriesByName(trajectoryMeasureName, "measure")).toHaveLength(0);
  });

  it("preserves model behavior when User Timing cannot record a measure", () => {
    const sourceEvent = event("event-1", "record-1", [{ id: "conversation-1", role: "assistant" }]);
    const source = session([sourceEvent]);
    vi.spyOn(performance, "measure").mockImplementation(() => {
      throw new Error("User Timing is unavailable");
    });

    const model = createAgentSessionModel(source);

    expect(model.events).toEqual([sourceEvent]);
    expect(model.conversation).toEqual([
      { event: sourceEvent, item: sourceEvent.conversationItems[0] },
    ]);
    expect(model.resolveDetail(null)).toEqual({
      event: sourceEvent,
      conversationItem: sourceEvent.conversationItems[0],
      recordId: "record-1",
    });
    expect(model.trajectory).toEqual(createAgentTrajectoryModel(source));
  });

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

  it("resolves each trajectory item through its canonical selection", () => {
    const first = { id: "conversation-1", role: "assistant" } as const;
    const second = { id: "conversation-2", role: "thinking" } as const;
    const sourceEvent = {
      ...event("event-1", "record-1", [first, second]),
      trajectoryEvidence: [
        { kind: "model-output", role: "assistant", conversationItemId: first.id },
        { kind: "model-output", role: "reasoning", conversationItemId: second.id },
      ],
    } satisfies AgentTimelineEvent;
    const model = createAgentSessionModel(session([sourceEvent]));
    const firstSelection = model.selectTrajectory("event-1:evidence-0");
    const secondSelection = model.selectTrajectory("event-1:evidence-1");

    expect(firstSelection).toEqual({
      kind: "trajectory",
      id: "event-1:evidence-0",
      recordId: "record-1",
    });
    expect(secondSelection).toEqual({
      kind: "trajectory",
      id: "event-1:evidence-1",
      recordId: "record-1",
    });
    expect(model.resolveDetail({ ...firstSelection!, recordId: "forged-record" })).toMatchObject({
      event: sourceEvent,
      conversationItem: first,
      recordId: "record-1",
    });
    expect(model.resolveDetail(secondSelection)).toMatchObject({
      event: sourceEvent,
      conversationItem: second,
      recordId: "record-1",
    });
    expect(model.selectTrajectory("missing")).toBeNull();
    expect(
      model.resolveDetail({ kind: "trajectory", id: "missing", recordId: "record-1" }),
    ).toBeNull();
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

describe("tool call and result pairing", () => {
  const call = (
    id: string,
    callId?: string,
    turnIndex?: number,
    toolName = "shell",
  ): AgentConversationItem => ({
    id,
    role: "tool_call",
    ...(turnIndex === undefined ? {} : { turnIndex }),
    block: {
      type: "tool_use",
      text: "{}",
      toolName,
      ...(callId ? { toolCallId: callId } : {}),
    },
  });
  const result = (
    id: string,
    status: "completed" | "failed",
    callId?: string,
    turnIndex?: number,
  ): AgentConversationItem => ({
    id,
    role: "tool_result",
    ...(turnIndex === undefined ? {} : { turnIndex }),
    block: { type: "tool_result", text: "out", status, ...(callId ? { toolCallId: callId } : {}) },
  });

  it("reads a call's status from its paired result", () => {
    const failing = call("call-failed", "id-2", 2);
    const succeeding = call("call-done", "id-1", 1);
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [succeeding, result("result-done", "completed", "id-1", 1)]),
        event("event-2", "record-2", [failing, result("result-failed", "failed", "id-2", 2)]),
      ]),
    );

    expect(model.resolveToolStatus(succeeding)).toBe("completed");
    expect(model.resolveToolStatus(failing)).toBe("failed");
  });

  it("reports an unpaired call as pending and never invents an outcome", () => {
    const unpaired = call("call-1", "id-1");
    const idless = call("call-2");
    const model = createAgentSessionModel(
      session([event("event-1", "record-1", [unpaired, idless])]),
    );

    expect(model.resolveToolStatus(unpaired)).toBe("pending");
    expect(model.resolveToolStatus(idless)).toBe("pending");
  });

  it("keeps a result's own status and borrows the paired call's tool name", () => {
    const paired = result("result-1", "completed", "id-1", 1);
    const orphan = result("result-2", "failed", "missing");
    const model = createAgentSessionModel(
      session([event("event-1", "record-1", [call("call-1", "id-1", 1), paired, orphan])]),
    );

    expect(model.resolveToolStatus(paired)).toBe("completed");
    expect(model.resolveToolStatus(orphan)).toBe("failed");
    expect(model.resolveToolName(paired)).toBe("shell");
    expect(model.resolveToolName(orphan)).toBeUndefined();
  });

  it("does not pair a matching call ID across turns", () => {
    const firstTurnCall = call("call-a", "shared", 1);
    const secondTurnResult = result("result-b", "completed", "shared", 2);
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [firstTurnCall]),
        event("event-2", "record-2", [secondTurnResult]),
      ]),
    );

    expect(model.resolveToolStatus(firstTurnCall)).toBe("pending");
    expect(model.resolveToolName(secondTurnResult)).toBeUndefined();
  });

  it("pairs repeated call IDs independently within each turn", () => {
    const firstTurnCall = call("call-a", "shared", 1, "shell");
    const firstTurnResult = result("result-a", "completed", "shared", 1);
    const secondTurnCall = call("call-b", "shared", 2, "read_file");
    const secondTurnResult = result("result-b", "failed", "shared", 2);
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [firstTurnCall, firstTurnResult]),
        event("event-2", "record-2", [secondTurnCall, secondTurnResult]),
      ]),
    );

    expect(model.resolveToolStatus(firstTurnCall)).toBe("completed");
    expect(model.resolveToolName(firstTurnResult)).toBe("shell");
    expect(model.resolveToolStatus(secondTurnCall)).toBe("failed");
    expect(model.resolveToolName(secondTurnResult)).toBe("read_file");
  });

  it("pairs unscoped call IDs within the anonymous scope", () => {
    const unscopedCall = call("call-1", "shared");
    const unscopedResult = result("result-1", "completed", "shared");
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [unscopedCall]),
        event("event-2", "record-2", [unscopedResult]),
      ]),
    );

    expect(model.resolveToolStatus(unscopedCall)).toBe("completed");
    expect(model.resolveToolStatus(unscopedResult)).toBe("completed");
    expect(model.resolveToolName(unscopedResult)).toBe("shell");
  });

  it("does not borrow across an ambiguous anonymous call group", () => {
    const firstCall = call("first-call", "duplicate", undefined, "shell");
    const secondCall = call("second-call", "duplicate", undefined, "read_file");
    const onlyResult = result("only-result", "completed", "duplicate");
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [firstCall]),
        event("event-2", "record-2", [secondCall]),
        event("event-3", "record-3", [onlyResult]),
      ]),
    );

    expect(model.resolveToolStatus(firstCall)).toBe("pending");
    expect(model.resolveToolStatus(secondCall)).toBe("pending");
    expect(model.resolveToolStatus(onlyResult)).toBe("completed");
    expect(model.resolveToolName(onlyResult)).toBeUndefined();
  });

  it("isolates explicit turns and the anonymous scope for a shared call ID", () => {
    const firstTurnCall = call("first-turn-call", "shared", 1, "shell");
    const secondTurnCall = call("second-turn-call", "shared", 2, "read_file");
    const anonymousCall = call("anonymous-call", "shared", undefined, "search");
    const firstTurnResult = result("first-turn-result", "completed", "shared", 1);
    const secondTurnResult = result("second-turn-result", "failed", "shared", 2);
    const anonymousResult = result("anonymous-result", "completed", "shared");
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [firstTurnCall, secondTurnCall, anonymousCall]),
        event("event-2", "record-2", [firstTurnResult, secondTurnResult, anonymousResult]),
      ]),
    );

    expect(model.resolveToolStatus(firstTurnCall)).toBe("completed");
    expect(model.resolveToolStatus(secondTurnCall)).toBe("failed");
    expect(model.resolveToolStatus(anonymousCall)).toBe("completed");
    expect(model.resolveToolName(firstTurnResult)).toBe("shell");
    expect(model.resolveToolName(secondTurnResult)).toBe("read_file");
    expect(model.resolveToolName(anonymousResult)).toBe("search");
  });

  it("does not pair unscoped call IDs with explicit turns", () => {
    const unscopedCall = call("call-1", "shared");
    const scopedResult = result("result-1", "completed", "shared", 1);
    const model = createAgentSessionModel(
      session([
        event("event-1", "record-1", [unscopedCall]),
        event("event-2", "record-2", [scopedResult]),
      ]),
    );

    expect(model.resolveToolStatus(unscopedCall)).toBe("pending");
    expect(model.resolveToolName(scopedResult)).toBeUndefined();
  });

  it("uses the same normalized tool scope as the trajectory projection", () => {
    const sameTurnCall = call("same-turn-call", "same", 1);
    const sameTurnResult = result("same-turn-result", "completed", "same", 2);
    const differentTurnCall = call("different-turn-call", "different", 3, "read");
    const differentTurnResult = result("different-turn-result", "completed", "different", 3);
    const anonymousCall = call("anonymous-call", "anonymous", undefined, "search");
    const anonymousResult = result("anonymous-result", "completed", "anonymous");
    const duplicateCallOne = call("duplicate-call-one", "duplicate", 4, "first");
    const duplicateCallTwo = call("duplicate-call-two", "duplicate", 4, "second");
    const duplicateResult = result("duplicate-result", "completed", "duplicate", 4);
    const source = session([
      {
        ...event("same-turn-call-event", "record-10", [sameTurnCall]),
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            toolName: "shell",
            callId: "same",
            conversationItemId: sameTurnCall.id,
            turnId: "same-turn",
          },
        ],
      },
      {
        ...event("same-turn-result-event", "record-11", [sameTurnResult]),
        turnIndex: 2,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            status: "completed",
            callId: "same",
            conversationItemId: sameTurnResult.id,
            turnId: "same-turn",
          },
        ],
      },
      {
        ...event("different-turn-call-event", "record-12", [differentTurnCall]),
        turnIndex: 3,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            toolName: "read",
            callId: "different",
            conversationItemId: differentTurnCall.id,
            turnId: "left",
          },
        ],
      },
      {
        ...event("different-turn-result-event", "record-13", [differentTurnResult]),
        turnIndex: 3,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            status: "completed",
            callId: "different",
            conversationItemId: differentTurnResult.id,
            turnId: "right",
          },
        ],
      },
      {
        ...event("anonymous-call-event", "record-14", [anonymousCall]),
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            toolName: "search",
            callId: "anonymous",
            conversationItemId: anonymousCall.id,
          },
        ],
      },
      {
        ...event("anonymous-result-event", "record-15", [anonymousResult]),
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            status: "completed",
            callId: "anonymous",
            conversationItemId: anonymousResult.id,
          },
        ],
      },
      {
        ...event("duplicate-call-one-event", "record-16", [duplicateCallOne]),
        turnIndex: 4,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            toolName: "first",
            callId: "duplicate",
            conversationItemId: duplicateCallOne.id,
            turnId: "duplicate-turn",
          },
        ],
      },
      {
        ...event("duplicate-call-two-event", "record-17", [duplicateCallTwo]),
        turnIndex: 4,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            toolName: "second",
            callId: "duplicate",
            conversationItemId: duplicateCallTwo.id,
            turnId: "duplicate-turn",
          },
        ],
      },
      {
        ...event("duplicate-result-event", "record-18", [duplicateResult]),
        turnIndex: 4,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            status: "completed",
            callId: "duplicate",
            conversationItemId: duplicateResult.id,
            turnId: "duplicate-turn",
          },
        ],
      },
    ]);
    const model = createAgentSessionModel(source);
    const trajectory = createAgentTrajectoryModel(source);

    expect(model.resolveToolStatus(sameTurnCall)).toBe("completed");
    expect(model.resolveToolName(sameTurnResult)).toBe("shell");
    expect(model.resolveToolStatus(differentTurnCall)).toBe("pending");
    expect(model.resolveToolName(differentTurnResult)).toBeUndefined();
    expect(model.resolveToolStatus(anonymousCall)).toBe("completed");
    expect(model.resolveToolName(anonymousResult)).toBe("search");
    expect(model.resolveToolStatus(duplicateCallOne)).toBe("pending");
    expect(model.resolveToolStatus(duplicateCallTwo)).toBe("pending");
    expect(model.resolveToolName(duplicateResult)).toBeUndefined();

    const sameTools = trajectory.items.filter(
      (item): item is AgentTrajectoryToolItem => item.kind === "tool" && item.callId === "same",
    );
    expect(sameTools).toHaveLength(1);
    expect(sameTools[0]).toMatchObject({
      status: "completed",
      callSelection: { kind: "conversation", id: sameTurnCall.id, recordId: "record-10" },
      resultSelection: { kind: "conversation", id: sameTurnResult.id, recordId: "record-11" },
    });

    const anonymousTools = trajectory.items.filter(
      (item): item is AgentTrajectoryToolItem =>
        item.kind === "tool" && item.callId === "anonymous",
    );
    expect(anonymousTools).toHaveLength(1);
    expect(anonymousTools[0]).toMatchObject({
      status: "completed",
      callSelection: { kind: "conversation", id: anonymousCall.id, recordId: "record-14" },
      resultSelection: { kind: "conversation", id: anonymousResult.id, recordId: "record-15" },
    });

    const differentTools = trajectory.items.filter(
      (item): item is AgentTrajectoryToolItem =>
        item.kind === "tool" && item.callId === "different",
    );
    expect(differentTools).toHaveLength(2);
    expect(differentTools.every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );

    const duplicateTools = trajectory.items.filter(
      (item): item is AgentTrajectoryToolItem =>
        item.kind === "tool" && item.callId === "duplicate",
    );
    expect(duplicateTools).toHaveLength(3);
    expect(duplicateTools.every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
  });

  it("keeps legacy pairing for an unprojected tool in a mixed session", () => {
    const legacyCall = call("legacy-call", "legacy", undefined, "read_file");
    const legacyResult = result("legacy-result", "completed", "legacy");
    const model = createAgentSessionModel(
      session([
        {
          ...event("projected-output", "record-1", [{ id: "output", role: "assistant" }]),
          trajectoryEvidence: [
            { kind: "model-output", role: "assistant", conversationItemId: "output" },
          ],
        },
        event("legacy-call-event", "record-2", [legacyCall]),
        event("legacy-result-event", "record-3", [legacyResult]),
      ]),
    );

    expect(model.resolveToolStatus(legacyCall)).toBe("completed");
    expect(model.resolveToolName(legacyResult)).toBe("read_file");
  });

  it("uses a projected completion status for both a call and its output", () => {
    const projectedCall = call("projected-call", "projected", 1, "mcp_tool");
    const projectedResult = result("projected-result", "completed", "projected", 1);
    const model = createAgentSessionModel(
      session([
        {
          ...event("projected-call-event", "record-1", [projectedCall]),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "call",
              toolName: "mcp_tool",
              callId: "projected",
              turnId: "turn-projected",
              conversationItemId: projectedCall.id,
            },
          ],
        },
        {
          ...event("projected-completion-event", "record-2"),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "completion",
              status: "failed",
              callId: "projected",
              turnId: "turn-projected",
            },
          ],
        },
        {
          ...event("projected-result-event", "record-3", [projectedResult]),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "result",
              status: "completed",
              callId: "projected",
              turnId: "turn-projected",
              conversationItemId: projectedResult.id,
            },
          ],
        },
      ]),
    );

    expect(model.resolveToolStatus(projectedCall)).toBe("failed");
    expect(model.resolveToolStatus(projectedResult)).toBe("failed");
    expect(model.resolveToolName(projectedResult)).toBe("mcp_tool");
    expect(performance.getEntriesByName(trajectoryMeasureName, "measure")).toHaveLength(0);
  });

  it("does not recover a result name after duplicate completion evidence", () => {
    const projectedCall = call("projected-call", "repeated", 1, "read_file");
    const projectedResult = result("projected-result", "completed", "repeated", 1);
    const model = createAgentSessionModel(
      session([
        {
          ...event("projected-call-event", "record-1", [projectedCall]),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "call",
              toolName: "read_file",
              callId: "repeated",
              turnId: "turn-projected",
              conversationItemId: projectedCall.id,
            },
          ],
        },
        {
          ...event("projected-result-event", "record-2", [projectedResult]),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "result",
              status: "completed",
              callId: "repeated",
              turnId: "turn-projected",
              conversationItemId: projectedResult.id,
            },
          ],
        },
        {
          ...event("projected-completion-event-1", "record-3"),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "completion",
              status: "completed",
              callId: "repeated",
              turnId: "turn-projected",
            },
          ],
        },
        {
          ...event("projected-completion-event-2", "record-4"),
          turnIndex: 1,
          trajectoryEvidence: [
            {
              kind: "tool-lifecycle",
              phase: "completion",
              status: "completed",
              callId: "repeated",
              turnId: "turn-projected",
            },
          ],
        },
      ]),
    );
    const projectedTools = model.trajectory.items.filter(
      (item): item is AgentTrajectoryToolItem => item.kind === "tool" && item.callId === "repeated",
    );

    expect(projectedTools).toHaveLength(4);
    expect(
      projectedTools.every(
        (item) =>
          [item.callSelection, item.resultSelection, item.completionSelection].filter(Boolean)
            .length === 1,
      ),
    ).toBe(true);
    expect(projectedTools.find((item) => item.resultSelection)?.toolName).toBeUndefined();
    expect(model.resolveToolName(projectedResult)).toBeUndefined();
  });

  it("has no tool name or outcome for a plain message", () => {
    const message: AgentConversationItem = {
      id: "item-1",
      role: "assistant",
      block: { type: "text", text: "hello" },
    };
    const model = createAgentSessionModel(session([event("event-1", "record-1", [message])]));

    expect(model.resolveToolName(message)).toBeUndefined();
    expect(model.resolveToolStatus(message)).toBe("pending");
  });
});
