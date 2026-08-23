import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import { parsedLine, conversationItems } from "./codex-adapter.support";

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter: response-items", () => {
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
      text: "{}",
    });
    expect(items[6]?.block).toMatchObject({
      type: "tool_use",
      text: "not json",
    });
    expect(items[7]?.block).toMatchObject({
      type: "tool_use",
      text: "42",
    });
    expect(session.events[8]?.label).toBe("tool_result call_123456");
    expect(items.slice(8, 11).map((item) => item.block?.type)).toEqual([
      "tool_result",
      "tool_result",
      "tool_result",
    ]);
    expect(
      session.events
        .slice(8, 11)
        .map((event) => event?.sessionEvidence?.[0])
        .map((evidence) =>
          evidence?.kind === "tool-lifecycle" && evidence.phase === "result"
            ? evidence.status
            : undefined,
        ),
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
    const evidence = session.events[1]?.sessionEvidence?.[0];

    expect(call).toBeDefined();
    expect(result).toBeDefined();
    expect(evidence).toMatchObject({
      kind: "tool-lifecycle",
      phase: "result",
      callId,
      conversationItem: expect.objectContaining({ id: "conv-2-tool-result" }),
    });
    expect(evidence).not.toHaveProperty("output");
    expect(model.resolveToolStatus(call!)).toBe(expected);
    expect(model.resolveToolStatus(result!)).toBe(expected);
    if (result?.block?.type !== "tool_result") {
      expect(evidence).not.toHaveProperty("status");
    }
    if (expected === "pending") {
      expect(result?.block).toBeUndefined();
    } else {
      expect(result?.block).toMatchObject({ type: "tool_result" });
    }
  });

  it("keeps an explicitly completed empty tool result in session evidence", () => {
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
    expect(session.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-completed-empty",
        status: "completed",
        callId: "call-completed-empty",
        conversationItem: expect.objectContaining({ id: "conv-3-tool-result" }),
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
    expect(session.events[1]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "result",
        turnId: "turn-normalized-result",
        status: "failed",
        callId: "call-normalized-result",
        conversationItem: expect.objectContaining({ id: "conv-2-tool-result" }),
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
    });
    expect(session.events[0]?.sessionEvidence).toContainEqual(
      expect.objectContaining({
        kind: "tool-lifecycle",
        phase: "call",
        toolName: "bulk_tool",
        callId: "call_bulk",
      }),
    );
    expect(block).not.toHaveProperty("toolInput");
    expect(block?.text.startsWith(args.slice(0, 64))).toBe(true);
    expect(block?.text.length).toBeLessThan(args.length);
    // The canonical record still carries the untouched payload.
    expect(session.events[0]?.lineNumber).toBe(1);
  });

  it("projects developer and system messages as system trajectory activity", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "turn_context",
          timestamp: 10,
          payload: { turn_id: "turn-system" },
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
            role: "developer",
            content: [{ type: "input_text", text: "Developer instructions" }],
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
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: "System instructions" }],
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
            role: "other",
            content: [{ type: "input_text", text: "Unrecognized role" }],
          },
        },
        4,
      ),
    );

    const session = builder.finish([]);
    const model = createAgentSessionModel(session);
    const presentation = createAgentTrajectoryPresentation(model);

    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "system",
      "system",
      "unknown",
    ]);
    expect(model.conversation.slice(0, 2).map(({ item }) => item.role)).toEqual([
      "system",
      "system",
    ]);
    expect(session.events.slice(1, 3).map((event) => event.sessionEvidence)).toEqual([
      [
        {
          kind: "model-output",
          role: "system",
          turnId: "turn-system",
          conversationItem: expect.objectContaining({ id: "conv-2-system" }),
        },
      ],
      [
        {
          kind: "model-output",
          role: "system",
          turnId: "turn-system",
          conversationItem: expect.objectContaining({ id: "conv-3-system" }),
        },
      ],
    ]);
    expect(session.events[3]?.sessionEvidence).toBeUndefined();
    expect(model.trajectory.items).toMatchObject([
      {
        kind: "system",
        status: "completed",
        recordId: "record-2",
        selection: { kind: "conversation", id: "conv-2-system", recordId: "record-2" },
      },
      {
        kind: "system",
        status: "completed",
        recordId: "record-3",
        selection: { kind: "conversation", id: "conv-3-system", recordId: "record-3" },
      },
    ]);
    expect(presentation.items.map(({ item, lane }) => ({ kind: item.kind, lane }))).toEqual([
      { kind: "system", lane: "activity" },
      { kind: "system", lane: "activity" },
    ]);
  });
});
