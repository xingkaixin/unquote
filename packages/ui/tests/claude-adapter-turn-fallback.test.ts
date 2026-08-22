import { describe, expect, it } from "vitest";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import {
  trajectoryTurnId,
  parsedLine,
  expectTrajectorySelectionsToResolve,
} from "./claude-adapter.support";

describe("claudeTranscriptAdapter: turn-fallback", () => {
  it("does not let a promptless tool result replace the active Claude prompt", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-stable",
          message: { content: "Run it" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: "output" }] },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Done" }] },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.meta.turnCount).toBe(1);
    expect(session.events.map((event) => event.turnIndex)).toEqual([1, 1, 1]);
    expect(session.events.flatMap((event) => event.sessionEvidence ?? [])).toMatchObject([
      { kind: "turn-lifecycle", phase: "start", turnId: "prompt-stable" },
      { turnId: "prompt-stable" },
      { turnId: "prompt-stable" },
      { turnId: "prompt-stable" },
    ]);
    expect(expectTrajectorySelectionsToResolve(session).turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "prompt-stable"), status: "running" },
    ]);
  });

  it("uses the display-index fallback for ordinary prompts without prompt ids", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          message: { content: "P" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: "A" },
        },
        2,
      ),
    );

    const session = builder.finish([]);

    expect(session.meta.turnCount).toBe(1);
    expect(session.events.map((event) => event.turnIndex)).toEqual([1, 1]);
    expect(session.events.flatMap((event) => event.sessionEvidence ?? [])).toEqual([
      {
        kind: "turn-lifecycle",
        phase: "start",
      },
      {
        kind: "model-output",
        role: "user",
        conversationItemId: "conv-1-block-0",
      },
      {
        kind: "model-output",
        role: "assistant",
        conversationItemId: "conv-2-block-0",
      },
    ]);
    const trajectory = expectTrajectorySelectionsToResolve(session);
    const turnId = trajectoryTurnId("fallback-index", 1);
    expect(trajectory.turns).toMatchObject([
      {
        id: turnId,
        status: "running",
        turnIndex: 1,
      },
    ]);
    expect(trajectory.items).toMatchObject([
      { kind: "user", recordId: "record-1", turnId },
      { kind: "assistant", recordId: "record-2", turnId },
    ]);
  });

  it("keeps empty ordinary messages and their token usage in the fallback trajectory", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          message: { content: "" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: "",
            usage: { input_tokens: 7, output_tokens: 3 },
          },
        },
        2,
      ),
    );

    const session = builder.finish([]);
    const trajectory = expectTrajectorySelectionsToResolve(session);
    const turnId = trajectoryTurnId("fallback-index", 1);

    expect(session.meta.turnCount).toBe(1);
    expect(session.events[0]?.sessionEvidence).toEqual([
      {
        kind: "turn-lifecycle",
        phase: "start",
      },
      {
        kind: "model-output",
        role: "user",
        conversationItemId: "conv-1-user",
      },
    ]);
    expect(session.events[1]?.sessionEvidence).toEqual([
      {
        kind: "model-output",
        role: "assistant",
        conversationItemId: "conv-2-assistant",
      },
      {
        kind: "token-usage",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    ]);
    expect(trajectory.turns).toMatchObject([
      {
        id: turnId,
      },
    ]);
    expect(trajectory.items).toMatchObject([
      { kind: "user", recordId: "record-1", turnId },
      {
        kind: "assistant",
        recordId: "record-2",
        turnId,
        tokenUsage: { inputTokens: 7, outputTokens: 3 },
      },
    ]);
    expect(trajectory.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "unattached-token-usage" })]),
    );
  });

  it("does not create a fallback turn from promptless tool results", () => {
    const activeBuilder = claudeTranscriptAdapter.createBuilder();
    activeBuilder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-existing",
          message: { content: "P" },
        },
        1,
      ),
    );
    activeBuilder.push(
      parsedLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: "result" }] },
        },
        2,
      ),
    );
    const activeSession = activeBuilder.finish([]);

    expect(activeSession.meta.turnCount).toBe(1);
    expect(activeSession.events.map((event) => event.turnIndex)).toEqual([1, 1]);
    expect(activeSession.events.flatMap((event) => event.sessionEvidence ?? [])).toMatchObject([
      { kind: "turn-lifecycle", phase: "start", turnId: "prompt-existing" },
      { turnId: "prompt-existing" },
      { turnId: "prompt-existing" },
    ]);

    const unscopedBuilder = claudeTranscriptAdapter.createBuilder();
    unscopedBuilder.push(
      parsedLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: "result" }] },
        },
        1,
      ),
    );
    unscopedBuilder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: "A" },
        },
        2,
      ),
    );
    const unscopedSession = unscopedBuilder.finish([]);

    expect(unscopedSession.meta.turnCount).toBe(0);
    expect(unscopedSession.events.map((event) => event.turnIndex)).toEqual([undefined, undefined]);
    expect(unscopedSession.events.flatMap((event) => event.sessionEvidence ?? [])).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        status: "completed",
        conversationItemId: "conv-1-block-0",
      },
      {
        kind: "model-output",
        role: "assistant",
        conversationItemId: "conv-2-block-0",
      },
    ]);
    expect(expectTrajectorySelectionsToResolve(unscopedSession).turns).toEqual([]);
  });

  it("keeps sparse usage and idless results truthful across an end_turn close", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-open",
          timestamp: 50,
          message: { stop_reason: "end_turn", content: "Continue" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Working" }],
            usage: { input_tokens: 0, cache_read_input_tokens: 7 },
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: "unattributed" }] },
        },
        3,
      ),
    );

    const session = builder.finish([]);
    const evidence = session.events.flatMap((event) => event.sessionEvidence ?? []);

    expect(session.events[1]?.sessionEvidence).toEqual([
      {
        kind: "model-output",
        role: "assistant",
        conversationItemId: "conv-2-block-0",
        turnId: "prompt-open",
      },
      {
        kind: "token-usage",
        usage: { inputTokens: 0, cacheReadInputTokens: 7 },
        turnId: "prompt-open",
      },
      {
        kind: "turn-lifecycle",
        phase: "complete",
        turnId: "prompt-open",
      },
    ]);
    expect(session.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        status: "completed",
        conversationItemId: "conv-3-block-0",
        turnId: "prompt-open",
      },
    ]);
    expect(evidence.map((entry) => entry.kind)).not.toContain("subagent-activity");
    expect(evidence.map((entry) => entry.kind)).not.toContain("compaction");

    const trajectory = expectTrajectorySelectionsToResolve(session);
    expect(trajectory.turns).toMatchObject([
      { id: trajectoryTurnId("evidence", "prompt-open"), status: "completed", startedAt: 50 },
    ]);
    // The end_turn record has no timestamp, so the close is honest about the
    // missing terminal moment instead of leaving the turn open.
    expect(trajectory.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-timestamp",
          subject: "turn",
          endpoint: "terminal",
          turnId: "prompt-open",
        }),
      ]),
    );
    expect(trajectory.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "open-turn" })]),
    );
    expect(trajectory.items[1]).toMatchObject({
      kind: "assistant",
      tokenUsage: { inputTokens: 0, cacheReadInputTokens: 7 },
    });
    expect(trajectory.items[2]).toMatchObject({
      kind: "tool",
      status: "completed",
      recordId: "record-3",
      selection: { kind: "conversation", id: "conv-3-block-0", recordId: "record-3" },
    });
    expect(trajectory.items[2]).not.toHaveProperty("callId");
    expect(trajectory.items[2]).not.toHaveProperty("callSelection");
    expect(trajectory.items[2]).not.toHaveProperty("endedAt");
    expect(trajectory.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "unpaired-tool-result" })]),
    );
  });
});
