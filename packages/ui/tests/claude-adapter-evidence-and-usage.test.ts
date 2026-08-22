import { describe, expect, it } from "vitest";
import { createAgentTrajectoryModel } from "../src/lib/agent-session";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import {
  trajectoryTurnId,
  parsedLine,
  expectTrajectorySelectionsToResolve,
} from "./claude-adapter.support";

describe("claudeTranscriptAdapter: evidence-and-usage", () => {
  it("emits ordered, turn-scoped evidence from attached Claude blocks", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-1",
          timestamp: 100,
          message: { content: "Inspect the repository" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          timestamp: 200,
          message: {
            content: [
              { type: "thinking", thinking: "Find the relevant files" },
              { type: "text", text: "I will inspect them." },
              { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } },
            ],
            usage: {
              input_tokens: 11,
              cache_creation_input_tokens: 12,
              cache_read_input_tokens: 13,
              output_tokens: 14,
            },
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "must-not-replace-prompt-1",
          timestamp: 850,
          message: {
            content: [
              { type: "text", text: "Tool output follows" },
              { type: "tool_result", tool_use_id: "tool-1", content: { cwd: "/repo" } },
            ],
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.meta.turnCount).toBe(1);
    expect(session.events.map((event) => event.turnIndex)).toEqual([1, 1, 1]);
    expect(session.events[0]?.trajectoryEvidence).toEqual([
      {
        kind: "turn-lifecycle",
        phase: "start",
        turnId: "prompt-1",
      },
      {
        kind: "model-output",
        role: "user",
        conversationItemId: "conv-1-block-0",
        turnId: "prompt-1",
      },
    ]);
    expect(session.events[1]?.trajectoryEvidence).toEqual([
      {
        kind: "model-output",
        role: "reasoning",
        conversationItemId: "conv-2-block-0",
        turnId: "prompt-1",
      },
      {
        kind: "model-output",
        role: "assistant",
        conversationItemId: "conv-2-block-1",
        turnId: "prompt-1",
      },
      {
        kind: "tool-lifecycle",
        phase: "call",
        toolName: "Bash",
        callId: "tool-1",
        conversationItemId: "conv-2-block-2",
        turnId: "prompt-1",
      },
      {
        kind: "token-usage",
        usage: {
          inputTokens: 11,
          cacheCreationInputTokens: 12,
          cacheReadInputTokens: 13,
          outputTokens: 14,
        },
        turnId: "prompt-1",
      },
    ]);
    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "model-output",
        role: "user",
        conversationItemId: "conv-3-block-0",
        turnId: "prompt-1",
      },
      {
        kind: "tool-lifecycle",
        phase: "result",
        status: "completed",
        callId: "tool-1",
        conversationItemId: "conv-3-block-1",
        turnId: "prompt-1",
      },
    ]);
    const trajectory = expectTrajectorySelectionsToResolve(session);
    expect(trajectory.turns).toMatchObject([
      {
        id: trajectoryTurnId("evidence", "prompt-1"),
        status: "running",
        turnIndex: 1,
        startedAt: 100,
      },
    ]);
    expect(trajectory.items.map((item) => [item.id, item.kind])).toEqual([
      ["line-1:evidence-1", "user"],
      ["line-2:evidence-0", "reasoning"],
      ["line-2:evidence-1", "assistant"],
      ["line-2:evidence-2", "tool"],
      ["line-3:evidence-0", "user"],
    ]);
    expect(trajectory.items[2]).toMatchObject({
      tokenUsage: {
        inputTokens: 11,
        cacheCreationInputTokens: 12,
        cacheReadInputTokens: 13,
        outputTokens: 14,
      },
    });
    expect(trajectory.items[3]).toMatchObject({
      toolName: "Bash",
      callId: "tool-1",
      status: "completed",
      startedAt: 200,
      endedAt: 850,
      durationMs: 650,
      callSelection: { kind: "conversation", id: "conv-2-block-2", recordId: "record-2" },
      resultSelection: { kind: "conversation", id: "conv-3-block-1", recordId: "record-3" },
    });
  });

  it("counts usage once per request across the records of one response", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    const usage = {
      input_tokens: 2,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 5,
      output_tokens: 90,
    };
    builder.push(
      parsedLine({ type: "user", promptId: "prompt-usage", message: { content: "Prompt" } }, 1),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          requestId: "req-1",
          message: { content: [{ type: "text", text: "First block" }], usage },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          requestId: "req-1",
          message: {
            content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }],
            usage,
          },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          requestId: "req-2",
          message: { content: [{ type: "text", text: "Next response" }], usage },
        },
        4,
      ),
    );

    const session = builder.finish([]);

    // Only the first record per request carries token-usage evidence.
    expect(
      session.events.map(
        (event) =>
          event.trajectoryEvidence?.filter((evidence) => evidence.kind === "token-usage").length ??
          0,
      ),
    ).toEqual([0, 1, 0, 1]);

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.stats.tokenUsage).toEqual({
      inputTokens: 4,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 10,
      outputTokens: 180,
    });
  });

  it("still sums usage for records without a request id", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "One" }], usage: { output_tokens: 3 } },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Two" }], usage: { output_tokens: 4 } },
        },
        2,
      ),
    );

    const session = builder.finish([]);
    const trajectory = createAgentTrajectoryModel(session);

    expect(trajectory.stats.tokenUsage).toEqual({ outputTokens: 7 });
  });

  it("keeps repeated Claude blocks and parallel results as separate evidence", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-blocks",
          message: { content: "Read both files" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          timestamp: 100,
          message: {
            content: [
              { type: "thinking", thinking: "First thought" },
              { type: "text", text: "First response" },
              { type: "thinking", thinking: "Second thought" },
              { type: "text", text: "Second response" },
              { type: "tool_use", id: "tool-alpha", name: "Read", input: { path: "a.ts" } },
              { type: "tool_use", id: "tool-beta", name: "Read", input: { path: "b.ts" } },
            ],
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          timestamp: 140,
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tool-alpha", content: "alpha" },
              { type: "tool_result", tool_use_id: "tool-beta", content: "beta", is_error: true },
            ],
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);
    const assistantEvidence = session.events[1]?.trajectoryEvidence ?? [];
    const resultEvidence = session.events[2]?.trajectoryEvidence ?? [];

    expect(assistantEvidence).toHaveLength(6);
    expect(
      assistantEvidence.map((evidence) =>
        "conversationItemId" in evidence ? evidence.conversationItemId : undefined,
      ),
    ).toEqual([
      "conv-2-block-0",
      "conv-2-block-1",
      "conv-2-block-2",
      "conv-2-block-3",
      "conv-2-block-4",
      "conv-2-block-5",
    ]);
    expect(assistantEvidence.map((evidence) => evidence.kind)).toEqual([
      "model-output",
      "model-output",
      "model-output",
      "model-output",
      "tool-lifecycle",
      "tool-lifecycle",
    ]);
    expect(assistantEvidence.slice(0, 4)).toMatchObject([
      { role: "reasoning", turnId: "prompt-blocks" },
      { role: "assistant", turnId: "prompt-blocks" },
      { role: "reasoning", turnId: "prompt-blocks" },
      { role: "assistant", turnId: "prompt-blocks" },
    ]);
    expect(assistantEvidence.slice(4)).toMatchObject([
      { phase: "call", toolName: "Read", callId: "tool-alpha", turnId: "prompt-blocks" },
      { phase: "call", toolName: "Read", callId: "tool-beta", turnId: "prompt-blocks" },
    ]);
    expect(resultEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        status: "completed",
        callId: "tool-alpha",
        conversationItemId: "conv-3-block-0",
        turnId: "prompt-blocks",
      },
      {
        kind: "tool-lifecycle",
        phase: "result",
        status: "failed",
        callId: "tool-beta",
        conversationItemId: "conv-3-block-1",
        turnId: "prompt-blocks",
      },
    ]);

    const trajectory = expectTrajectorySelectionsToResolve(session);
    expect(
      trajectory.items
        .filter((item) => item.kind === "tool")
        .map((item) => ({
          callId: item.callId,
          status: item.status,
          callSelection: item.callSelection,
          resultSelection: item.resultSelection,
        })),
    ).toEqual([
      {
        callId: "tool-alpha",
        status: "completed",
        callSelection: { kind: "conversation", id: "conv-2-block-4", recordId: "record-2" },
        resultSelection: { kind: "conversation", id: "conv-3-block-0", recordId: "record-3" },
      },
      {
        callId: "tool-beta",
        status: "failed",
        callSelection: { kind: "conversation", id: "conv-2-block-5", recordId: "record-2" },
        resultSelection: { kind: "conversation", id: "conv-3-block-1", recordId: "record-3" },
      },
    ]);
  });
});
