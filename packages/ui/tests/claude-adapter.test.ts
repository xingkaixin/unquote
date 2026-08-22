import { describe, expect, it } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentSession,
} from "../src/lib/agent-session";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import type { AgentDetectionSample } from "../src/lib/agent-session/types";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

const trajectoryTurnId = (source: "evidence" | "fallback-index", value: string | number) =>
  JSON.stringify([source, value]);

const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  recordId: `record-${lineNumber}`,
});

const detectionSample = (overrides: Partial<AgentDetectionSample> = {}): AgentDetectionSample => ({
  type: undefined,
  hasObjectPayload: false,
  hasUuid: false,
  hasObjectMessage: false,
  hasSessionId: false,
  ...overrides,
});

const expectTrajectorySelectionsToResolve = (session: AgentSession) => {
  const trajectory = createAgentTrajectoryModel(session);
  const model = createAgentSessionModel(session);

  for (const item of trajectory.items) {
    expect(model.resolveDetail(item.selection)?.recordId).toBe(item.recordId);
    if (item.kind === "tool") {
      if (item.callSelection) {
        expect(model.resolveDetail(item.callSelection)?.recordId).toBe(item.callSelection.recordId);
      }
      if (item.resultSelection) {
        expect(model.resolveDetail(item.resultSelection)?.recordId).toBe(
          item.resultSelection.recordId,
        );
      }
    }
  }

  return trajectory;
};

const transcriptSample = (index: number): AgentDetectionSample =>
  detectionSample({
    type: index % 2 === 0 ? "assistant" : "user",
    hasUuid: true,
    hasObjectMessage: true,
  });

