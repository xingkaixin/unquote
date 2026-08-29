import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel, createAgentTrajectoryModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { parsedLine, detectionSample, trajectoryTurnId } from "./codex-adapter.support";

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter: detection-and-evidence", () => {
  it("scores only recognized Codex envelopes with record payloads", () => {
    expect(codexRolloutAdapter.detect([])).toBe(0);
    expect(
      codexRolloutAdapter.detect([
        detectionSample(undefined),
        detectionSample("session_meta"),
        detectionSample("session_meta", true),
      ]),
    ).toBe(1 / 3);
  });

  it("recognizes compacted Codex envelopes", () => {
    expect(codexRolloutAdapter.detect([detectionSample("compacted", true)])).toBe(1);
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

    const warning = { kind: "invalid-json" as const, recordId: "record-13", lineNumber: 13 };
    const session = builder.finish([warning]);

    expect(session.meta).toMatchObject({
      sessionId: "legacy-session",
      cwd: "/repo",
      version: "1.0.0",
      model: "gpt-test",
    });
    const model = createAgentSessionModel(session);
    expect(model.turnCount).toBe(1);
    expect(model.trajectory.turns).toHaveLength(model.turnCount);
    expect(session.meta).not.toHaveProperty("eventCount");
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
    expect(session.parseWarnings).toEqual([warning]);
  });

  it("projects verified Codex facts as session evidence", () => {
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
      session.events.map(({ lineNumber, recordId, timestamp, turnIndex, sessionEvidence }) => ({
        lineNumber,
        recordId,
        timestamp,
        turnIndex,
        sessionEvidence,
      })),
    ).toEqual([
      {
        lineNumber: 1,
        recordId: "record-1",
        timestamp: 100,
        turnIndex: 1,
        sessionEvidence: undefined,
      },
      {
        lineNumber: 2,
        recordId: "record-2",
        timestamp: 110,
        turnIndex: 1,
        sessionEvidence: [{ kind: "turn-lifecycle", phase: "start", turnId: "turn-alpha" }],
      },
      {
        lineNumber: 3,
        recordId: "record-3",
        timestamp: 120,
        turnIndex: 1,
        sessionEvidence: [
          {
            kind: "model-output",
            role: "user",
            turnId: "turn-alpha",
            conversationItem: expect.objectContaining({ id: "conv-3-user" }),
          },
        ],
      },
      {
        lineNumber: 4,
        recordId: "record-4",
        timestamp: 130,
        turnIndex: 1,
        sessionEvidence: [
          {
            kind: "model-output",
            role: "reasoning",
            turnId: "turn-alpha",
            conversationItem: expect.objectContaining({ id: "conv-4-thinking" }),
          },
        ],
      },
      {
        lineNumber: 5,
        recordId: "record-5",
        timestamp: 140,
        turnIndex: 1,
        sessionEvidence: [
          {
            kind: "model-output",
            role: "assistant",
            turnId: "turn-alpha",
            conversationItem: expect.objectContaining({ id: "conv-5-assistant" }),
          },
        ],
      },
      {
        lineNumber: 6,
        recordId: "record-6",
        timestamp: 150,
        turnIndex: 1,
        sessionEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "call",
            turnId: "turn-alpha",
            toolName: "read_file",
            callId: "call-alpha",
            conversationItem: expect.objectContaining({ id: "conv-6-tool-call" }),
          },
        ],
      },
      {
        lineNumber: 7,
        recordId: "record-7",
        timestamp: 170,
        turnIndex: 1,
        sessionEvidence: [
          {
            kind: "tool-lifecycle",
            phase: "result",
            turnId: "turn-alpha",
            status: "completed",
            callId: "call-alpha",
            conversationItem: expect.objectContaining({ id: "conv-7-tool-result" }),
          },
        ],
      },
      {
        lineNumber: 8,
        recordId: "record-8",
        timestamp: 180,
        turnIndex: 1,
        sessionEvidence: [
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
        sessionEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-alpha" }],
      },
    ]);

    for (const event of session.events) {
      for (const evidence of event.sessionEvidence ?? []) {
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
      sessionEvidence: [{ kind: "token-usage", turnId: "turn-old", usage: { inputTokens: 3 } }],
    });
    expect(session.events[5]).toMatchObject({
      turnIndex: 1,
      sessionEvidence: [{ kind: "turn-lifecycle", phase: "complete", turnId: "turn-old" }],
    });

    const model = createAgentTrajectoryModel(session);
    expect(model.turns).toMatchObject([
      { id: trajectoryTurnId("turn-old"), status: "completed", turnIndex: 1, durationMs: 50 },
      { id: trajectoryTurnId("turn-new"), status: "running", turnIndex: 2 },
    ]);
    expect(model.items.filter((item) => item.turnId === model.turns[0]?.id)).toMatchObject([
      { tokenUsage: { inputTokens: 3 } },
    ]);
  });
});
