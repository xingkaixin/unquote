import { describe, expect, it } from "vitest";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const parsedLine = (data: unknown, lineNumber: number): ParsedAgentLine => ({
  data,
  lineNumber,
  raw: JSON.stringify(data),
});

const transcriptLine = (lineNumber: number): ParsedAgentLine =>
  parsedLine(
    {
      type: lineNumber % 2 === 0 ? "assistant" : "user",
      uuid: `uuid-${lineNumber}`,
      message: { content: "message" },
    },
    lineNumber,
  );

describe("claudeTranscriptAdapter", () => {
  it("scores transcript and metadata evidence", () => {
    expect(claudeTranscriptAdapter.detect([])).toBe(0);
    expect(claudeTranscriptAdapter.detect([parsedLine(null, 1), transcriptLine(2)])).toBe(0);
    expect(
      claudeTranscriptAdapter.detect([
        transcriptLine(1),
        parsedLine({ type: "mode", sessionId: "session" }, 2),
      ]),
    ).toBe(0.6);
    expect(claudeTranscriptAdapter.detect([transcriptLine(1), transcriptLine(2)])).toBe(0.75);
    expect(
      claudeTranscriptAdapter.detect(Array.from({ length: 20 }, (_, i) => transcriptLine(i))),
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
                tool_use_id: "toolu_12345678901234567890",
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

    const session = builder.finish([{ lineNumber: 9, message: "Invalid JSON on this line" }]);

    expect(session).toMatchObject({
      fileType: "Claude Code",
      fileName: "session.jsonl",
      meta: {
        sessionId: "session",
        cwd: "/repo",
        version: "1.0.0",
        eventCount: 7,
        turnCount: 2,
      },
    });
    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "user",
      "user",
      "user",
      "user",
      "tool",
      "tool",
    ]);
    expect(session.events[0]?.preview).toBe("system message");
    expect(session.events[1]).toMatchObject({
      requestId: "request-1",
      role: "user",
      stopReason: "end_turn",
    });
    expect(session.conversationItems.map((item) => item.role)).toEqual([
      "user",
      "user",
      "user",
      "tool_result",
      "tool_result",
    ]);
    expect(session.conversationItems[1]?.block?.text).toContain("More context");
    expect(session.conversationItems[2]).not.toHaveProperty("block");
    expect(session.conversationItems[3]?.block).toMatchObject({
      status: "failed",
      toolCallId: "toolu_12345678901234567890",
    });
    expect(session.conversationItems[4]).not.toHaveProperty("block");
    expect(session.events[5]?.label).toBe("tool_result toolu_123456");
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
      usage: {
        inputTokens: 5,
        outputTokens: 0,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 0,
      },
    });
    expect(session.conversationItems.map((item) => item.role)).toEqual([
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
    expect(session.conversationItems[5]?.block?.toolInput).toEqual({});
  });
});
