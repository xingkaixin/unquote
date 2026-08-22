import { describe, expect, it } from "vitest";
import { createAgentTrajectoryModel, type AgentTrajectoryItem } from "../src/lib/agent-session";
import {
  event,
  session,
  conversation,
  lifecycle,
  modelOutput,
  toolCall,
  toolResult,
  toolCompletion,
  itemById,
  userItemById,
  toolItems,
  warningKinds,
  trajectoryTurnId,
} from "./agent-trajectory-model.support";

describe("createAgentTrajectoryModel: timing-and-lifecycle", () => {
  it("leaves every occurrence independent when completions duplicate a call id", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("duplicate-completion-call", "record-duplicate-completion-call", 1, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("shell", "duplicate-completion"), turnId: "turn" }],
        }),
        event("duplicate-completion-result", "record-duplicate-completion-result", 2, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
        event("duplicate-completion-one", "record-duplicate-completion-one", 3, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
        event("duplicate-completion-two", "record-duplicate-completion-two", 4, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("failed", "duplicate-completion"), turnId: "turn" },
          ],
        }),
      ]),
    );

    expect(toolItems(model)).toHaveLength(4);
    expect(
      toolItems(model).every(
        (item) =>
          !(item.callSelection && item.resultSelection) &&
          !(item.callSelection && item.completionSelection) &&
          !(item.resultSelection && item.completionSelection),
      ),
    ).toBe(true);
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining([
        "duplicate-tool-completion-id",
        "unpaired-tool-call",
        "unpaired-tool-result",
        "unpaired-tool-completion",
      ]),
    );
  });

  it("prefers explicit tool durations and warns instead of deriving invalid durations", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("explicit-call", "record-explicit-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("explicit", "explicit"), turnId: "turn" }],
        }),
        event("explicit-result", "record-explicit-result", 2, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "explicit", 37), turnId: "turn" }],
        }),
        event("missing-call", "record-missing-call", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("missing", "missing"), turnId: "turn" }],
        }),
        event("missing-result", "record-missing-result", 4, {
          timestamp: 450,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "missing"), turnId: "turn" }],
        }),
        event("reversed-call", "record-reversed-call", 5, {
          timestamp: 600,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("reversed", "reversed"), turnId: "turn" }],
        }),
        event("reversed-result", "record-reversed-result", 6, {
          timestamp: 500,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "reversed"), turnId: "turn" }],
        }),
        event("explicit-reversed-call", "record-explicit-reversed-call", 7, {
          timestamp: 700,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("explicit reversed", "explicit-reversed"), turnId: "turn" },
          ],
        }),
        event("explicit-reversed-result", "record-explicit-reversed-result", 8, {
          timestamp: 650,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "explicit-reversed", 7), turnId: "turn" },
          ],
        }),
        event("explicit-missing-call", "record-explicit-missing-call", 9, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("explicit missing", "explicit-missing"), turnId: "turn" },
          ],
        }),
        event("explicit-missing-result", "record-explicit-missing-result", 10, {
          timestamp: 720,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "explicit-missing", 7), turnId: "turn" },
          ],
        }),
      ]),
    );

    const byCallId = new Map<string, Extract<AgentTrajectoryItem, { kind: "tool" }>>();
    for (const item of toolItems(model)) {
      if (item.callId) {
        byCallId.set(item.callId, item);
      }
    }

    expect(byCallId.get("explicit")).toMatchObject({
      startedAt: 100,
      endedAt: 300,
      durationMs: 37,
    });
    expect(byCallId.get("missing")).toMatchObject({ endedAt: 450 });
    expect(byCallId.get("missing")?.durationMs).toBeUndefined();
    expect(byCallId.get("reversed")).toMatchObject({ startedAt: 600, endedAt: 500 });
    expect(byCallId.get("reversed")?.durationMs).toBeUndefined();
    expect(byCallId.get("explicit-reversed")).toMatchObject({
      startedAt: 700,
      endedAt: 650,
      durationMs: 7,
    });
    expect(byCallId.get("explicit-missing")).toMatchObject({ endedAt: 720, durationMs: 7 });
    expect(warningKinds(model)).toEqual(
      expect.arrayContaining(["missing-timestamp", "reversed-timestamp"]),
    );
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "tool",
          callId: "explicit-reversed",
          recordId: "record-explicit-reversed-result",
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "call",
          callId: "explicit-missing",
          recordId: "record-explicit-missing-call",
        }),
      ]),
    );
  });

  it("prioritizes completion timing while preserving timestamp warnings", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("priority-call", "record-priority-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("priority", "priority"), turnId: "turn" }],
        }),
        event("priority-result", "record-priority-result", 2, {
          timestamp: 200,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "priority", 11), turnId: "turn" }],
        }),
        event("priority-completion", "record-priority-completion", 3, {
          timestamp: 300,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCompletion("completed", "priority", 17), turnId: "turn" }],
        }),
        event("missing-completion-call", "record-missing-completion-call", 4, {
          timestamp: 400,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("missing completion", "missing-completion"), turnId: "turn" },
          ],
        }),
        event("missing-completion-result", "record-missing-completion-result", 5, {
          timestamp: 500,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "missing-completion", 13), turnId: "turn" },
          ],
        }),
        event("missing-completion", "record-missing-completion", 6, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "missing-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion-call", "record-reversed-completion-call", 7, {
          timestamp: 700,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("reversed completion", "reversed-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion-result", "record-reversed-completion-result", 8, {
          timestamp: 800,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolResult("completed", "reversed-completion"), turnId: "turn" },
          ],
        }),
        event("reversed-completion", "record-reversed-completion", 9, {
          timestamp: 600,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "reversed-completion", 19), turnId: "turn" },
          ],
        }),
      ]),
    );

    const byCallId = new Map<string, Extract<AgentTrajectoryItem, { kind: "tool" }>>();
    for (const item of toolItems(model)) {
      if (item.callId) {
        byCallId.set(item.callId, item);
      }
    }

    expect(byCallId.get("priority")).toMatchObject({ endedAt: 300, durationMs: 17 });
    expect(byCallId.get("missing-completion")).toMatchObject({
      endedAt: 500,
      durationMs: 13,
    });
    expect(byCallId.get("reversed-completion")).toMatchObject({
      endedAt: 600,
      durationMs: 19,
    });
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "completion",
          callId: "missing-completion",
        }),
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "tool",
          callId: "reversed-completion",
        }),
      ]),
    );
  });

  it("derives duration from the terminal timestamp selected after a missing completion time", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("fallback-duration-call", "record-fallback-duration-call", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCall("fallback duration", "fallback-duration"), turnId: "turn" },
          ],
        }),
        event("fallback-duration-result", "record-fallback-duration-result", 2, {
          timestamp: 250,
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "fallback-duration"), turnId: "turn" }],
        }),
        event("fallback-duration-completion", "record-fallback-duration-completion", 3, {
          turnIndex: 1,
          trajectoryEvidence: [
            { ...toolCompletion("completed", "fallback-duration"), turnId: "turn" },
          ],
        }),
      ]),
    );

    const tool = toolItems(model)[0];
    expect(tool).toMatchObject({ endedAt: 250, durationMs: 150 });
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "completion",
          callId: "fallback-duration",
        }),
      ]),
    );
  });

  it("keeps lifecycle time facts while warning about missing and reversed ranges", () => {
    const model = createAgentTrajectoryModel(
      session([
        event("reversed-start", "record-reversed-start", 1, {
          timestamp: 100,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("reversed-turn", "start")],
        }),
        event("reversed-complete", "record-reversed-complete", 2, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("reversed-turn", "complete")],
        }),
        event("missing-start", "record-missing-start", 3, {
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("missing-turn", "start")],
        }),
        event("missing-complete", "record-missing-complete", 4, {
          timestamp: 40,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("missing-turn", "complete")],
        }),
        event("terminal-missing-start", "record-terminal-missing-start", 5, {
          timestamp: 50,
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("terminal-missing-turn", "start")],
        }),
        event("terminal-missing-complete", "record-terminal-missing-complete", 6, {
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("terminal-missing-turn", "complete")],
        }),
      ]),
    );

    const reversed = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "reversed-turn"),
    );
    const missing = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "missing-turn"),
    );
    const terminalMissing = model.turns.find(
      (turn) => turn.id === trajectoryTurnId("evidence", "terminal-missing-turn"),
    );
    expect(reversed).toMatchObject({ status: "completed", startedAt: 100, endedAt: 20 });
    expect(reversed?.durationMs).toBeUndefined();
    expect(missing).toMatchObject({ status: "completed", endedAt: 40 });
    expect(missing?.startedAt).toBeUndefined();
    expect(missing?.durationMs).toBeUndefined();
    expect(terminalMissing).toMatchObject({ status: "completed", startedAt: 50 });
    expect(terminalMissing?.endedAt).toBeUndefined();
    expect(terminalMissing?.durationMs).toBeUndefined();
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "turn",
          recordId: "record-reversed-complete",
          selection: {
            kind: "event",
            id: "reversed-complete",
            recordId: "record-reversed-complete",
          },
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "start",
          recordId: "record-missing-start",
          selection: {
            kind: "event",
            id: "missing-start",
            recordId: "record-missing-start",
          },
        }),
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "terminal",
          recordId: "record-terminal-missing-complete",
          selection: {
            kind: "event",
            id: "terminal-missing-complete",
            recordId: "record-terminal-missing-complete",
          },
        }),
      ]),
    );
  });

  it("distinguishes a missing lifecycle start from an observed non-terminal start", () => {
    const observed = conversation("observed-output", "assistant");
    const reversedObserved = conversation("reversed-observed-output", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("terminal-only", "record-terminal-only", 1, {
          timestamp: 50,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("terminal-only", "complete")],
        }),
        event("observed-output", "record-observed-output", 2, {
          timestamp: 10,
          turnIndex: 2,
          conversationItems: [observed],
          trajectoryEvidence: [{ ...modelOutput("assistant", observed.id), turnId: "observed" }],
        }),
        event("observed-complete", "record-observed-complete", 3, {
          timestamp: 50,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("observed", "complete")],
        }),
        event("reversed-observed-output", "record-reversed-observed-output", 4, {
          timestamp: 100,
          turnIndex: 3,
          conversationItems: [reversedObserved],
          trajectoryEvidence: [
            { ...modelOutput("assistant", reversedObserved.id), turnId: "reversed-observed" },
          ],
        }),
        event("reversed-observed-complete", "record-reversed-observed-complete", 5, {
          timestamp: 20,
          turnIndex: 3,
          trajectoryEvidence: [lifecycle("reversed-observed", "complete")],
        }),
      ]),
    );

    const terminalOnly = model.turns[0];
    const observedTurn = model.turns[1];
    const reversedObservedTurn = model.turns[2];
    expect(terminalOnly).toMatchObject({ status: "completed", endedAt: 50 });
    expect(terminalOnly?.startedAt).toBeUndefined();
    expect(terminalOnly?.durationMs).toBeUndefined();
    expect(observedTurn).toMatchObject({ startedAt: 10, endedAt: 50, durationMs: 40 });
    expect(reversedObservedTurn).toMatchObject({ startedAt: 100, endedAt: 20 });
    expect(reversedObservedTurn?.durationMs).toBeUndefined();
    expect(model.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-turn-start",
          turnId: "terminal-only",
          recordId: "record-terminal-only",
          selection: {
            kind: "event",
            id: "terminal-only",
            recordId: "record-terminal-only",
          },
        }),
        expect.objectContaining({
          kind: "reversed-timestamp",
          subject: "turn",
          turnId: "reversed-observed",
          recordId: "record-reversed-observed-complete",
        }),
      ]),
    );
  });

  it("uses the earliest observed non-terminal timestamp without sorting", () => {
    const lateObserved = conversation("late-observed", "assistant");
    const laterAssistant = conversation("later-assistant", "assistant");
    const earlierReasoning = conversation("earlier-reasoning", "thinking");
    const model = createAgentTrajectoryModel(
      session([
        event("late-observed-complete", "record-late-observed-complete", 1, {
          timestamp: 20,
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("late-observed-turn", "complete")],
        }),
        event("late-observed", "record-late-observed", 2, {
          timestamp: 10,
          turnIndex: 1,
          conversationItems: [lateObserved],
          trajectoryEvidence: [
            { ...modelOutput("assistant", lateObserved.id), turnId: "late-observed-turn" },
          ],
        }),
        event("later-assistant", "record-later-assistant", 3, {
          timestamp: 100,
          turnIndex: 2,
          conversationItems: [laterAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", laterAssistant.id), turnId: "earliest-turn" },
          ],
        }),
        event("earlier-reasoning", "record-earlier-reasoning", 4, {
          timestamp: 10,
          turnIndex: 2,
          conversationItems: [earlierReasoning],
          trajectoryEvidence: [
            { ...modelOutput("reasoning", earlierReasoning.id), turnId: "earliest-turn" },
          ],
        }),
        event("earliest-complete", "record-earliest-complete", 5, {
          timestamp: 200,
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("earliest-turn", "complete")],
        }),
      ]),
    );

    expect(model.turns).toMatchObject([
      {
        id: trajectoryTurnId("evidence", "late-observed-turn"),
        startedAt: 10,
        endedAt: 20,
        durationMs: 10,
      },
      {
        id: trajectoryTurnId("evidence", "earliest-turn"),
        startedAt: 10,
        endedAt: 200,
        durationMs: 190,
      },
    ]);
    expect(model.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing-turn-start", turnId: "late-observed-turn" }),
      ]),
    );
  });

  it("derives one recovery step without making a failed tool fail the turn", () => {
    const initial = conversation("initial", "assistant");
    const userAfterResult = conversation("user-after-result", "user");
    const recovered = conversation("recovered", "assistant");
    const continued = conversation("continued", "thinking");
    const nextTurnAssistant = conversation("next-turn-assistant", "assistant");
    const model = createAgentTrajectoryModel(
      session([
        event("turn-start", "record-start", 1, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "start")],
        }),
        event("initial", "record-initial", 2, {
          turnIndex: 1,
          conversationItems: [initial],
          trajectoryEvidence: [{ ...modelOutput("assistant", initial.id), turnId: "turn-one" }],
        }),
        event("first-call", "record-first-call", 3, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("first", "first"), turnId: "turn-one" }],
        }),
        event("first-result", "record-first-result", 4, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("failed", "first"), turnId: "turn-one" }],
        }),
        event("second-call", "record-second-call", 5, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("second", "second"), turnId: "turn-one" }],
        }),
        event("second-result", "record-second-result", 6, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "second"), turnId: "turn-one" }],
        }),
        event("user-after-result", "record-user-after-result", 7, {
          turnIndex: 1,
          conversationItems: [userAfterResult],
          trajectoryEvidence: [{ ...modelOutput("user", userAfterResult.id), turnId: "turn-one" }],
        }),
        event("recovered", "record-recovered", 8, {
          turnIndex: 1,
          conversationItems: [recovered],
          trajectoryEvidence: [{ ...modelOutput("assistant", recovered.id), turnId: "turn-one" }],
        }),
        event("continued", "record-continued", 9, {
          turnIndex: 1,
          conversationItems: [continued],
          trajectoryEvidence: [{ ...modelOutput("reasoning", continued.id), turnId: "turn-one" }],
        }),
        event("third-call", "record-third-call", 10, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolCall("third", "third"), turnId: "turn-one" }],
        }),
        event("third-result", "record-third-result", 11, {
          turnIndex: 1,
          trajectoryEvidence: [{ ...toolResult("completed", "third"), turnId: "turn-one" }],
        }),
        event("turn-complete", "record-complete", 12, {
          turnIndex: 1,
          trajectoryEvidence: [lifecycle("turn-one", "complete")],
        }),
        event("next-turn-start", "record-next-start", 13, {
          turnIndex: 2,
          trajectoryEvidence: [lifecycle("turn-two", "start")],
        }),
        event("next-turn-assistant", "record-next-assistant", 14, {
          turnIndex: 2,
          conversationItems: [nextTurnAssistant],
          trajectoryEvidence: [
            { ...modelOutput("assistant", nextTurnAssistant.id), turnId: "turn-two" },
          ],
        }),
      ]),
    );

    expect(itemById(model, "initial:evidence-0").step).toBeUndefined();
    expect(userItemById(model, "user-after-result:evidence-0").kind).toBe("user");
    expect(itemById(model, "recovered:evidence-0").step).toEqual({ index: 1, source: "derived" });
    expect(itemById(model, "continued:evidence-0").step).toBeUndefined();
    expect(itemById(model, "next-turn-assistant:evidence-0").step).toBeUndefined();
    expect(model.turns[0]?.status).toBe("completed");
    expect(toolItems(model).filter((item) => item.status === "failed")).toHaveLength(1);
  });
});
