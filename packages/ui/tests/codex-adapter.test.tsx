import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSessionModel,
  createAgentTrajectoryModel,
  type AgentSession,
} from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  recordId: `record-${lineNumber}`,
});

const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

const trajectoryTurnId = (turnId: string) => JSON.stringify(["evidence", turnId]);

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter", () => {
  it("scores only recognized Codex envelopes with record payloads", () => {
    expect(codexRolloutAdapter.detect([])).toBe(0);
    expect(
      codexRolloutAdapter.detect([
        parsedLine(null, 1),
        parsedLine({ type: "session_meta", payload: null }, 2),
        parsedLine({ type: "session_meta", payload: { id: "session" } }, 3),
      ]),
    ).toBe(1 / 3);
  });

  it("recognizes compacted Codex envelopes", () => {
    expect(
      codexRolloutAdapter.detect([
        parsedLine({ type: "compacted", payload: { replacement: "private compaction body" } }, 1),
      ]),
    ).toBe(1);
  });

  it("tracks metadata, turn changes, event categories, and parse warnings", () => {
    const builder = codexRolloutAdapter.createBuilder("rollout.jsonl");
    builder.push(parsedLine(null, 1));
    builder.push(parsedLine({ type: "session_meta", payload: null }, 2));
    builder.push(
      parsedLine(
        {
          type: "session_meta",
          timestamp: 100,
          payload: { id: "legacy-session", cwd: "/repo", cli_version: "1.0.0" },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "turn_context",
          timestamp: "invalid",
          payload: { turn_id: "turn-1", cwd: "/turn", model: "gpt-test" },
        },
        4,
      ),
    );
    builder.push(
      parsedLine({ type: "event_msg", payload: { type: "task_started", turn_id: "turn-2" } }, 5),
    );
    builder.push(parsedLine({ type: "event_msg", payload: { type: "user_message" } }, 6));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "agent_message" } }, 7));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "task_complete" } }, 8));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "token_count" } }, 9));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "custom" } }, 10));
    builder.push(parsedLine({ type: "event_msg", payload: {} }, 11));
    builder.push(parsedLine({ type: "other", payload: {} }, 12));

    const session = builder.finish([{ lineNumber: 13, message: "Invalid JSON on this line" }]);

    expect(session.meta).toMatchObject({
      sessionId: "legacy-session",
      cwd: "/repo",
      version: "1.0.0",
      model: "gpt-test",
      eventCount: 10,
      turnCount: 2,
    });
    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "meta",
      "meta",
      "user",
      "assistant",
      "meta",
      "meta",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(session.events[0]).toMatchObject({ timestamp: 100 });
    // The session_meta line precedes the first turn boundary, so it carries no
    // turn; the turn_context that opens turn-1 is the first numbered event.
    expect(session.events[0]).not.toHaveProperty("turnIndex");
    expect(session.events[1]).toMatchObject({ turnIndex: 1 });
    expect(session.events[1]).not.toHaveProperty("timestamp");
    expect(session.parseWarnings).toEqual([
      { lineNumber: 13, message: "Invalid JSON on this line" },
    ]);
  });

  it("projects verified Codex facts as trajectory evidence", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "turn_context",
          timestamp: 100,
          payload: { turn_id: "turn-alpha", cwd: "/repo", model: "gpt-test" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 110,
          payload: { type: "task_started", turn_id: "turn-alpha" },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 120,
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Inspect the file" }],
          },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 130,
          payload: { type: "reasoning", summary: [{ text: "I should inspect it." }] },
        },
        4,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 140,
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I will inspect it." }],
          },
        },
        5,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 150,
          payload: {
            type: "function_call",
            name: "read_file",
            call_id: "call-alpha",
            arguments: '{"path":"README.md"}',
          },
        },
        6,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 170,
          payload: {
            type: "function_call_output",
            call_id: "call-alpha",
            output: "contents",
          },
        },
        7,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 180,
          payload: {
            type: "token_count",
            turn_id: "turn-alpha",
            input_tokens: 13,
            cached_input_tokens: 11,
            output_tokens: 7,
          },
        },
        8,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 190,
          payload: { type: "task_complete", turn_id: "turn-alpha" },
        },
        9,
      ),
    );

    const session = builder.finish([]);

    expect(
      session.events.map(({ lineNumber, recordId, timestamp, turnIndex, trajectoryEvidence }) => ({
        lineNumber,
        recordId,
        timestamp,
        turnIndex,
        trajectoryEvidence,
      })),
    ).toEqual([
      {
        lineNumber: 1,
        recordId: "record-1",
        timestamp: 100,
        turnIndex: 1,
        trajectoryEvidence: undefined,
      },
      {
        lineNumber: 2,
        recordId: "record-2",
        timestamp: 110,
        turnIndex: 1,
        trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "start", turnId: "turn-alpha" }],
      },
      {
        lineNumber: 3,
        recordId: "record-3",
        timestamp: 120,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "model-output",
            role: "user",
            turnId: "turn-alpha",
            conversationItemId: "conv-3-user",
          },
        ],
      },
      {
        lineNumber: 4,
        recordId: "record-4",
        timestamp: 130,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "model-output",
            role: "reasoning",
            turnId: "turn-alpha",
            conversationItemId: "conv-4-thinking",
          },
        ],
      },
      {
        lineNumber: 5,
        recordId: "record-5",
        timestamp: 140,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "model-output",
            role: "assistant",
            turnId: "turn-alpha",
            conversationItemId: "conv-5-assistant",
          },
        ],
      },
      {
        lineNumber: 6,
        recordId: "record-6",
        timestamp: 150,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            turnId: "turn-alpha",
            toolName: "read_file",
            callId: "call-alpha",
            conversationItemId: "conv-6-tool-call",
          },
        ],
      },
      {
        lineNumber: 7,
        recordId: "record-7",
        timestamp: 170,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            turnId: "turn-alpha",
            status: "completed",
            callId: "call-alpha",
            conversationItemId: "conv-7-tool-result",
          },
        ],
      },
      {
        lineNumber: 8,
        recordId: "record-8",
        timestamp: 180,
        turnIndex: 1,
        trajectoryEvidence: [
          {
            kind: "token-usage",
            turnId: "turn-alpha",
            usage: { inputTokens: 13, cacheReadInputTokens: 11, outputTokens: 7 },
          },
        ],
      },
      {
        lineNumber: 9,
        recordId: "record-9",
        timestamp: 190,
        turnIndex: 1,
        trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-alpha" }],
      },
    ]);

    for (const event of session.events) {
      for (const evidence of event.trajectoryEvidence ?? []) {
        expect(evidence).not.toHaveProperty("recordId");
        expect(evidence).not.toHaveProperty("lineNumber");
        expect(evidence).not.toHaveProperty("timestamp");
        expect(evidence).not.toHaveProperty("turnIndex");
      }
    }
    const model = createAgentTrajectoryModel(session);
    expect(model.turns).toMatchObject([
      {
        id: trajectoryTurnId("turn-alpha"),
        status: "completed",
        turnIndex: 1,
        startedAt: 110,
        endedAt: 190,
        durationMs: 80,
      },
    ]);
    expect(model.items).toMatchObject([
      {
        kind: "user",
        recordId: "record-3",
        lineNumber: 3,
        timestamp: 120,
        turnIndex: 1,
        selection: { kind: "conversation", id: "conv-3-user", recordId: "record-3" },
      },
      {
        kind: "reasoning",
        recordId: "record-4",
        lineNumber: 4,
        timestamp: 130,
        turnIndex: 1,
        selection: { kind: "conversation", id: "conv-4-thinking", recordId: "record-4" },
      },
      {
        kind: "assistant",
        recordId: "record-5",
        lineNumber: 5,
        timestamp: 140,
        turnIndex: 1,
        tokenUsage: { inputTokens: 13, cacheReadInputTokens: 11, outputTokens: 7 },
        selection: { kind: "conversation", id: "conv-5-assistant", recordId: "record-5" },
      },
      {
        kind: "tool",
        status: "completed",
        recordId: "record-6",
        lineNumber: 6,
        timestamp: 150,
        turnIndex: 1,
        durationMs: 20,
        callSelection: { kind: "conversation", id: "conv-6-tool-call", recordId: "record-6" },
        resultSelection: { kind: "conversation", id: "conv-7-tool-result", recordId: "record-7" },
      },
    ]);
  });

  it("keeps late lifecycle and token evidence on their payload turn", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-old" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 20,
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Working on the old turn" }],
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "turn_context",
          timestamp: 30,
          payload: { turn_id: "turn-new" },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 40,
          payload: { type: "task_started", turn_id: "turn-new" },
        },
        4,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 50,
          payload: { type: "token_count", turn_id: "turn-old", input_tokens: 3 },
        },
        5,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 60,
          payload: { type: "task_complete", turn_id: "turn-old" },
        },
        6,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[4]).toMatchObject({
      turnIndex: 1,
      trajectoryEvidence: [{ kind: "token-usage", turnId: "turn-old", usage: { inputTokens: 3 } }],
    });
    expect(session.events[5]).toMatchObject({
      turnIndex: 1,
      trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-old" }],
    });

    const model = createAgentTrajectoryModel(session);
    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("turn-old"), status: "completed", turnIndex: 1, durationMs: 50 },
      { id: trajectoryTurnId("turn-new"), status: "running", turnIndex: 2 },
    ]);
    expect(model.turns[0]?.items).toMatchObject([{ tokenUsage: { inputTokens: 3 } }]);
  });

  it("maps nested token sources independently before falling back to direct fields", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-token-usage" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: { last_token_usage: { input_tokens: "invalid" } },
            input_tokens: 5,
            output_tokens: 2,
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: { input_tokens: 4 },
              total_token_usage: { input_tokens: 400, output_tokens: 200 },
            },
            input_tokens: 40,
            output_tokens: 20,
          },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: { total_token_usage: { input_tokens: 50, output_tokens: 25 } },
          },
        },
        4,
      ),
    );

    const session = builder.finish([]);

    expect(session.events.slice(1).map((event) => event.trajectoryEvidence)).toEqual([
      [
        {
          kind: "token-usage",
          turnId: "turn-token-usage",
          usage: { inputTokens: 5, outputTokens: 2 },
        },
      ],
      [
        {
          kind: "token-usage",
          turnId: "turn-token-usage",
          usage: { inputTokens: 4 },
          cumulativeUsage: { inputTokens: 400, outputTokens: 200 },
        },
      ],
      [
        {
          kind: "token-usage",
          turnId: "turn-token-usage",
          cumulativeUsage: { inputTokens: 50, outputTokens: 25 },
        },
      ],
    ]);
  });

  it("projects nested token deltas and totals through canonical turn selections", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-nested-tokens" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 20,
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "First response" }],
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 30,
          payload: {
            type: "token_count",
            turn_id: "turn-nested-tokens",
            info: {
              last_token_usage: { input_tokens: 100, output_tokens: 10 },
              total_token_usage: { input_tokens: 100, output_tokens: 10 },
            },
          },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 40,
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Second response" }],
          },
        },
        4,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 50,
          payload: {
            type: "token_count",
            turn_id: "turn-nested-tokens",
            info: {
              last_token_usage: { input_tokens: 20, output_tokens: 5 },
              total_token_usage: { input_tokens: 120, output_tokens: 15 },
            },
          },
        },
        5,
      ),
    );

    const source = builder.finish([]);
    expect(source.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-nested-tokens",
        usage: { inputTokens: 100, outputTokens: 10 },
        cumulativeUsage: { inputTokens: 100, outputTokens: 10 },
      },
    ]);
    expect(source.events[4]?.trajectoryEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-nested-tokens",
        usage: { inputTokens: 20, outputTokens: 5 },
        cumulativeUsage: { inputTokens: 120, outputTokens: 15 },
      },
    ]);

    const trajectory = createAgentTrajectoryModel(source);
    const canonical = createAgentSessionModel(source);
    const assistantItems = trajectory.items.filter((item) => item.kind === "assistant");
    expect(assistantItems).toMatchObject([
      {
        tokenUsage: { inputTokens: 100, outputTokens: 10 },
        selection: { kind: "conversation", id: "conv-2-assistant", recordId: "record-2" },
      },
      {
        tokenUsage: { inputTokens: 20, outputTokens: 5 },
        selection: { kind: "conversation", id: "conv-4-assistant", recordId: "record-4" },
      },
    ]);
    expect(trajectory.stats.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 15 });
    expect(canonical.resolveDetail(assistantItems[0]?.selection ?? null)?.recordId).toBe(
      "record-2",
    );
    expect(canonical.resolveDetail(assistantItems[1]?.selection ?? null)?.recordId).toBe(
      "record-4",
    );
  });

  it("maps every current Codex token component without double counting its total", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-current-tokens" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Counting tokens" }],
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 101,
                output_tokens: 203,
                cached_input_tokens: 307,
                cache_write_input_tokens: 401,
                reasoning_output_tokens: 509,
                total_tokens: 9_999,
              },
              total_token_usage: {
                input_tokens: 1_001,
                output_tokens: 2_003,
                cached_input_tokens: 3_007,
                cache_write_input_tokens: 4_009,
                reasoning_output_tokens: 5_011,
                total_tokens: 99_999,
              },
            },
          },
        },
        3,
      ),
    );

    const source = builder.finish([]);
    const trajectory = createAgentTrajectoryModel(source);

    expect(source.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-current-tokens",
        usage: {
          inputTokens: 101,
          outputTokens: 203,
          cacheReadInputTokens: 307,
          cacheCreationInputTokens: 401,
          reasoningOutputTokens: 509,
        },
        cumulativeUsage: {
          inputTokens: 1_001,
          outputTokens: 2_003,
          cacheReadInputTokens: 3_007,
          cacheCreationInputTokens: 4_009,
          reasoningOutputTokens: 5_011,
        },
      },
    ]);
    expect(trajectory.items).toEqual([
      expect.objectContaining({
        tokenUsage: {
          inputTokens: 101,
          outputTokens: 203,
          cacheReadInputTokens: 307,
          cacheCreationInputTokens: 401,
          reasoningOutputTokens: 509,
        },
      }),
    ]);
    expect(trajectory.stats.tokenUsage).toEqual({
      inputTokens: 1_001,
      outputTokens: 2_003,
      cacheReadInputTokens: 3_007,
      cacheCreationInputTokens: 4_009,
      reasoningOutputTokens: 5_011,
    });
  });

  it("omits invalid and overflowing Codex token components", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-invalid-tokens" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: -1,
                output_tokens: 3,
                cached_input_tokens: Number.POSITIVE_INFINITY,
                cache_write_input_tokens: Number.MAX_SAFE_INTEGER + 1,
                reasoning_output_tokens: -2,
              },
              total_token_usage: {
                input_tokens: Number.MAX_SAFE_INTEGER + 1,
                output_tokens: -1,
                cached_input_tokens: 5,
                cache_write_input_tokens: Number.POSITIVE_INFINITY,
                reasoning_output_tokens: -3,
              },
            },
          },
        },
        2,
      ),
    );

    const source = builder.finish([]);
    const trajectory = createAgentTrajectoryModel(source);

    expect(source.events[1]?.trajectoryEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-invalid-tokens",
        usage: { outputTokens: 3 },
        cumulativeUsage: { cacheReadInputTokens: 5 },
      },
    ]);
    expect(trajectory.stats.tokenUsage).toEqual({ outputTokens: 3, cacheReadInputTokens: 5 });
  });

  it("keeps a statusless tool result paired and running", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-statusless" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 20,
          payload: {
            type: "function_call",
            name: "inspect",
            call_id: "call-statusless",
            arguments: "{}",
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 30,
          payload: {
            type: "function_call_output",
            call_id: "call-statusless",
            output: null,
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-statusless",
        callId: "call-statusless",
        conversationItemId: "conv-3-tool-result",
      },
    ]);

    const model = createAgentTrajectoryModel(session);
    expect(model.items).toMatchObject([
      {
        kind: "tool",
        status: "running",
        callId: "call-statusless",
        resultSelection: {
          kind: "conversation",
          id: "conv-3-tool-result",
          recordId: "record-3",
        },
      },
    ]);
    expect(model.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unpaired-tool-result", callId: "call-statusless" }),
      ]),
    );
  });

  it("derives custom tool duration from its paired event timestamps", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-custom" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 100,
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            call_id: "call-custom",
            input: "*** Begin Patch",
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 360,
          payload: {
            type: "custom_tool_call_output",
            call_id: "call-custom",
            output: "Done",
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[1]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "call",
        turnId: "turn-custom",
        toolName: "apply_patch",
        callId: "call-custom",
        conversationItemId: "conv-2-tool-call",
      },
    ]);
    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-custom",
        status: "completed",
        callId: "call-custom",
        conversationItemId: "conv-3-tool-result",
      },
    ]);

    const model = createAgentTrajectoryModel(session);
    expect(model.items).toMatchObject([
      {
        kind: "tool",
        status: "completed",
        callId: "call-custom",
        startedAt: 100,
        endedAt: 360,
        durationMs: 260,
      },
    ]);
  });

  it("projects a failed MCP completion without retaining its result body", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-completion" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 20,
          payload: { type: "function_call", name: "tool", call_id: "call-completion" },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 30,
          payload: {
            type: "mcp_tool_call_end",
            call_id: "call-completion",
            success: false,
            duration: 1.5,
            result: { body: "Do not copy this completion result" },
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);
    const evidence = session.events[2]?.trajectoryEvidence?.[0];

    expect(session.events[2]?.category).toBe("tool");
    expect(evidence).toEqual({
      kind: "tool-lifecycle",
      phase: "completion",
      turnId: "turn-completion",
      callId: "call-completion",
      status: "failed",
      durationMs: 1500,
    });
    expect(evidence).not.toHaveProperty("result");
    expect(evidence).not.toHaveProperty("body");
    expect(evidence).not.toHaveProperty("output");

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.items).toMatchObject([
      {
        kind: "tool",
        status: "failed",
        callId: "call-completion",
        durationMs: 1500,
        callSelection: { kind: "conversation", id: "conv-2-tool-call", recordId: "record-2" },
        completionSelection: { kind: "event", id: "line-3", recordId: "record-3" },
      },
    ]);
    const model = createAgentSessionModel(session);
    const tool = trajectory.items[0];
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(model.resolveDetail(tool.completionSelection ?? null)).toMatchObject({
        recordId: "record-3",
      });
    }
  });

  it("projects the official MCP completion and output triple as one failed tool", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 1,
          payload: { type: "task_started", turn_id: "turn-17106" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 10,
          payload: {
            type: "function_call",
            name: "mcp__github__get_issue",
            call_id: "call-17106",
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 20,
          payload: {
            type: "mcp_tool_call_end",
            call_id: "call-17106",
            duration: 1.25,
            result: { Err: { message: "Do not retain this completion body" } },
          },
        },
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 30,
          payload: {
            type: "function_call_output",
            call_id: "call-17106",
            output: "The output remains canonical only in its Record",
          },
        },
        4,
      ),
    );

    const source = builder.finish([]);
    const trajectory = createAgentTrajectoryModel(source);
    const model = createAgentSessionModel(source);
    const [call, output] = model.conversation.map(({ item }) => item);

    expect(source.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-17106",
        callId: "call-17106",
        status: "failed",
        durationMs: 1250,
      },
    ]);
    expect(trajectory.stats).toMatchObject({ toolCount: 1, failedToolCount: 1 });
    expect(trajectory.items).toEqual([
      expect.objectContaining({
        kind: "tool",
        status: "failed",
        callSelection: { kind: "conversation", id: "conv-2-tool-call", recordId: "record-2" },
        resultSelection: {
          kind: "conversation",
          id: "conv-4-tool-result",
          recordId: "record-4",
        },
        completionSelection: { kind: "event", id: "line-3", recordId: "record-3" },
      }),
    ]);
    expect(
      trajectory.warnings.filter((warning) =>
        [
          "duplicate-tool-call-id",
          "duplicate-tool-result-id",
          "duplicate-tool-completion-id",
          "unpaired-tool-call",
          "unpaired-tool-result",
          "unpaired-tool-completion",
        ].includes(warning.kind),
      ),
    ).toEqual([]);
    expect(model.resolveToolStatus(call!)).toBe("failed");
    expect(model.resolveToolStatus(output!)).toBe("failed");
    expect(model.resolveToolName(output!)).toBe("mcp__github__get_issue");
    for (const selection of [
      { kind: "conversation", id: "conv-2-tool-call", recordId: "record-2" } as const,
      { kind: "conversation", id: "conv-4-tool-result", recordId: "record-4" } as const,
      { kind: "event", id: "line-3", recordId: "record-3" } as const,
    ]) {
      expect(model.resolveDetail(selection)).not.toBeNull();
    }
  });

  it.each(["patch_apply_end", "web_search_end"] as const)(
    "projects %s as a completed tool result",
    (type) => {
      const builder = codexRolloutAdapter.createBuilder();
      builder.push(
        parsedLine(
          {
            type: "event_msg",
            payload: { type: "task_started", turn_id: "turn-tool-completion" },
          },
          1,
        ),
      );
      builder.push(
        parsedLine(
          {
            type: "event_msg",
            payload: { type, call_id: `call-${type}`, success: true },
          },
          2,
        ),
      );

      const session = builder.finish([]);

      expect(session.events[1]).toMatchObject({
        category: "tool",
        trajectoryEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "completion",
            turnId: "turn-tool-completion",
            callId: `call-${type}`,
            status: "completed",
          },
        ],
      });
    },
  );

  it.each([
    { name: "negative duration", duration: -0.1, success: true, status: "completed" as const },
    {
      name: "non-finite duration",
      duration: Number.POSITIVE_INFINITY,
      success: false,
      status: "failed" as const,
    },
    { name: "unsafe converted duration", duration: Number.MAX_SAFE_INTEGER, status: undefined },
  ])("omits $name from completion evidence", ({ duration, success, status }) => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-invalid-duration" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "mcp_tool_call_end",
            call_id: "call-invalid-duration",
            duration,
            ...(success === undefined ? {} : { success }),
          },
        },
        2,
      ),
    );

    const evidence = builder.finish([]).events[1]?.trajectoryEvidence?.[0];

    expect(evidence).toMatchObject({
      kind: "tool-lifecycle",
      phase: "completion",
      turnId: "turn-invalid-duration",
      callId: "call-invalid-duration",
      ...(status === undefined ? {} : { status }),
    });
    expect(evidence).not.toHaveProperty("durationMs");
    if (status === undefined) {
      expect(evidence).not.toHaveProperty("status");
    }
  });

  it.each([
    { name: "Ok result", result: { Ok: { value: "done" } }, status: "completed" as const },
    {
      name: "Ok result with an error flag",
      result: { Ok: { isError: true } },
      status: "failed" as const,
    },
  ])("maps current completion $name", ({ result, status }) => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-current-completion" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "mcp_tool_call_end",
            call_id: "call-current-completion",
            result,
          },
        },
        2,
      ),
    );

    const evidence = builder.finish([]).events[1]?.trajectoryEvidence?.[0];

    expect(evidence).toEqual({
      kind: "tool-lifecycle",
      phase: "completion",
      turnId: "turn-current-completion",
      callId: "call-current-completion",
      status,
    });
    expect(evidence).not.toHaveProperty("result");
    expect(evidence).not.toHaveProperty("body");
    expect(evidence).not.toHaveProperty("output");
  });

  it("ignores inherited completion status fields", () => {
    const inheritedPayload = Object.assign(
      Object.create({ success: false, status: "failed", result: { Err: "inherited" } }),
      { type: "mcp_tool_call_end", call_id: "call-own-properties" },
    );
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-own-properties" },
        },
        1,
      ),
    );
    builder.push(parsedLine({ type: "event_msg", payload: inheritedPayload }, 2));

    expect(builder.finish([]).events[1]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-own-properties",
        callId: "call-own-properties",
      },
    ]);
  });

  it("projects a completion-only success failure as one orphan tool", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-completion-only" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "mcp_tool_call_end",
            call_id: "call-completion-only",
            success: false,
          },
        },
        2,
      ),
    );

    const trajectory = createAgentTrajectoryModel(builder.finish([]));

    expect(trajectory.items).toEqual([
      expect.objectContaining({
        kind: "tool",
        status: "failed",
        completionSelection: { kind: "event", id: "line-2", recordId: "record-2" },
      }),
    ]);
    expect(trajectory.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unpaired-tool-completion",
          callId: "call-completion-only",
        }),
      ]),
    );
    expect(trajectory.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "unpaired-tool-result" })]),
    );
  });

  it("maps verified supplemental Codex events without copying payload fields", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "turn_context",
          timestamp: 10,
          payload: { turn_id: "turn-marker" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 20,
          payload: {
            type: "agent_message",
            message: "Do not copy this marker body",
            body: "Do not infer this shape",
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "user_message", message: "Unverified user shape" },
        },
        3,
      ),
    );
    builder.push(parsedLine({ type: "event_msg", payload: { type: "turn_aborted" } }, 4));
    builder.push(
      parsedLine(
        { type: "event_msg", payload: { type: "sub_agent_activity", kind: "finished" } },
        5,
      ),
    );
    builder.push(
      parsedLine(
        { type: "event_msg", payload: { type: "sub_agent_activity", kind: "started" } },
        6,
      ),
    );
    builder.push(parsedLine({ type: "event_msg", payload: { type: "compacted" } }, 7));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "context_compacted" } }, 8));
    builder.push(
      parsedLine(
        { type: "compacted", payload: { replacement: "Do not copy this compaction body" } },
        9,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "agent_message",
            author: "reviewer",
            recipient: "root",
            content: [{ text: "Do not copy this inter-agent message" }],
          },
        },
        10,
      ),
    );
    builder.push(parsedLine({ type: "event_msg", payload: { type: "mcp_tool_call_end" } }, 11));
    builder.push(parsedLine({ type: "event_msg", payload: { type: "exec_command_end" } }, 12));

    const session = builder.finish([]);

    expect(session.events[0]?.trajectoryEvidence).toBeUndefined();
    expect(session.events[1]?.conversationItems).toEqual([]);
    expect(session.events[1]?.trajectoryEvidence).toEqual([
      { kind: "model-output", role: "assistant", turnId: "turn-marker" },
    ]);
    expect(session.events.slice(2).map((event) => event.trajectoryEvidence)).toEqual([
      undefined,
      [{ kind: "turn-lifecycle", phase: "aborted", turnId: "turn-marker" }],
      undefined,
      [{ kind: "subagent-activity", status: "running", turnId: "turn-marker" }],
      undefined,
      [{ kind: "compaction", turnId: "turn-marker" }],
      [{ kind: "compaction", turnId: "turn-marker" }],
      [{ kind: "subagent-activity", status: "completed", turnId: "turn-marker" }],
      undefined,
      undefined,
    ]);
    expect(session.events[3]?.category).toBe("meta");
    expect(session.events[10]?.category).toBe("tool");
    expect(session.events[9]?.conversationItems[0]).not.toHaveProperty("block");
    for (const event of session.events) {
      for (const evidence of event.trajectoryEvidence ?? []) {
        for (const field of [
          "recordId",
          "lineNumber",
          "timestamp",
          "turnIndex",
          "body",
          "replacement",
          "content",
          "author",
          "recipient",
          "result",
        ]) {
          expect(evidence).not.toHaveProperty(field);
        }
      }
    }

    const model = createAgentTrajectoryModel(session);
    expect(model.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assistant",
          selection: { kind: "event", id: "line-2", recordId: "record-2" },
        }),
      ]),
    );
  });

  it("associates verified Codex evidence with its turn and canonical detail", () => {
    const builder = codexRolloutAdapter.createBuilder();
    const events = [
      {
        type: "event_msg",
        timestamp: 10,
        payload: { type: "task_started", turn_id: "turn-old" },
      },
      {
        type: "response_item",
        timestamp: 20,
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Working on the old turn" }],
        },
      },
      { type: "turn_context", timestamp: 30, payload: { turn_id: "turn-new" } },
      {
        type: "event_msg",
        timestamp: 40,
        payload: { type: "task_started", turn_id: "turn-new" },
      },
      {
        type: "event_msg",
        timestamp: 50,
        payload: {
          type: "token_count",
          turn_id: "turn-old",
          info: {
            last_token_usage: { input_tokens: 7, output_tokens: 3 },
            total_token_usage: { input_tokens: 700, output_tokens: 300 },
          },
        },
      },
      {
        type: "event_msg",
        timestamp: 60,
        payload: { type: "sub_agent_activity", kind: "started", turn_id: "turn-old" },
      },
      {
        type: "event_msg",
        timestamp: 70,
        payload: { type: "context_compacted", replacement: "Do not retain this body" },
      },
      {
        type: "compacted",
        timestamp: 80,
        payload: { replacement: "Do not retain this top-level body" },
      },
      {
        type: "response_item",
        timestamp: 90,
        payload: {
          type: "agent_message",
          author: "reviewer",
          recipient: "root",
          content: [{ text: "Do not retain this message" }],
        },
      },
      {
        type: "event_msg",
        timestamp: 100,
        payload: { type: "turn_aborted", turn_id: "turn-old", reason: "cancelled" },
      },
    ];
    events.forEach((event, index) => builder.push(parsedLine(event, index + 1)));

    const session = builder.finish([]);

    expect(session.events[4]).toMatchObject({
      turnIndex: 1,
      trajectoryEvidence: [
        {
          kind: "token-usage",
          turnId: "turn-old",
          usage: { inputTokens: 7, outputTokens: 3 },
          cumulativeUsage: { inputTokens: 700, outputTokens: 300 },
        },
      ],
    });
    expect(session.events[5]).toMatchObject({
      turnIndex: 1,
      trajectoryEvidence: [{ kind: "subagent-activity", status: "running", turnId: "turn-old" }],
    });
    expect(session.events[9]).toMatchObject({
      turnIndex: 1,
      trajectoryEvidence: [{ kind: "turn-lifecycle", phase: "aborted", turnId: "turn-old" }],
    });

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.turns).toMatchObject([
      {
        id: trajectoryTurnId("turn-old"),
        status: "aborted",
        turnIndex: 1,
        startedAt: 10,
        endedAt: 100,
        durationMs: 90,
      },
      { id: trajectoryTurnId("turn-new"), status: "running", turnIndex: 2 },
    ]);
    expect(trajectory.stats.tokenUsage).toEqual({ inputTokens: 700, outputTokens: 300 });
    expect(
      trajectory.items.map(({ kind, status, recordId, selection }) => ({
        kind,
        status,
        recordId,
        selection,
      })),
    ).toEqual([
      {
        kind: "assistant",
        status: "completed",
        recordId: "record-2",
        selection: { kind: "conversation", id: "conv-2-assistant", recordId: "record-2" },
      },
      {
        kind: "subagent",
        status: "running",
        recordId: "record-6",
        selection: { kind: "event", id: "line-6", recordId: "record-6" },
      },
      {
        kind: "compaction",
        status: "completed",
        recordId: "record-7",
        selection: { kind: "event", id: "line-7", recordId: "record-7" },
      },
      {
        kind: "compaction",
        status: "completed",
        recordId: "record-8",
        selection: { kind: "event", id: "line-8", recordId: "record-8" },
      },
      {
        kind: "subagent",
        status: "completed",
        recordId: "record-9",
        selection: { kind: "event", id: "line-9", recordId: "record-9" },
      },
    ]);

    const model = createAgentSessionModel(session);
    for (const item of trajectory.items) {
      expect(model.resolveDetail(item.selection)).toMatchObject({ recordId: item.recordId });
    }
    for (const event of session.events) {
      for (const evidence of event.trajectoryEvidence ?? []) {
        for (const field of ["recordId", "lineNumber", "timestamp", "turnIndex", "body"]) {
          expect(evidence).not.toHaveProperty(field);
        }
      }
    }
  });

  it("normalizes Codex response item variants into conversation blocks", () => {
    const builder = codexRolloutAdapter.createBuilder();
    const responses = [
      {
        type: "message",
        role: "developer",
        content: [null, { type: "output_text", text: "System guidance" }],
      },
      { type: "message", role: "assistant", content: [{ type: "input_text", text: "Done" }] },
      { type: "message", role: "other", content: "invalid" },
      { type: "reasoning" },
      { type: "reasoning", summary: [null, { text: "" }] },
      { type: "custom_tool_call" },
      { type: "custom_tool_call", input: "not json", call_id: "short-id" },
      { type: "function_call", name: "scalar_tool", arguments: "42" },
      {
        type: "custom_tool_call_output",
        call_id: "call_123456😀tail",
        output: { ok: true },
      },
      {
        type: "function_call_output",
        output: JSON.stringify({ metadata: { exit_code: 1 } }),
      },
      { type: "function_call_output", output: "not json", status: "failed" },
      { type: "function_call_output", output: null },
      { type: "future_item" },
      {},
    ];

    responses.forEach((payload, index) => {
      builder.push(parsedLine({ type: "response_item", payload }, index + 1));
    });

    const session = builder.finish([]);
    const items = conversationItems(session);
    expect(session.meta.turnCount).toBe(1);
    expect(items.map((item) => item.role)).toEqual([
      "system",
      "assistant",
      "system",
      "thinking",
      "thinking",
      "tool_call",
      "tool_call",
      "tool_call",
      "tool_result",
      "tool_result",
      "tool_result",
      "tool_result",
      "system",
      "system",
    ]);
    expect(items[0]?.block?.text).toBe("System guidance");
    expect(items[2]).not.toHaveProperty("block");
    expect(items[3]?.block?.text).toBe("encrypted reasoning");
    // The preview keeps the raw argument text, valid JSON or not, without
    // parsing it into a resident object.
    expect(items[5]?.block).toMatchObject({
      type: "tool_use",
      toolName: "tool",
      text: "{}",
    });
    expect(items[6]?.block).toMatchObject({
      type: "tool_use",
      toolCallId: "short-id",
      text: "not json",
    });
    expect(items[7]?.block).toMatchObject({
      type: "tool_use",
      toolName: "scalar_tool",
      text: "42",
    });
    expect(session.events[8]?.label).toBe("tool_result call_123456");
    expect(items.slice(8, 11).map((item) => item.block?.type)).toEqual([
      "tool_result",
      "tool_result",
      "tool_result",
    ]);
    expect(
      items
        .slice(8, 11)
        .map((item) => (item.block?.type === "tool_result" ? item.block.status : undefined)),
    ).toEqual(["completed", "failed", "failed"]);
    expect(items[11]).not.toHaveProperty("block");
  });

  it.each([
    { name: "object isError true", output: { isError: true }, expected: "failed" },
    { name: "string isError true", output: '{"isError":true}', expected: "failed" },
    { name: "object isError false", output: { isError: false }, expected: "completed" },
    { name: "string isError false", output: '{"isError":false}', expected: "completed" },
    { name: "object success false", output: { success: false }, expected: "failed" },
    { name: "string success false", output: '{"success":false}', expected: "failed" },
    { name: "object success true", output: { success: true }, expected: "completed" },
    { name: "string success true", output: '{"success":true}', expected: "completed" },
    { name: "object top-level exit code 1", output: { exit_code: 1 }, expected: "failed" },
    { name: "string top-level exit code 1", output: '{"exit_code":1}', expected: "failed" },
    { name: "object top-level exit code 0", output: { exit_code: 0 }, expected: "completed" },
    { name: "string top-level exit code 0", output: '{"exit_code":0}', expected: "completed" },
    {
      name: "object metadata exit code 1",
      output: { metadata: { exit_code: 1 } },
      expected: "failed",
    },
    {
      name: "string metadata exit code 1",
      output: '{"metadata":{"exit_code":1}}',
      expected: "failed",
    },
    {
      name: "object metadata exit code 0",
      output: { metadata: { exit_code: 0 } },
      expected: "completed",
    },
    {
      name: "string metadata exit code 0",
      output: '{"metadata":{"exit_code":0}}',
      expected: "completed",
    },
    {
      name: "arrays do not carry structured failure evidence",
      output: [{ isError: true }],
      expected: "completed",
    },
    { name: "null output", output: null, expected: "pending" },
    { name: "non-JSON output", output: "error: command failed", expected: "completed" },
    {
      name: "non-finite exit code",
      output: { exit_code: Number.POSITIVE_INFINITY },
      expected: "completed",
    },
    { name: "string exit code", output: { exit_code: "1" }, expected: "completed" },
    {
      name: "conflicting structured evidence",
      output: { isError: true, success: true, exit_code: 0 },
      expected: "failed",
    },
    {
      name: "outer failed status wins over structured success",
      output: { isError: false, success: true, exit_code: 0 },
      outerStatus: "failed",
      expected: "failed",
    },
    {
      name: "outer failed status is preserved without output text",
      outerStatus: "failed",
      expected: "failed",
    },
  ])("normalizes $name as $expected", (testCase) => {
    const { outerStatus, expected } = testCase;
    const callId = "call-status";
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: { type: "function_call", name: "status_tool", call_id: callId },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: callId,
            ...("output" in testCase ? { output: testCase.output } : {}),
            ...(outerStatus ? { status: outerStatus } : {}),
          },
        },
        2,
      ),
    );

    const session = builder.finish([]);
    const model = createAgentSessionModel(session);
    const [call, result] = model.conversation.map(({ item }) => item);
    const evidence = session.events[1]?.trajectoryEvidence?.[0];

    expect(call).toBeDefined();
    expect(result).toBeDefined();
    expect(evidence).toMatchObject({
      kind: "tool-lifecycle",
      phase: "result",
      callId,
      conversationItemId: "conv-2-tool-result",
    });
    expect(evidence).not.toHaveProperty("output");
    expect(model.resolveToolStatus(call!)).toBe(expected);
    expect(model.resolveToolStatus(result!)).toBe(expected);
    if (result?.block?.type === "tool_result") {
      expect(evidence).toMatchObject({ status: result.block.status });
    } else {
      expect(evidence).not.toHaveProperty("status");
    }
    if (expected === "pending") {
      expect(result?.block).toBeUndefined();
    } else {
      expect(result?.block).toMatchObject({ type: "tool_result", status: expected });
    }
  });

  it("keeps an explicitly completed empty tool result in trajectory evidence", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-completed-empty" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "empty_result",
            call_id: "call-completed-empty",
          },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-completed-empty",
            output: "",
            status: "completed",
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.conversationItems[0]?.block).toBeUndefined();
    expect(session.events[2]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-completed-empty",
        status: "completed",
        callId: "call-completed-empty",
        conversationItemId: "conv-3-tool-result",
      },
    ]);
  });

  it("reuses normalized tool status without parsing output again", () => {
    const parse = vi.spyOn(JSON, "parse");
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-normalized-result" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-normalized-result",
            output: '{"isError":true}',
          },
        },
        2,
      ),
    );

    const session = builder.finish([]);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(session.events[1]?.trajectoryEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-normalized-result",
        status: "failed",
        callId: "call-normalized-result",
        conversationItemId: "conv-2-tool-result",
      },
    ]);
  });

  it("previews a large tool payload without parsing or retaining it", () => {
    const parse = vi.spyOn(JSON, "parse");
    const args = JSON.stringify({ values: Array.from({ length: 20_000 }, (_, index) => index) });
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "bulk_tool",
            call_id: "call_bulk",
            arguments: args,
          },
        },
        1,
      ),
    );

    const session = builder.finish([]);
    const block = conversationItems(session)[0]?.block;

    expect(parse).not.toHaveBeenCalled();
    expect(block).toMatchObject({
      type: "tool_use",
      toolName: "bulk_tool",
      toolCallId: "call_bulk",
    });
    expect(block).not.toHaveProperty("toolInput");
    expect(block?.text.startsWith(args.slice(0, 64))).toBe(true);
    expect(block?.text.length).toBeLessThan(args.length);
    // The canonical record still carries the untouched payload.
    expect(session.events[0]?.lineNumber).toBe(1);
  });
});
