import { describe, expect, it } from "vitest";
import { createAgentSessionFromText, createAgentSessionTracker } from "../src/lib/agent-session";
import type { ParsedAgentLine } from "../src/lib/agent-session";

const line = (data: Record<string, unknown>, lineNumber = 1): ParsedAgentLine => ({
  lineNumber,
  raw: JSON.stringify(data),
  data,
});

const codexEvent = (type = "token_count") =>
  JSON.stringify({ type: "event_msg", payload: { type } });

const unrelatedEvent = (index: number) => JSON.stringify({ event: "worker.tick", index });

describe("createAgentSessionTracker", () => {
  it("preserves streamed line metadata and parse warnings", () => {
    const tracker = createAgentSessionTracker("stream.jsonl");
    const sessionMeta = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "stream-session" },
    });

    tracker.pushRawLine("", 1);
    tracker.pushRawLine("{bad}", 2);
    tracker.pushRawLine(sessionMeta, 4);

    expect(tracker.finish()).toMatchObject({
      fileType: "Codex",
      fileName: "stream.jsonl",
      meta: { sessionId: "stream-session", eventCount: 1 },
      events: [{ lineNumber: 4, rawLine: sessionMeta }],
      parseWarnings: [{ lineNumber: 2, message: "Invalid JSON on this line" }],
    });
  });

  it("locks in confident detection after twenty samples", () => {
    const tracker = createAgentSessionTracker();

    for (let index = 1; index <= 5; index += 1) {
      tracker.pushRawLine(unrelatedEvent(index), index);
    }
    for (let index = 6; index <= 20; index += 1) {
      tracker.pushRawLine(codexEvent(), index);
    }
    for (let index = 21; index <= 80; index += 1) {
      tracker.pushRawLine(unrelatedEvent(index), index);
    }
    tracker.pushRawLine(codexEvent("task_complete"), 81);

    const session = tracker.finish();
    expect(session?.fileType).toBe("Codex");
    expect(session?.meta.eventCount).toBe(16);
    expect(session?.events.at(-1)).toMatchObject({ lineNumber: 81, kind: "task_complete" });
  });

  it("disables detection after eighty inconclusive samples", () => {
    const tracker = createAgentSessionTracker();

    for (let index = 1; index < 80; index += 1) {
      tracker.pushRawLine(unrelatedEvent(index), index);
    }
    tracker.pushRawLine(codexEvent(), 80);
    for (let index = 81; index <= 160; index += 1) {
      tracker.pushRawLine(codexEvent(), index);
    }

    expect(tracker.finish()).toBeNull();
  });
});

describe("agent session", () => {
  it("detects and parses Codex rollout logs", () => {
    const callId = "call_rdg6jvibCi1HZNzPAIISkZC9";
    const session = createAgentSessionFromText(
      [
        JSON.stringify({
          timestamp: "2026-06-06T13:44:06.579Z",
          type: "session_meta",
          payload: {
            session_id: "session-from-newer-codex",
            id: "legacy-id",
            cwd: "/repo",
            cli_version: "0.137.0",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:06.581Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-1" },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:07.964Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Archive tracked files only" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:12.824Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            summary: [{ text: "Assess archive risk." }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:13.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "rg --files" }),
            call_id: callId,
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:13.100Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: callId,
            output: "file.txt\n",
          },
        }),
      ].join("\n"),
      "rollout.jsonl",
    );

    expect(session).toMatchObject({
      fileType: "Codex",
      fileName: "rollout.jsonl",
      meta: {
        sessionId: "session-from-newer-codex",
        cwd: "/repo",
        version: "0.137.0",
        eventCount: 6,
        turnCount: 1,
      },
    });
    expect(session?.conversationItems.map((item) => item.role)).toEqual([
      "user",
      "thinking",
      "tool_call",
      "tool_result",
    ]);
    expect(session?.events[4]?.rawLine).toContain(`"call_id":"${callId}"`);
    expect(session?.conversationItems[2]?.block).toMatchObject({
      toolName: "exec_command",
      toolCallId: callId,
      status: "pending",
    });
    expect(session?.conversationItems[3]?.block).toMatchObject({
      toolCallId: callId,
      status: "completed",
    });
  });

  it("detects Claude Code logs with leading metadata events", () => {
    const samples = [
      line({ type: "mode", mode: "default", sessionId: "claude-session" }),
      line({ type: "permission-mode", mode: "acceptEdits", sessionId: "claude-session" }, 2),
      line({ type: "attachment", sessionId: "claude-session" }, 3),
      line(
        {
          type: "user",
          uuid: "user-1",
          sessionId: "claude-session",
          promptId: "prompt-1",
          message: { role: "user", content: "Run it" },
          timestamp: "2026-06-01T10:00:00Z",
        },
        4,
      ),
      line(
        {
          type: "assistant",
          uuid: "assistant-1",
          requestId: "req_123",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              { type: "thinking", thinking: "Need a command." },
              {
                type: "tool_use",
                id: "toolu_123",
                name: "Bash",
                input: { command: "pwd" },
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_creation_input_tokens: 3,
              cache_read_input_tokens: 4,
            },
          },
          timestamp: "2026-06-01T10:00:01Z",
        },
        5,
      ),
    ];

    const session = createAgentSessionFromText(samples.map((sample) => sample.raw).join("\n"));
    expect(session).toMatchObject({
      fileType: "Claude Code",
      meta: {
        sessionId: "claude-session",
        model: "claude-sonnet-4-5",
        eventCount: 5,
        turnCount: 1,
      },
    });
    expect(session?.conversationItems.map((item) => item.role)).toEqual([
      "user",
      "thinking",
      "tool_call",
    ]);
    expect(session?.events[4]?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
    });
  });

  it("links Claude tool results to tool calls", () => {
    const session = createAgentSessionFromText(
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          promptId: "prompt-1",
          message: { role: "user", content: "Run it" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_123", name: "Bash", input: { command: "ls" } },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "user-2",
          promptId: "prompt-1",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: "file.txt",
                is_error: false,
              },
            ],
          },
        }),
      ].join("\n"),
    );

    const toolCall = session?.conversationItems.find((item) => item.role === "tool_call");
    const toolResult = session?.conversationItems.find((item) => item.role === "tool_result");
    expect(toolCall?.block?.toolCallId).toBe("toolu_123");
    expect(toolResult?.block).toMatchObject({
      toolCallId: "toolu_123",
      status: "completed",
      text: "file.txt",
    });
  });

  it("returns null for unrelated JSONL", () => {
    const session = createAgentSessionFromText(
      [
        JSON.stringify({ event: "webhook.received", payload: { id: "evt_1" } }),
        JSON.stringify({ event: "worker.done", ok: true }),
      ].join("\n"),
    );

    expect(session).toBeNull();
  });
});
