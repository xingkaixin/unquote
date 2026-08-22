import { describe, expect, it } from "vitest";
import { createAgentTrajectoryModel } from "../src/lib/agent-session";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import { trajectoryTurnId, parsedLine } from "./claude-adapter.support";

describe("claudeTranscriptAdapter: turn-closure", () => {
  it("closes a turn with the authoritative turn_duration record", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-timed",
          timestamp: 1_000,
          message: { content: "Do the work" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          timestamp: 40_000,
          message: { content: [{ type: "text", text: "Done" }] },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "system",
          subtype: "turn_duration",
          durationMs: 54_840,
          timestamp: 60_000,
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "turn-lifecycle",
        phase: "complete",
        turnId: "prompt-timed",
        durationMs: 54_840,
      },
    ]);

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.turns).toMatchObject([
      {
        id: trajectoryTurnId("evidence", "prompt-timed"),
        status: "completed",
        startedAt: 1_000,
        endedAt: 60_000,
        durationMs: 54_840,
      },
    ]);
    expect(trajectory.warnings).toEqual([]);
  });

  it("projects a compact_boundary system record as compaction", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-compact",
          message: { content: "Long conversation" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "system",
          subtype: "compact_boundary",
          content: "Conversation compacted",
          timestamp: 5_000,
        },
        2,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[1]?.trajectoryEvidence).toEqual([
      { kind: "compaction", turnId: "prompt-compact" },
    ]);
    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.items).toMatchObject([
      { kind: "user" },
      { kind: "compaction", status: "completed", timestamp: 5_000, turnIndex: 1 },
    ]);
  });

  it("closes the previous turn at its own last moment when a new prompt arrives", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-first",
          timestamp: 1_000,
          message: { content: "First" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          timestamp: 3_000,
          message: { content: [{ type: "text", text: "Reply" }] },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-second",
          timestamp: 60_000,
          message: { content: "Second" },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "turn-lifecycle",
        phase: "complete",
        turnId: "prompt-first",
        timestamp: 3_000,
      },
      {
        kind: "turn-lifecycle",
        phase: "start",
        turnId: "prompt-second",
      },
      {
        kind: "model-output",
        role: "user",
        conversationItemId: "conv-3-block-0",
        turnId: "prompt-second",
      },
    ]);

    const trajectory = createAgentTrajectoryModel(session);
    // The first turn ends at its last own record, not at the idle gap
    // before the second prompt.
    expect(trajectory.turns).toMatchObject([
      {
        id: trajectoryTurnId("evidence", "prompt-first"),
        status: "completed",
        startedAt: 1_000,
        endedAt: 3_000,
        durationMs: 2_000,
      },
      {
        id: trajectoryTurnId("evidence", "prompt-second"),
        status: "running",
        startedAt: 60_000,
      },
    ]);
    expect(trajectory.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "open-turn", turnId: "prompt-second" }),
      ]),
    );
    expect(trajectory.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "open-turn", turnId: "prompt-first" }),
      ]),
    );
  });
});
