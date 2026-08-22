import { describe, expect, it } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentTrajectoryEvidence,
  type AgentTimelineEvent,
} from "../src/lib/agent-session";
import {
  event,
  session,
  conversation,
  lifecycle,
  modelOutput,
  toolCall,
  toolResult,
  toolItems,
  warningKinds,
  trajectoryTurnId,
} from "./agent-trajectory-model.support";

describe("createAgentTrajectoryModel: correlation-and-integrity", () => {
  it("does not silently pair duplicate results for one call id in a turn", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("duplicate-result-call", "record-duplicate-result-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "duplicate-result"), turnId: "turn" }],
        }),
        event("first-duplicate-result", "record-first-duplicate-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "duplicate-result"), turnId: "turn" }],
        }),
        event("second-duplicate-result", "record-second-duplicate-result", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "duplicate-result"), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(3);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-result-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });

  it("filters a duplicate Event before unscoped tool pairing", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("unscoped-event", "record-unscoped-call", 1, {
          trajectoryEvidence: [toolCall("shell", "unscoped")],
        }),
        event("unscoped-event", "record-unscoped-result", 2, {
          trajectoryEvidence: [toolResult("completed", "unscoped")],
        }),
      ]),
    );

    expect(toolItems(model).map((item) => item.status)).toEqual(["running"]);
    expect(warningKinds(model)).toContain("unpaired-tool-call");
    expect(warningKinds(model)).not.toContain("unpaired-tool-result");
  });

  it("pairs anonymous call ids across canonical Events with canonical selections", () => {
    const call = conversation("anonymous-call", "tool_call");
    const result = conversation("anonymous-result", "tool_result");
    const source = session([
      event("anonymous-call-event", "record-anonymous-call", 1, {
        timestamp: 10,
        conversationItems: [call],
        trajectoryEvidence: [toolCall("shell", "anonymous", call.id)],
      }),
      event("anonymous-result-event", "record-anonymous-result", 2, {
        timestamp: 25,
        conversationItems: [result],
        trajectoryEvidence: [toolResult("completed", "anonymous", undefined, result.id)],
      }),
    ]);
    const model = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(toolItems(model)).toMatchObject([
      {
        id: "anonymous-call-event:evidence-0",
        status: "completed",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
        callSelection: {
          kind: "conversation",
          id: "anonymous-call",
          recordId: "record-anonymous-call",
        },
        resultSelection: {
          kind: "conversation",
          id: "anonymous-result",
          recordId: "record-anonymous-result",
        },
      },
    ]);
    expect(warningKinds(model)).not.toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
    const [tool] = toolItems(model);
    expect(canonical.resolveDetail(tool?.callSelection ?? null)?.recordId).toBe(
      "record-anonymous-call",
    );
    expect(canonical.resolveDetail(tool?.resultSelection ?? null)?.recordId).toBe(
      "record-anonymous-result",
    );
  });

  it("leaves ambiguous anonymous call ids unpaired with duplicate warnings", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("anonymous-call-one", "record-anonymous-call-one", 1, {
          trajectoryEvidence: [toolCall("shell", "anonymous-duplicate")],
        }),
        event("anonymous-call-two", "record-anonymous-call-two", 2, {
          trajectoryEvidence: [toolCall("read_file", "anonymous-duplicate")],
        }),
        event("anonymous-result", "record-anonymous-result", 3, {
          trajectoryEvidence: [toolResult("completed", "anonymous-duplicate")],
        }),
      ]),
    );

    expect(toolItems(model).map((item) => item.status)).toEqual([
      "running",
      "running",
      "completed",
    ]);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-call-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
      ]),
    );
  });

  it("keeps explicit turns and the anonymous scope isolated for a shared call id", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("turn-a-call", "record-turn-a-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("turn-a", "shared"), turnId: "turn-a" }],
        }),
        event("turn-b-call", "record-turn-b-call", 2, {
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolCall("turn-b", "shared"), turnId: "turn-b" }],
        }),
        event("anonymous-call", "record-anonymous-call", 3, {
          trajectoryEvidence: [toolCall("anonymous", "shared")],
        }),
        event("turn-a-result", "record-turn-a-result", 4, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "shared"), turnId: "turn-a" }],
        }),
        event("turn-b-result", "record-turn-b-result", 5, {
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolResult("failed", "shared"), turnId: "turn-b" }],
        }),
        event("anonymous-result", "record-anonymous-result", 6, {
          trajectoryEvidence: [toolResult("completed", "shared")],
        }),
      ]),
    );

    expect(
      toolItems(model).map(({ toolName, status, callId }) => ({ toolName, status, callId })),
    ).toEqual([
      { toolName: "turn-a", status: "completed", callId: "shared" },
      { toolName: "turn-b", status: "failed", callId: "shared" },
      { toolName: "anonymous", status: "completed", callId: "shared" },
    ]);
  });

  it("preserves an aborted lifecycle without inventing a tool outcome", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("start", "record-start", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("aborted-turn", "start")],
        }),
        event("call", "record-call", 2, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "open"), turnId: "aborted-turn" }],
        }),
        event("abort", "record-abort", 3, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("aborted-turn", "aborted")],
        }),
      ]),
    );

    expect(model.turns[0]?.status).toBe("aborted");
    expect(toolItems(model)[0]?.status).toBe("running");
    expect(warningKinds(model)).not.toContain("open-turn");
  });

  it("projects observed subagent states and compaction facts only when their evidence exists", () => {
    const source = session([
      event("subagent", "opaque:subagent", 7, {
        trajectoryEvidence: [{ kind: "subagent-activity", status: "running" }],
      }),
      event("failed-subagent", "opaque:failed-subagent", 8, {
        trajectoryEvidence: [{ kind: "subagent-activity", status: "failed" }],
      }),
      event("compaction", "opaque:compaction", 9, {
        trajectoryEvidence: [{ kind: "compaction" }],
      }),
    ]);
    const model = createAgentTrajectoryModel(source);
    const canonicalModel = createAgentSessionModel(source);

    expect(
      model.items.map(({ kind, status, recordId, lineNumber, selection }) => ({
        kind,
        status,
        recordId,
        lineNumber,
        selection,
      })),
    ).toEqual([
      {
        kind: "subagent",
        status: "running",
        recordId: "opaque:subagent",
        lineNumber: 7,
        selection: { kind: "event", id: "subagent", recordId: "opaque:subagent" },
      },
      {
        kind: "subagent",
        status: "failed",
        recordId: "opaque:failed-subagent",
        lineNumber: 8,
        selection: {
          kind: "event",
          id: "failed-subagent",
          recordId: "opaque:failed-subagent",
        },
      },
      {
        kind: "compaction",
        status: "completed",
        recordId: "opaque:compaction",
        lineNumber: 9,
        selection: { kind: "event", id: "compaction", recordId: "opaque:compaction" },
      },
    ]);
    for (const item of model.items) {
      expect(canonicalModel.resolveDetail(item.selection)?.recordId).toBe(item.recordId);
    }
  });

  it("keeps duplicate conversation ids local to their canonical Event", () => {
    const first = conversation("shared-conversation", "assistant");
    const second = conversation("shared-conversation", "assistant");
    const source = session([
      event("first-event", "record-first", 1, {
        conversationItems: [first],
        trajectoryEvidence: [modelOutput("assistant", first.id)],
      }),
      event("second-event", "record-second", 2, {
        conversationItems: [second],
        trajectoryEvidence: [modelOutput("assistant", second.id)],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items).toHaveLength(2);
    expect(trajectory.items[0]?.id).not.toBe(trajectory.items[1]?.id);
    expect(trajectory.items[0]?.selection).toEqual({
      kind: "conversation",
      id: "shared-conversation",
      recordId: "record-first",
    });
    expect(trajectory.items[1]?.selection).toEqual({
      kind: "event",
      id: "second-event",
      recordId: "record-second",
    });
    expect(canonical.resolveDetail(trajectory.items[0]?.selection ?? null)?.recordId).toBe(
      "record-first",
    );
    expect(canonical.resolveDetail(trajectory.items[1]?.selection ?? null)?.recordId).toBe(
      "record-second",
    );
  });

  it("excludes duplicate event and Record facts before trajectory projection", () => {
    const source = session([
      event("canonical-event", "canonical-record", 1, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
      event("canonical-event", "other-record", 2, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
      event("other-event", "canonical-record", 3, {
        trajectoryEvidence: [modelOutput("assistant")],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items).toHaveLength(1);
    expect(trajectory.items[0]).toMatchObject({
      id: "canonical-event:evidence-0",
      recordId: "canonical-record",
    });
    expect(canonical.events).toHaveLength(1);
  });

  it("gives repeated conversation evidence in one Event distinct canonical item ids", () => {
    const shared = conversation("same-event-conversation", "assistant");
    const source = session([
      event("same-event", "same-event-record", 1, {
        conversationItems: [shared],
        trajectoryEvidence: [
          modelOutput("assistant", shared.id),
          modelOutput("reasoning", shared.id),
        ],
      }),
    ]);
    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);

    expect(trajectory.items.map((item) => item.id)).toEqual([
      "same-event:evidence-0",
      "same-event:evidence-1",
    ]);
    for (const item of trajectory.items) {
      expect(canonical.resolveDetail(item.selection)?.recordId).toBe("same-event-record");
    }
  });

  it("uses canonical opaque Records for every projected selection", () => {
    const output = conversation("opaque-output", "assistant");
    const call = conversation("opaque-call", "tool_call");
    const result = conversation("opaque-result", "tool_result");
    const source = session([
      event("opaque-output-event", "source-revision:9/record:opaque-output", 101, {
        turnIndex: 1,
        conversationItems: [output],
        trajectoryEvidence: [{ ...modelOutput("assistant", output.id), turnId: "opaque-turn" }],
      }),
      event("opaque-call-event", "source-revision:9/record:opaque-call", 102, {
        turnIndex: 1,
        conversationItems: [call],
        trajectoryEvidence: [
          { ...toolCall("shell", "opaque-call-id", call.id), turnId: "opaque-turn" },
        ],
      }),
      event("opaque-result-event", "source-revision:9/record:opaque-result", 103, {
        turnIndex: 1,
        conversationItems: [result],
        trajectoryEvidence: [
          {
            ...toolResult("completed", "opaque-call-id", undefined, result.id),
            turnId: "opaque-turn",
          },
        ],
      }),
    ]);
    const canonicalModel = createAgentSessionModel(source);
    const trajectory = createAgentTrajectoryModel(source);

    for (const item of trajectory.items) {
      const detail = canonicalModel.resolveDetail(item.selection);
      expect(detail?.recordId).toBe(item.recordId);
    }

    const [tool] = toolItems(trajectory);
    expect(tool?.id).toBe("opaque-call-event:evidence-0");
    expect(tool?.callSelection).toEqual({
      kind: "conversation",
      id: "opaque-call",
      recordId: "source-revision:9/record:opaque-call",
    });
    expect(tool?.resultSelection).toEqual({
      kind: "conversation",
      id: "opaque-result",
      recordId: "source-revision:9/record:opaque-result",
    });
    expect(canonicalModel.resolveDetail(tool?.resultSelection ?? null)?.recordId).toBe(
      "source-revision:9/record:opaque-result",
    );
  });

  it("scans 4K facts across multiple Events without collection searches", () => {
    const events: AgentTimelineEvent[] = [
      event("large-start", "opaque:large:start", 1, {
        timestamp: 0,
        turnIndex: 1,
        trajectoryEvidence: [lifecycle("large-turn", "start")],
      }),
    ];
    for (let eventIndex = 0; eventIndex < 38; eventIndex += 1) {
      const evidence: AgentTrajectoryEvidence[] = [];
      for (let evidenceIndex = 0; evidenceIndex < 100; evidenceIndex += 1) {
        evidence.push({ ...modelOutput("assistant"), turnId: "large-turn" });
      }
      events.push(
        event(`large-output-${eventIndex}`, `opaque:large:${eventIndex}`, eventIndex + 2, {
          timestamp: eventIndex + 1,
          turnIndex: 1,
          trajectoryEvidence: evidence,
        }),
      );
    }
    const tailEvidence: AgentTrajectoryEvidence[] = [];
    for (let evidenceIndex = 0; evidenceIndex < 196; evidenceIndex += 1) {
      tailEvidence.push({ ...modelOutput("assistant"), turnId: "large-turn" });
    }
    tailEvidence.push(
      { ...toolCall("large-tool", "large-call"), turnId: "large-turn" },
      { ...toolResult("completed", "large-call"), turnId: "large-turn" },
      lifecycle("large-turn", "complete"),
    );
    events.push(
      event("large-tail", "opaque:large:tail", 40, {
        timestamp: 100,
        turnIndex: 1,
        trajectoryEvidence: tailEvidence,
      }),
    );

    let eventIteratorReads = 0;
    let evidenceIteratorReads = 0;
    const guardedEventFacts: AgentTimelineEvent[] = [];
    for (const current of events) {
      const currentEvidence = current.trajectoryEvidence ?? [];
      const guardedEvidence = new Proxy(currentEvidence, {
        get(target, property, receiver) {
          if (property === "find" || property === "filter") {
            throw new Error(`Unexpected evidence ${String(property)} search`);
          }
          if (property === Symbol.iterator) {
            evidenceIteratorReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      guardedEventFacts.push({ ...current, trajectoryEvidence: guardedEvidence });
    }
    const guardedEvents = new Proxy(guardedEventFacts, {
      get(target, property, receiver) {
        if (property === "find" || property === "filter") {
          throw new Error(`Unexpected event ${String(property)} search`);
        }
        if (property === Symbol.iterator) {
          eventIteratorReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const model = createAgentTrajectoryModel(session(guardedEvents));

    expect(model.items).toHaveLength(3_997);
    expect(toolItems(model)).toHaveLength(1);
    expect(toolItems(model).filter((item) => item.status === "failed")).toHaveLength(0);
    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "large-turn"), status: "completed", durationMs: 100 },
    ]);
    expect(eventIteratorReads).toBe(1);
    expect(evidenceIteratorReads).toBe(40);
  });
});