describe("claudeTranscriptAdapter", () => {
  it("scores transcript and metadata evidence", () => {
    expect(claudeTranscriptAdapter.detect([])).toBe(0);
    expect(claudeTranscriptAdapter.detect([detectionSample(), transcriptSample(2)])).toBe(0);
    expect(
      claudeTranscriptAdapter.detect([
        transcriptSample(1),
        detectionSample({ type: "mode", hasSessionId: true }),
      ]),
    ).toBe(0.6);
    expect(claudeTranscriptAdapter.detect([transcriptSample(1), transcriptSample(2)])).toBe(0.75);
    expect(
      claudeTranscriptAdapter.detect(Array.from({ length: 20 }, (_, i) => transcriptSample(i))),
    ).toBe(1);
  });

  it("normalizes user, metadata, and tool-result records", () => {
    const builder = claudeTranscriptAdapter.createBuilder("session.jsonl");
    builder.push(parsedLine(null, 1));
    builder.push(
      parsedLine(
        {
          type: "system",
          content: "  system\nmessage  ",
          sessionId: "session",
          cwd: "/repo",
          version: "1.0.0",
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          uuid: "user-1",
          requestId: "request-1",
          promptId: "prompt-1",
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "user", stop_reason: "end_turn", content: "First prompt" },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-1",
          message: {
            content: [
              null,
              { type: "text", text: "More context" },
              { type: "tool_result", content: { ok: true } },
              { type: "image" },
            ],
          },
        },
        4,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-2",
          isMeta: true,
          message: { content: "hidden metadata" },
        },
        5,
      ),
    );
    builder.push(parsedLine({ type: "user", promptId: "prompt-2" }, 6));
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt-2",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_12345😀tail",
                content: { error: "failed" },
                is_error: true,
              },
            ],
          },
        },
        7,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: null }] },
        },
        8,
      ),
    );

    const session = builder.finish([{ kind: "invalid-json", recordId: "record-9", lineNumber: 9 }]);

    expect(session).toMatchObject({
      fileType: "Claude Code",
      fileName: "session.jsonl",
      meta: {
        sessionId: "session",
        cwd: "/repo",
        version: "1.0.0",
        turnCount: 2,
      },
    });
    expect(session.meta).not.toHaveProperty("eventCount");
    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "user",
      "tool",
      "user",
      "user",
      "tool",
      "tool",
    ]);
    expect(session.events[0]?.preview).toBe("system message");
    // The system line precedes the first prompt, so it belongs to no turn.
    expect(session.events[0]).not.toHaveProperty("turnIndex");
    expect(session.events[1]).toMatchObject({ turnIndex: 1 });
    const items = conversationItems(session);
    expect(items.map((item) => item.role)).toEqual([
      "user",
      "user",
      "tool_result",
      "user",
      "tool_result",
      "tool_result",
    ]);
    expect(items[1]?.block).toEqual({ type: "text", text: "More context" });
    expect(items[2]?.block).toMatchObject({ type: "tool_result", status: "completed" });
    expect(items[3]).not.toHaveProperty("block");
    expect(items[4]?.block).toMatchObject({
      type: "tool_result",
      status: "failed",
      toolCallId: "toolu_12345😀tail",
    });
    expect(items[5]?.block).toEqual({ type: "tool_result", text: "", status: "completed" });
    expect(session.events[2]?.label).toBe("tool_result (2 blocks)");
    expect(session.events[5]?.label).toBe("tool_result toolu_12345");
  });

  it("normalizes assistant content blocks, model state, and partial token usage", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "user",
          promptId: "prompt",
          message: { content: "Start" },
        },
        1,
      ),
    );
    builder.push(parsedLine({ type: "assistant" }, 2));
    builder.push(parsedLine({ type: "assistant", message: { content: "invalid" } }, 3));
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Reply" }],
            usage: { input_tokens: "invalid" },
          },
        },
        4,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: { content: [{ type: "thinking", thinking: "Consider" }] },
        },
        5,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            model: "claude-test",
            content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: null }],
          },
        },
        6,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [
              null,
              { type: "text", text: "Final" },
              { type: "thinking", thinking: "Check" },
              { type: "tool_use", id: "tool-2", name: "Read", input: { path: "/tmp" } },
              { type: "text", text: 1 },
              { type: "thinking", thinking: false },
              { type: "tool_use", name: "Missing id" },
            ],
            usage: {
              input_tokens: 5,
              output_tokens: Number.POSITIVE_INFINITY,
              cache_creation_input_tokens: 2,
            },
          },
        },
        7,
      ),
    );

    const session = builder.finish([]);
    expect(session.meta).toMatchObject({ model: "claude-test", turnCount: 1 });
    expect(session.events[3]?.label).toBe("text");
    expect(session.events[4]?.label).toBe("thinking");
    expect(session.events[5]).toMatchObject({
      label: "tool_use Bash",
      preview: "Bash: {}",
    });
    expect(session.events[6]).toMatchObject({
      label: "assistant (3 blocks)",
    });
    const items = conversationItems(session);
    expect(items.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "assistant",
      "thinking",
      "tool_call",
      "assistant",
      "thinking",
      "tool_call",
    ]);
    expect(items[5]?.block).toMatchObject({
      type: "tool_use",
      toolName: "Bash",
      text: "{}",
    });
  });

  it("normalizes each event's content exactly once", () => {
    let inputReads = 0;
    const toolInput = (key: string, value: string) =>
      Object.defineProperty({}, key, {
        enumerable: true,
        get() {
          inputReads += 1;
          return value;
        },
      });
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Bash",
                input: toolInput("command", "ls"),
              },
            ],
          },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-2",
                name: "Read",
                input: toolInput("path", "/tmp"),
              },
            ],
          },
        },
        2,
      ),
    );
    builder.finish([]);

    expect(inputReads).toBe(2);
  });

  it("bounds deeply nested tool input without failing the event", () => {
    let input: unknown = "leaf";
    for (let depth = 0; depth < 7_000; depth += 1) {
      input = [input];
    }
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "tool-1", name: "Deep", input }],
          },
        },
        1,
      ),
    );

    const session = builder.finish([]);
    const block = conversationItems(session)[0]?.block;

    expect(block?.text).toMatch(/\.\.\. \[truncated\]$/);
    expect(session.events[0]?.label).toBe("tool_use Deep");
  });

  it("projects a string message body the same way as a single text block", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(parsedLine({ type: "assistant", message: { content: "Plain reply" } }, 1));

    const session = builder.finish([]);

    expect(session.events[0]).toMatchObject({ label: "text", preview: "Plain reply" });
    expect(conversationItems(session)[0]?.block).toEqual({ type: "text", text: "Plain reply" });
  });

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
    expect(session.events.flatMap((event) => event.trajectoryEvidence ?? [])).toMatchObject([
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
    expect(session.events.flatMap((event) => event.trajectoryEvidence ?? [])).toEqual([
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
    expect(session.events[0]?.trajectoryEvidence).toEqual([
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
    expect(session.events[1]?.trajectoryEvidence).toEqual([
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
    expect(activeSession.events.flatMap((event) => event.trajectoryEvidence ?? [])).toMatchObject([
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
    expect(unscopedSession.events.flatMap((event) => event.trajectoryEvidence ?? [])).toEqual([
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
    const evidence = session.events.flatMap((event) => event.trajectoryEvidence ?? []);

    expect(session.events[1]?.trajectoryEvidence).toEqual([
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
    expect(session.events[2]?.trajectoryEvidence).toEqual([
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
