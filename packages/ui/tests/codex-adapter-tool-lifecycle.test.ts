import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel, createAgentTrajectoryModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { parsedLine } from "./codex-adapter.support";

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter: tool-lifecycle", () => {
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

    expect(session.events[2]?.sessionEvidence).toEqual([
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

    expect(session.events[1]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "call",
        turnId: "turn-custom",
        toolName: "apply_patch",
        callId: "call-custom",
        conversationItemId: "conv-2-tool-call",
      },
    ]);
    expect(session.events[2]?.sessionEvidence).toEqual([
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
    const evidence = session.events[2]?.sessionEvidence?.[0];

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

    expect(source.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-17106",
        callId: "call-17106",
        status: "failed",
        durationMs: 1250,
      },
    ]);
    expect(trajectory.items.filter((item) => item.kind === "tool")).toHaveLength(1);
    expect(
      trajectory.items.filter((item) => item.kind === "tool" && item.status === "failed"),
    ).toHaveLength(1);
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
        sessionEvidence: [
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

  it("projects exec_command_end with a structured duration as a timed completion", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          timestamp: 10,
          payload: { type: "task_started", turn_id: "turn-exec" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 20,
          payload: { type: "function_call", name: "shell", call_id: "call-exec" },
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
            type: "exec_command_end",
            call_id: "call-exec",
            status: "completed",
            exit_code: 0,
            duration: { secs: 1, nanos: 250_000_000 },
          },
        },
        3,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.category).toBe("tool");
    expect(session.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-exec",
        callId: "call-exec",
        status: "completed",
        durationMs: 1250,
      },
    ]);

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.items).toMatchObject([
      { kind: "tool", status: "completed", callId: "call-exec", durationMs: 1250 },
    ]);
  });

  it("marks exec_command_end with a non-zero exit code as failed", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-exec-failed" },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            call_id: "call-exec-failed",
            status: "failed",
            exit_code: 1,
            duration: { secs: 0, nanos: 13_208 },
          },
        },
        2,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[1]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-exec-failed",
        callId: "call-exec-failed",
        status: "failed",
        durationMs: 0,
      },
    ]);
  });

  it("treats a bare zero exit code as a completed exec completion", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "event_msg",
          payload: { type: "exec_command_end", call_id: "call-exec-exit", exit_code: 0 },
        },
        1,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[0]?.sessionEvidence?.[0]).toMatchObject({
      kind: "tool-lifecycle",
      phase: "completion",
      callId: "call-exec-exit",
      status: "completed",
    });
  });

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

    const evidence = builder.finish([]).events[1]?.sessionEvidence?.[0];

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

    const evidence = builder.finish([]).events[1]?.sessionEvidence?.[0];

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

    expect(builder.finish([]).events[1]?.sessionEvidence).toEqual([
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
});
