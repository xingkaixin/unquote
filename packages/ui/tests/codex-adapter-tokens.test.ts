import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionModel, createAgentTrajectoryModel } from "../src/lib/agent-session";
import { codexRolloutAdapter } from "../src/lib/agent-session/codex-adapter";
import { parsedLine } from "./codex-adapter.support";

afterEach(() => vi.restoreAllMocks());

describe("codexRolloutAdapter: tokens", () => {
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

    expect(session.events.slice(1).map((event) => event.sessionEvidence)).toEqual([
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
    expect(source.events[2]?.sessionEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-nested-tokens",
        usage: { inputTokens: 100, outputTokens: 10 },
        cumulativeUsage: { inputTokens: 100, outputTokens: 10 },
      },
    ]);
    expect(source.events[4]?.sessionEvidence).toEqual([
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

    expect(source.events[2]?.sessionEvidence).toEqual([
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

    expect(source.events[1]?.sessionEvidence).toEqual([
      {
        kind: "token-usage",
        turnId: "turn-invalid-tokens",
        usage: { outputTokens: 3 },
        cumulativeUsage: { cacheReadInputTokens: 5 },
      },
    ]);
    expect(trajectory.stats.tokenUsage).toEqual({ outputTokens: 3, cacheReadInputTokens: 5 });
  });
});
