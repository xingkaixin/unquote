import { describe, expect, it } from "vitest";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import {
  conversationItems,
  parsedLine,
  detectionSample,
  transcriptSample,
} from "./claude-adapter.support";

describe("claudeTranscriptAdapter: detection-and-normalization", () => {
  it("scores transcript and metadata evidence", () => {
    expect(claudeTranscriptAdapter.detect([])).toBe(0);
    expect(claudeTranscriptAdapter.detect([detectionSample(), transcriptSample(2)])).toBe(0);
    expect(
      claudeTranscriptAdapter.detect([
        transcriptSample(1),
        detectionSample({ type: "mode", hasSessionId: true }),
      ]),
    ).toBe(0.6);
    expect(claudeTranscriptAdapter.detect([transcriptSample(1), transcriptSample(2)])).toBe(0.75);
    expect(
      claudeTranscriptAdapter.detect(Array.from({ length: 20 }, (_, i) => transcriptSample(i))),
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
                tool_use_id: "toolu_12345😀tail",
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

    const session = builder.finish([{ kind: "invalid-json", recordId: "record-9", lineNumber: 9 }]);

    expect(session).toMatchObject({
      fileType: "Claude Code",
      fileName: "session.jsonl",
      meta: {
        sessionId: "session",
        cwd: "/repo",
        version: "1.0.0",
        turnCount: 2,
      },
    });
    expect(session.meta).not.toHaveProperty("eventCount");
    expect(session.events.map((event) => event.category)).toEqual([
      "meta",
      "user",
      "tool",
      "user",
      "user",
      "tool",
      "tool",
    ]);
    expect(session.events[0]?.preview).toBe("system message");
    // The system line precedes the first prompt, so it belongs to no turn.
    expect(session.events[0]).not.toHaveProperty("turnIndex");
    expect(session.events[1]).toMatchObject({ turnIndex: 1 });
    const items = conversationItems(session);
    expect(items.map((item) => item.role)).toEqual([
      "user",
      "user",
      "tool_result",
      "user",
      "tool_result",
      "tool_result",
    ]);
    expect(items[1]?.block).toEqual({ type: "text", text: "More context" });
    expect(items[2]?.block).toEqual({ type: "tool_result", text: '{\n  "ok": true\n}' });
    expect(items[3]).not.toHaveProperty("block");
    expect(items[4]?.block).toMatchObject({
      type: "tool_result",
    });
    expect(items[5]?.block).toEqual({ type: "tool_result", text: "" });
    expect(session.events[2]?.sessionEvidence).toContainEqual(
      expect.objectContaining({ kind: "tool-lifecycle", phase: "result", status: "completed" }),
    );
    expect(session.events[5]?.sessionEvidence).toContainEqual(
      expect.objectContaining({
        kind: "tool-lifecycle",
        phase: "result",
        status: "failed",
        callId: "toolu_12345😀tail",
      }),
    );
    expect(session.events[2]?.label).toBe("tool_result (2 blocks)");
    expect(session.events[5]?.label).toBe("tool_result toolu_12345");
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
    });
    const items = conversationItems(session);
    expect(items.map((item) => item.role)).toEqual([
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
    expect(items[5]?.block).toMatchObject({
      type: "tool_use",
      text: "{}",
    });
    expect(session.events[5]?.sessionEvidence).toContainEqual(
      expect.objectContaining({
        kind: "tool-lifecycle",
        phase: "call",
        toolName: "Bash",
      }),
    );
  });

  it("normalizes each event's content exactly once", () => {
    let inputReads = 0;
    const toolInput = (key: string, value: string) =>
      Object.defineProperty({}, key, {
        enumerable: true,
        get() {
          inputReads += 1;
          return value;
        },
      });
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Bash",
                input: toolInput("command", "ls"),
              },
            ],
          },
        },
        1,
      ),
    );
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-2",
                name: "Read",
                input: toolInput("path", "/tmp"),
              },
            ],
          },
        },
        2,
      ),
    );
    builder.finish([]);

    expect(inputReads).toBe(2);
  });

  it("bounds deeply nested tool input without failing the event", () => {
    let input: unknown = "leaf";
    for (let depth = 0; depth < 7_000; depth += 1) {
      input = [input];
    }
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(
      parsedLine(
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: "tool-1", name: "Deep", input }],
          },
        },
        1,
      ),
    );

    const session = builder.finish([]);
    const block = conversationItems(session)[0]?.block;

    expect(block?.text).toMatch(/\.\.\. \[truncated\]$/);
    expect(session.events[0]?.label).toBe("tool_use Deep");
  });

  it("projects a string message body the same way as a single text block", () => {
    const builder = claudeTranscriptAdapter.createBuilder();
    builder.push(parsedLine({ type: "assistant", message: { content: "Plain reply" } }, 1));

    const session = builder.finish([]);

    expect(session.events[0]).toMatchObject({ label: "text", preview: "Plain reply" });
    expect(conversationItems(session)[0]?.block).toEqual({ type: "text", text: "Plain reply" });
  });
});
