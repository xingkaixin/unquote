import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel, createAgentTrajectoryModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { parsedLine, trajectoryTurnId } from "./codex-adapter.support";

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter: supplemental-events", () => {
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
});
