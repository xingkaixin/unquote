import { describe, expect, it } from "vitest";
import { createAgentSessionModel, createAgentTrajectoryModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import { parsedLine } from "./codex-adapter.support";

const pairingWarningKinds = [
  "duplicate-tool-call-id",
  "duplicate-tool-result-id",
  "duplicate-tool-completion-id",
  "unpaired-tool-call",
  "unpaired-tool-result",
  "unpaired-tool-completion",
];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Fixtures model raw Codex item payloads.
const itemCompleted = (item: unknown, startedAtMs: number, completedAtMs: number) => ({
  type: "event_msg",
  timestamp: completedAtMs,
  payload: {
    type: "item_completed",
    turn_id: "turn-items",
    item,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
  },
});

const turnStarted = {
  type: "event_msg",
  timestamp: 10,
  payload: { type: "task_started", turn_id: "turn-items" },
};

describe("codexRolloutAdapter: item_completed", () => {
  it("pairs an item with the direct function call that shares its id", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(parsedLine(turnStarted, 1));
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 100,
          payload: { type: "function_call", name: "exec_command", call_id: "call-direct" },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        itemCompleted(
          {
            type: "CommandExecution",
            id: "call-direct",
            command: ["sh", "-c", "false"],
            status: "failed",
            exit_code: 2,
            duration: { secs: 1, nanos: 500_000_000 },
          },
          120,
          1_620,
        ),
        3,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 1_700,
          payload: { type: "function_call_output", call_id: "call-direct", output: "exit 2" },
        },
        4,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]).toMatchObject({ category: "tool", preview: "sh -c false" });
    expect(session.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-lifecycle",
        phase: "completion",
        turnId: "turn-items",
        status: "failed",
        callId: "call-direct",
        durationMs: 1_500,
      },
    ]);

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.items).toEqual([
      expect.objectContaining({
        kind: "tool",
        status: "failed",
        toolName: "exec_command",
        callId: "call-direct",
        durationMs: 1_500,
        completionSelection: { kind: "event", id: "line-3", recordId: "record-3" },
      }),
    ]);
    expect(
      trajectory.warnings.filter((warning) => pairingWarningKinds.includes(warning.kind)),
    ).toEqual([]);
  });

  it("projects items started inside a code-mode call as their own executions", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(parsedLine(turnStarted, 1));
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 100,
          payload: { type: "custom_tool_call", name: "exec", call_id: "call-script", input: "" },
        },
        2,
      ),
    );
    builder.push(
      parsedLine(
        itemCompleted(
          {
            type: "CommandExecution",
            id: "exec-command",
            command: ["sh", "-c", "false"],
            status: "failed",
            exit_code: 2,
            duration: { secs: 0, nanos: 300_000_000 },
          },
          200,
          500,
        ),
        3,
      ),
    );
    builder.push(
      parsedLine(
        itemCompleted(
          {
            type: "McpToolCall",
            id: "exec-mcp",
            server: "server",
            tool: "lookup",
            status: "completed",
            result: { isError: true },
          },
          600,
          900,
        ),
        4,
      ),
    );
    builder.push(
      parsedLine(
        itemCompleted({ type: "ImageView", id: "exec-image", path: "image.png" }, 950, 960),
        5,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "response_item",
          timestamp: 1_000,
          payload: { type: "custom_tool_call_output", call_id: "call-script", output: "done" },
        },
        6,
      ),
    );

    const session = builder.finish([]);

    expect(session.events[2]?.sessionEvidence).toEqual([
      {
        kind: "tool-execution",
        turnId: "turn-items",
        toolName: "CommandExecution",
        status: "failed",
        startedAt: 200,
        endedAt: 500,
        durationMs: 300,
      },
    ]);
    expect(session.events[3]?.sessionEvidence).toEqual([
      {
        kind: "tool-execution",
        turnId: "turn-items",
        toolName: "lookup",
        status: "failed",
        startedAt: 600,
        endedAt: 900,
        durationMs: 300,
      },
    ]);

    const trajectory = createAgentTrajectoryModel(session);
    expect(trajectory.items).toEqual([
      expect.objectContaining({ kind: "tool", status: "completed", callId: "call-script" }),
      expect.objectContaining({
        kind: "tool",
        status: "failed",
        toolName: "CommandExecution",
        startedAt: 200,
        endedAt: 500,
        durationMs: 300,
        selection: { kind: "event", id: "line-3", recordId: "record-3" },
      }),
      expect.objectContaining({ kind: "tool", status: "failed", toolName: "lookup" }),
      expect.objectContaining({
        kind: "tool",
        status: "completed",
        toolName: "ImageView",
        durationMs: 10,
      }),
    ]);
    expect(
      trajectory.warnings.filter((warning) => pairingWarningKinds.includes(warning.kind)),
    ).toEqual([]);

    const presentation = createAgentTrajectoryPresentation(createAgentSessionModel(session));
    expect(presentation.summary).toMatchObject({ tools: 4, failures: 2 });
    expect(presentation.items[1]).toMatchObject({
      summary: "sh -c false",
      interval: { start: 200, end: 500 },
    });
  });

  it("leaves non-tool items without session evidence", () => {
    const builder = codexRolloutAdapter.createBuilder();
    builder.push(parsedLine(turnStarted, 1));
    builder.push(parsedLine(itemCompleted({ type: "Reasoning", id: "reasoning" }, 20, 30), 2));

    const session = builder.finish([]);

    expect(session.events[1]).toMatchObject({ category: "unknown", kind: "item_completed" });
    expect(session.events[1]).not.toHaveProperty("sessionEvidence");
  });
});
