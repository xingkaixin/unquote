import { describe, expect, it } from "vitest";
import { createAgentTrajectoryModel } from "../src/lib/agent-session";
import {
  event,
  session,
  conversation,
  lifecycle,
  modelOutput,
  toolCall,
  toolResult,
  unknownToolResult,
  toolCompletion,
  tokenUsage,
  itemById,
  toolItems,
  warningKinds,
  trajectoryTurnId,
} from "./agent-trajectory-model.support";

describe("createAgentTrajectoryModel: turns-and-tools", () => {
  it("keeps an index fallback separate from explicit evidence with the same display index", () => {
    const firstAssistant = conversation("fallback-first", "assistant");
    const secondAssistant = conversation("fallback-second", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-first", "record-fallback-first", 1, {
          turnIndex: 1,
          conversationItems: [firstAssistant],
          trajectoryEvidence: [modelOutput("assistant", firstAssistant.id)],
        }),
        event("actual-start", "record-actual-start", 2, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("actual", "start")],
        }),
        event("fallback-second", "record-fallback-second", 3, {
          turnIndex: 1,
          conversationItems: [secondAssistant],
          trajectoryEvidence: [modelOutput("assistant", secondAssistant.id)],
        }),
        event("actual-complete", "record-actual-complete", 4, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("actual", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("fallback-index", 1), status: "running" },
      { id: trajectoryTurnId("evidence", "actual"), status: "completed" },
    ]);
    expect(
      model.items.filter((item) => item.turnId === model.turns[0]?.id).map((item) => item.id),
    ).toEqual(["fallback-first:evidence-0", "fallback-second:evidence-0"]);
  });

  it("keeps token, tool, and recovery state across explicit evidence", () => {
    const initial = conversation("promoted-initial", "assistant");
    const recovered = conversation("promoted-recovered", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("promoted-initial", "record-promoted-initial", 1, {
          timestamp: 10,
          turnIndex: 1,
          conversationItems: [initial],
          trajectoryEvidence: [{ ...modelOutput("assistant", initial.id), turnId: "promoted" }],
        }),
        event("promoted-token", "record-promoted-token", 2, {
          turnIndex: 1,
          trajectoryEvidence: [tokenUsage({ inputTokens: 4 }, "promoted")],
        }),
        event("promoted-call", "record-promoted-call", 3, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "promoted-call"), turnId: "promoted" }],
        }),
        event("promoted-start", "record-promoted-start", 4, {
          timestamp: 25,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("promoted", "start")],
        }),
        event("promoted-result", "record-promoted-result", 5, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "promoted-call"), turnId: "promoted" }],
        }),
        event("promoted-recovered", "record-promoted-recovered", 6, {
          timestamp: 35,
          turnIndex: 1,
          conversationItems: [recovered],
          trajectoryEvidence: [{ ...modelOutput("assistant", recovered.id), turnId: "promoted" }],
        }),
        event("promoted-complete", "record-promoted-complete", 7, {
          timestamp: 40,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("promoted", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "promoted"), status: "completed" },
    ]);
    expect(itemById(model, "promoted-initial:evidence-0").tokenUsage).toEqual({
      inputTokens: 4,
    });
    expect(toolItems(model)).toMatchObject([
      {
        callId: "promoted-call",
        status: "completed",
        startedAt: 20,
        endedAt: 30,
      },
    ]);
    expect(itemById(model, "promoted-recovered:evidence-0").step).toEqual({
      index: 1,
      source: "derived",
    });
  });

  it("does not attach later index-only facts to conflicting explicit turn ids", () => {
    const unscoped = conversation("ambiguous-index-output", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("first-explicit", "record-first-explicit", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("first", "start")],
        }),
        event("second-explicit", "record-second-explicit", 2, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("second", "start")],
        }),
        event("ambiguous-index-output", "record-ambiguous-index-output", 3, {
          turnIndex: 1,
          conversationItems: [unscoped],
          trajectoryEvidence: [modelOutput("assistant", unscoped.id)],
        }),
      ]),
    );

    expect(
      model.turns.map((turn) => ({
        id: turn.id,
        itemCount: model.items.filter((item) => item.turnId === turn.id).length,
      })),
    ).toEqual([
      { id: trajectoryTurnId("evidence", "first"), itemCount: 0 },
      { id: trajectoryTurnId("evidence", "second"), itemCount: 0 },
      { id: trajectoryTurnId("fallback-index", 1), itemCount: 1 },
    ]);
  });

  it("keeps an unterminated turn running and reports its source", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("open-start", "record-open-start", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("open-turn", "start")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "open-turn"), status: "running", startedAt: 10 },
    ]);
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        {
          kind: "open-turn",
          turnId: "open-turn",
          recordId: "record-open-start",
          lineNumber: 1,
          turnIndex: 1,
          selection: { kind: "event", id: "open-start", recordId: "record-open-start" },
        },
      ]),
    );
  });

  it("isolates matching call ids by turn identity", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("one-call", "record-one-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("first-tool", "same-call"), turnId: "turn-one" }],
        }),
        event("two-call", "record-two-call", 2, {
          timestamp: 20,
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolCall("second-tool", "same-call"), turnId: "turn-two" }],
        }),
        event("two-result", "record-two-result", 3, {
          timestamp: 25,
          turnIndex: 2,
          trajectoryEvidence: [{ ...toolResult("failed", "same-call"), turnId: "turn-two" }],
        }),
        event("one-result", "record-one-result", 4, {
          timestamp: 35,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "same-call"), turnId: "turn-one" }],
        }),
      ]),
    );

    expect(
      toolItems(model).map(({ toolName, callId, status, durationMs }) => ({
        toolName,
        callId,
        status,
        durationMs,
      })),
    ).toEqual([
      { toolName: "first-tool", callId: "same-call", status: "completed", durationMs: 25 },
      { toolName: "second-tool", callId: "same-call", status: "failed", durationMs: 5 },
    ]);
  });

  it("pairs an explicit turn across inconsistent display indexes", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("identity-call", "record-identity-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("identity-tool", "identity-call"), turnId: "identity-turn" },
          ],
        }),
        event("identity-result", "record-identity-result", 2, {
          timestamp: 25,
          turnIndex: 2,
          trajectoryEvidence: [
            { ...toolResult("completed", "identity-call"), turnId: "identity-turn" },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toMatchObject([
      {
        toolName: "identity-tool",
        status: "completed",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
      },
    ]);
    expect(warningKinds(model)).not.toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
  });

  it("does not pair different explicit turns sharing a display index", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("first-identity-call", "record-first-identity-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("first-identity", "identity-conflict"), turnId: "first-identity" },
          ],
        }),
        event("second-identity-result", "record-second-identity-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            {
              ...toolResult("completed", "identity-conflict"),
              turnId: "second-identity",
            },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(2);
    expect(toolItems(model).every((item) => !(item.callSelection && item.resultSelection))).toBe(
      true,
    );
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining(["unpaired-tool-call", "unpaired-tool-result"]),
    );
  });

  it("keeps completed, failed, and open tools distinct from the turn status", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("turn-start", "record-start", 1, {
          timestamp: 1,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn", "start")],
        }),
        event("done-call", "record-done-call", 2, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("done", "done"), turnId: "turn" }],
        }),
        event("done-result", "record-done-result", 3, {
          timestamp: 15,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "done"), turnId: "turn" }],
        }),
        event("failed-call", "record-failed-call", 4, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("failed", "failed"), turnId: "turn" }],
        }),
        event("failed-result", "record-failed-result", 5, {
          timestamp: 25,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "failed"), turnId: "turn" }],
        }),
        event("open-call", "record-open-call", 6, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("open", "open"), turnId: "turn" }],
        }),
        event("turn-complete", "record-complete", 7, {
          timestamp: 40,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn", "complete")],
        }),
      ]),
    );

    expect(model.turns[0]?.status).toBe("completed");
    expect(toolItems(model).map((item) => item.status)).toEqual(["completed", "failed", "running"]);
    expect(model.stats).toEqual({ tokenUsage: {} });
    expect(warningKinds(model)).toContain("unpaired-tool-call");
  });

  it("keeps statusless tool results paired but running", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("unknown-call", "record-unknown-call", 1, {
          timestamp: 10,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "unknown"), turnId: "turn" }],
        }),
        event("unknown-result", "record-unknown-result", 2, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...unknownToolResult("unknown"), turnId: "turn" }],
        }),
        event("orphan-unknown-result", "record-orphan-unknown-result", 3, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...unknownToolResult("orphan"), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toMatchObject([
      {
        callId: "unknown",
        status: "running",
        startedAt: 10,
        endedAt: 20,
        durationMs: 10,
        callSelection: {
          kind: "event",
          id: "unknown-call",
          recordId: "record-unknown-call",
        },
        resultSelection: {
          kind: "event",
          id: "unknown-result",
          recordId: "record-unknown-result",
        },
      },
      {
        callId: "orphan",
        status: "running",
        resultSelection: {
          kind: "event",
          id: "orphan-unknown-result",
          recordId: "record-orphan-unknown-result",
        },
      },
    ]);
    expect(warningKinds(model)).toContain("unpaired-tool-result");
    expect(model.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unpaired-tool-result", callId: "unknown" }),
      ]),
    );
  });

  it("combines a call, result, and completion into one failed tool", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("triple-call", "record-triple-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("inspect", "triple"), turnId: "turn" }],
        }),
        event("triple-result", "record-triple-result", 2, {
          timestamp: 200,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "triple"), turnId: "turn" }],
        }),
        event("triple-completion", "record-triple-completion", 3, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("failed", "triple", 17), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toEqual([
      expect.objectContaining({
        status: "failed",
        selection: { kind: "event", id: "triple-call", recordId: "record-triple-call" },
        callSelection: { kind: "event", id: "triple-call", recordId: "record-triple-call" },
        resultSelection: { kind: "event", id: "triple-result", recordId: "record-triple-result" },
        completionSelection: {
          kind: "event",
          id: "triple-completion",
          recordId: "record-triple-completion",
        },
        startedAt: 100,
        endedAt: 300,
        durationMs: 17,
      }),
    ]);
  });

  it("combines unique result and completion evidence without a call once", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("orphan-result", "record-orphan-result", 1, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "orphan"), turnId: "turn" }],
        }),
        event("orphan-completion", "record-orphan-completion", 2, {
          timestamp: 30,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("failed", "orphan", 7), turnId: "turn" }],
        }),
      ]),
    );

    expect(toolItems(model)).toEqual([
      expect.objectContaining({
        status: "failed",
        selection: { kind: "event", id: "orphan-result", recordId: "record-orphan-result" },
        resultSelection: { kind: "event", id: "orphan-result", recordId: "record-orphan-result" },
        completionSelection: {
          kind: "event",
          id: "orphan-completion",
          recordId: "record-orphan-completion",
        },
        endedAt: 30,
        durationMs: 7,
      }),
    ]);
    expect(warningKinds(model)).toContain("unpaired-tool-result");
    expect(warningKinds(model)).not.toContain("unpaired-tool-completion");
  });
});
