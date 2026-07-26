import { describe, expect, it } from "vitest";
import { createAgentSessionModel, type AgentSession } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
});

const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

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
    expect(session.events[0]).toMatchObject({ timestamp: 100, turnIndex: 1 });
    expect(session.events[1]).not.toHaveProperty("timestamp");
    expect(session.parseWarnings).toEqual([
      { lineNumber: 13, message: "Invalid JSON on this line" },
    ]);
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
        call_id: "call_12345678901234567890",
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
    expect(items[5]?.block).toMatchObject({
      toolName: "tool",
      toolInput: {},
      status: "pending",
    });
    expect(items[6]?.block).toMatchObject({
      toolCallId: "short-id",
      toolInput: { raw: "not json" },
    });
    expect(items[7]?.block?.toolInput).toEqual({ raw: "42" });
    expect(session.events[8]?.label).toBe("tool_result call_1234567");
    expect(items.slice(8, 11).map((item) => item.block?.status)).toEqual([
      "completed",
      "failed",
      "failed",
    ]);
    expect(items[11]).not.toHaveProperty("block");
  });
});
