import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentTokenUsageEvidence,
  type AgentTrajectorySystemItem,
  type AgentTrajectoryUserItem,
} from "../src/lib/agent-session";
import {
  event,
  session,
  conversation,
  lifecycle,
  modelOutput,
  toolCall,
  toolResult,
  tokenUsage,
  itemById,
  trajectoryTurnId,
} from "./agent-trajectory-model.support";

describe("createAgentTrajectoryModel: projection", () => {
  it("keeps projected selections canonical when trajectory tokens are available", () => {
    const output = conversation("output-1", "assistant");
    const source = session([
      event("event-1", "record-1", 1, {
        conversationItems: [output],
        sessionEvidence: [modelOutput("assistant", output)],
      }),
    ]);
    const projected = createAgentTrajectoryModel(source);
    const model = createAgentSessionModel(source);

    expect(model.trajectory).toEqual(projected);
    expect(projected.items[0]?.selection).toEqual({
      kind: "conversation",
      id: "output-1",
      recordId: "record-1",
    });
    expect(projected.items[0]).not.toHaveProperty("label");
    expect(projected.items[0]).not.toHaveProperty("preview");
    expect(model.selectTrajectory("event-1:evidence-0")).toEqual({
      kind: "trajectory",
      id: "event-1:evidence-0",
      recordId: "record-1",
    });
  });

  it("requires at least one token evidence source", () => {
    const cumulativeOnly = {
      kind: "token-usage",
      cumulativeUsage: { inputTokens: 1 },
    } satisfies AgentTokenUsageEvidence;
    expectTypeOf(cumulativeOnly).toMatchTypeOf<AgentTokenUsageEvidence>();

    // @ts-expect-error Token evidence requires incremental or cumulative usage.
    const withoutSources: AgentTokenUsageEvidence = { kind: "token-usage" };
    expect(withoutSources.kind).toBe("token-usage");
  });

  it("keeps user items free of assistant recovery and token fields", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("user-output", "record-user-output", 1, {
          sessionEvidence: [modelOutput("user")],
        }),
      ]),
    );
    const user = model.items[0];
    if (!user || user.kind !== "user") {
      throw new Error("Missing user trajectory item");
    }

    expect("step" in user).toBe(false);
    expect("tokenUsage" in user).toBe(false);
    expectTypeOf(user).toEqualTypeOf<AgentTrajectoryUserItem>();
  });

  it("projects system output without becoming a token or derived-step anchor", () => {
    const initialAssistant = conversation("initial-assistant", "assistant");
    const systemOutput = conversation("system-output", "system");
    const recoveredAssistant = conversation("recovered-assistant", "assistant");
    const source = session([
      event("initial-assistant", "record-initial-assistant", 1, {
        turnIndex: 1,
        conversationItems: [initialAssistant],
        sessionEvidence: [
          { ...modelOutput("assistant", initialAssistant), turnId: "turn-system-output" },
        ],
      }),
      event("tool-call", "record-tool-call", 2, {
        turnIndex: 1,
        sessionEvidence: [
          { ...toolCall("read_file", "call-system-output"), turnId: "turn-system-output" },
        ],
      }),
      event("tool-result", "record-tool-result", 3, {
        turnIndex: 1,
        sessionEvidence: [
          {
            ...toolResult("completed", "call-system-output"),
            turnId: "turn-system-output",
          },
        ],
      }),
      event("system-output", "record-system-output", 4, {
        turnIndex: 1,
        conversationItems: [systemOutput],
        sessionEvidence: [{ ...modelOutput("system", systemOutput), turnId: "turn-system-output" }],
      }),
      event("token-usage", "record-token-usage", 5, {
        turnIndex: 1,
        sessionEvidence: [tokenUsage({ inputTokens: 3 }, "turn-system-output")],
      }),
      event("recovered-assistant", "record-recovered-assistant", 6, {
        turnIndex: 1,
        conversationItems: [recoveredAssistant],
        sessionEvidence: [
          {
            ...modelOutput("assistant", recoveredAssistant),
            turnId: "turn-system-output",
          },
        ],
      }),
    ]);

    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);
    const system = trajectory.items.find(
      (item): item is AgentTrajectorySystemItem => item.kind === "system",
    );

    expect(system).toMatchObject({
      id: "system-output:evidence-0",
      status: "completed",
      recordId: "record-system-output",
      selection: {
        kind: "conversation",
        id: "system-output",
        recordId: "record-system-output",
      },
    });
    expect(system).toBeDefined();
    if (!system) {
      throw new Error("Missing system trajectory item");
    }
    expect("step" in system).toBe(false);
    expect("tokenUsage" in system).toBe(false);
    expectTypeOf(system).toEqualTypeOf<AgentTrajectorySystemItem>();
    expect(itemById(trajectory, "initial-assistant:evidence-0").tokenUsage).toEqual({
      inputTokens: 3,
    });
    expect(itemById(trajectory, "recovered-assistant:evidence-0").step).toEqual({
      index: 1,
      source: "derived",
    });
    expect(canonical.resolveDetail(system.selection)?.recordId).toBe("record-system-output");
    expect(canonical.selectTrajectory(system.id)).toEqual({
      kind: "trajectory",
      id: system.id,
      recordId: "record-system-output",
    });
  });

  it("projects ordered lifecycle turns with their terminal states", () => {
    const firstUser = conversation("first-user", "user");
    const firstAssistant = conversation("first-assistant", "assistant");
    const secondReasoning = conversation("second-reasoning", "thinking");
    const model = createAgentTrajectoryModel(
      session([
        event("start-one", "opaque/one/start", 11, {
          timestamp: 10,
          turnIndex: 1,
          sessionEvidence: [lifecycle("turn-one", "start")],
        }),
        event("user-one", "opaque/one/user", 12, {
          timestamp: 12,
          turnIndex: 1,
          conversationItems: [firstUser],
          sessionEvidence: [{ ...modelOutput("user", firstUser), turnId: "turn-one" }],
        }),
        event("assistant-one", "opaque/one/assistant", 13, {
          timestamp: 20,
          turnIndex: 1,
          conversationItems: [firstAssistant],
          sessionEvidence: [{ ...modelOutput("assistant", firstAssistant), turnId: "turn-one" }],
        }),
        event("complete-one", "opaque/one/complete", 14, {
          timestamp: 30,
          turnIndex: 1,
          sessionEvidence: [lifecycle("turn-one", "complete")],
        }),
        event("start-two", "opaque/two/start", 21, {
          timestamp: 40,
          turnIndex: 2,
          sessionEvidence: [lifecycle("turn-two", "start")],
        }),
        event("reasoning-two", "opaque/two/reasoning", 22, {
          timestamp: 50,
          turnIndex: 2,
          conversationItems: [secondReasoning],
          sessionEvidence: [{ ...modelOutput("reasoning", secondReasoning), turnId: "turn-two" }],
        }),
        event("failed-two", "opaque/two/failed", 23, {
          timestamp: 70,
          turnIndex: 2,
          sessionEvidence: [lifecycle("turn-two", "failed")],
        }),
      ]),
    );

    expect(
      model.turns.map(({ id, status, turnIndex, startedAt, endedAt, durationMs }) => ({
        id,
        status,
        turnIndex,
        startedAt,
        endedAt,
        durationMs,
      })),
    ).toEqual([
      {
        id: trajectoryTurnId("evidence", "turn-one"),
        status: "completed",
        turnIndex: 1,
        startedAt: 10,
        endedAt: 30,
        durationMs: 20,
      },
      {
        id: trajectoryTurnId("evidence", "turn-two"),
        status: "failed",
        turnIndex: 2,
        startedAt: 40,
        endedAt: 70,
        durationMs: 30,
      },
    ]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[0]?.id).map((item) => item.id),
    ).toEqual(["user-one:evidence-0", "assistant-one:evidence-0"]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[1]?.id).map((item) => item.id),
    ).toEqual(["reasoning-two:evidence-0"]);
  });

  it("uses explicit turn ids before a shared display turn index", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("first-start", "record-first-start", 1, {
          turnIndex: 1,
          sessionEvidence: [lifecycle("first-turn", "start")],
        }),
        event("second-start", "record-second-start", 2, {
          turnIndex: 1,
          sessionEvidence: [lifecycle("second-turn", "start")],
        }),
        event("first-complete", "record-first-complete", 3, {
          turnIndex: 1,
          sessionEvidence: [lifecycle("first-turn", "complete")],
        }),
        event("second-failed", "record-second-failed", 4, {
          turnIndex: 1,
          sessionEvidence: [lifecycle("second-turn", "failed")],
        }),
      ]),
    );

    expect(model.turns.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: trajectoryTurnId("evidence", "first-turn"), status: "completed" },
      { id: trajectoryTurnId("evidence", "second-turn"), status: "failed" },
    ]);
  });

  it("keeps a fallback-index turn distinct from an explicit id with the old fallback text", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-index", "record-fallback-index", 1, {
          turnIndex: 1,
          sessionEvidence: [modelOutput("assistant")],
        }),
        event("explicit-id", "record-explicit-id", 2, {
          turnIndex: 2,
          sessionEvidence: [lifecycle("turn-1", "start")],
        }),
      ]),
    );

    expect(model.turns.map((turn) => turn.id)).toEqual([
      '["fallback-index",1]',
      '["evidence","turn-1"]',
    ]);
  });

  it("keeps a synthetic-event turn distinct from an explicit id with the old synthetic text", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("synthetic-start", "record-synthetic-start", 1, {
          sessionEvidence: [{ kind: "turn-lifecycle", phase: "start" }],
        }),
        event("explicit-id", "record-explicit-id", 2, {
          sessionEvidence: [lifecycle("event:synthetic-start", "start")],
        }),
      ]),
    );

    expect(model.turns.map((turn) => turn.id)).toEqual([
      '["synthetic-event","synthetic-start"]',
      '["evidence","event:synthetic-start"]',
    ]);
  });
});
