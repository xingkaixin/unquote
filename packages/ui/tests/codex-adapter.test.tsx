import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel, type AgentSession } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  recordId: `record-${lineNumber}`,
});

const conversationItems = (session: AgentSession) =>
  createAgentSessionModel(session).conversation.map(({ item }) => item);

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

    const model = createAgentSessionModel(builder.finish([]));
    const [call, result] = model.conversation.map(({ item }) => item);

    expect(call).toBeDefined();
    expect(result).toBeDefined();
    expect(model.resolveToolStatus(call!)).toBe(expected);
    expect(model.resolveToolStatus(result!)).toBe(expected);
    if (expected === "pending") {
      expect(result?.block).toBeUndefined();
    } else {
      expect(result?.block).toMatchObject({ type: "tool_result", status: expected });
    }
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
