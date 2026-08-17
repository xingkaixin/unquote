import { describe, expect, it } from "vitest";
import { parseJson } from "@unquote/core";
import { createAgentSessionModel, createAgentSessionTracker } from "../src/lib/agent-session";
import type { AgentSession, ParsedAgentLine } from "../src/lib/agent-session";

const line = (
  data: Record<string, unknown>,
  lineNumber = 1,
  recordId = `record-${lineNumber}`,
): ParsedAgentLine => ({
  lineNumber,
  recordId,
  data,
});

const codexEvent = (type = "token_count") =>
  JSON.stringify({ type: "event_msg", payload: { type } });

const unrelatedEvent = (index: number) => JSON.stringify({ event: "worker.tick", index });

const pushRawLine = (
  tracker: ReturnType<typeof createAgentSessionTracker>,
  raw: string,
  lineNumber: number,
) => {
  if (!raw.trim()) {
    return;
  }
  try {
    tracker.pushParsedLine({
      lineNumber,
      recordId: `record-${lineNumber}`,
      data: parseJson(raw, { numbers: "approximate" }),
    });
  } catch {
    tracker.pushParseWarning(lineNumber);
  }
};

const createAgentSessionFromText = (text: string, fileName?: string) => {
  const tracker = createAgentSessionTracker(fileName);
  text.split(/\r?\n/).forEach((raw, index) => pushRawLine(tracker, raw, index + 1));
  return tracker.finish();
};

const conversationItems = (session: AgentSession | null | undefined) =>
  session ? createAgentSessionModel(session).conversation.map(({ item }) => item) : [];

describe("createAgentSessionTracker", () => {
  it("preserves streamed line metadata and parse warnings", () => {
    const tracker = createAgentSessionTracker("stream.jsonl");
    const sessionMeta = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "stream-session" },
    });

    pushRawLine(tracker, "", 1);
    tracker.pushParseWarning(2);
    tracker.pushParsedLine({
      lineNumber: 4,
      recordId: "record-4",
      data: JSON.parse(sessionMeta) as unknown,
    });

    const session = tracker.finish();
    expect(session).toMatchObject({
      fileType: "Codex",
      fileName: "stream.jsonl",
      meta: { sessionId: "stream-session", eventCount: 1 },
      events: [{ lineNumber: 4 }],
      parseWarnings: [{ lineNumber: 2, message: "Invalid JSON on this line" }],
    });
    expect(session?.events[0]).not.toHaveProperty("rawLine");
  });

  it("preserves an opaque canonical Record identity", () => {
    const tracker = createAgentSessionTracker("rollout.jsonl");
    tracker.pushParsedLine(
      line(
        { type: "session_meta", payload: { session_id: "opaque-link" } },
        41,
        "source-revision:9/record:opaque",
      ),
    );

    expect(tracker.finish()?.events[0]).toMatchObject({
      lineNumber: 41,
      recordId: "source-revision:9/record:opaque",
    });
  });

  it("locks in confident detection after twenty samples", () => {
    const tracker = createAgentSessionTracker();

    for (let index = 1; index <= 5; index += 1) {
      pushRawLine(tracker, unrelatedEvent(index), index);
    }
    for (let index = 6; index <= 20; index += 1) {
      pushRawLine(tracker, codexEvent(), index);
    }
    for (let index = 21; index <= 80; index += 1) {
      pushRawLine(tracker, unrelatedEvent(index), index);
    }
    pushRawLine(tracker, codexEvent("task_complete"), 81);

    const session = tracker.finish();
    expect(session?.fileType).toBe("Codex");
    expect(session?.meta.eventCount).toBe(16);
    expect(session?.events.at(-1)).toMatchObject({ lineNumber: 81, kind: "task_complete" });
  });

  it("disables detection after eighty inconclusive samples", () => {
    const tracker = createAgentSessionTracker();

    for (let index = 1; index < 80; index += 1) {
      pushRawLine(tracker, unrelatedEvent(index), index);
    }
    pushRawLine(tracker, codexEvent(), 80);
    for (let index = 81; index <= 160; index += 1) {
      pushRawLine(tracker, codexEvent(), index);
    }

    expect(tracker.finish()).toBeNull();
  });

  it("counts invalid lines toward the detection budget", () => {
    const tracker = createAgentSessionTracker();

    for (let lineNumber = 1; lineNumber < 80; lineNumber += 1) {
      tracker.pushParseWarning(lineNumber);
    }
    tracker.pushParsedLine(line({ type: "session_meta", payload: { session_id: "too-late" } }, 80));
    for (let lineNumber = 81; lineNumber <= 160; lineNumber += 1) {
      tracker.pushParsedLine(
        line({ type: "event_msg", payload: { type: "token_count" } }, lineNumber),
      );
    }

    expect(tracker.finish()).toBeNull();
  });

  it("bounds warning details while preserving their total count", () => {
    const tracker = createAgentSessionTracker();
    tracker.pushParsedLine(
      line({ type: "session_meta", payload: { session_id: "warning-budget" } }, 1),
    );
    for (let lineNumber = 2; lineNumber <= 20; lineNumber += 1) {
      tracker.pushParsedLine(
        line({ type: "event_msg", payload: { type: "token_count" } }, lineNumber),
      );
    }
    for (let lineNumber = 21; lineNumber <= 170; lineNumber += 1) {
      tracker.pushParseWarning(lineNumber);
    }

    const session = tracker.finish();

    expect(session?.parseWarnings).toHaveLength(100);
    expect(session?.parseWarningCount).toBe(150);
  });

  it("keeps the session when one Agent projection fails", () => {
    const payload: Record<string, unknown> = { type: "function_call_output" };
    Object.defineProperty(payload, "output", {
      enumerable: true,
      get() {
        throw new Error("unreadable output");
      },
    });
    const tracker = createAgentSessionTracker();
    tracker.pushParsedLine(
      line({ type: "session_meta", payload: { session_id: "resilient-session" } }, 1),
    );
    tracker.pushParsedLine(line({ type: "response_item", payload }, 2));

    const session = tracker.finish();

    expect(session).toMatchObject({
      meta: { sessionId: "resilient-session", eventCount: 1 },
      parseWarnings: [{ lineNumber: 2, message: "Unable to project Agent data from this line" }],
    });
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
    const items = conversationItems(session);
    expect(items.map((item) => item.role)).toEqual([
      "user",
      "thinking",
      "tool_call",
      "tool_result",
    ]);
    expect(items[2]?.block).toMatchObject({
      type: "tool_use",
      toolName: "exec_command",
      toolCallId: callId,
    });
    expect(items[3]?.block).toMatchObject({
      type: "tool_result",
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

    const session = createAgentSessionFromText(
      samples.map((sample) => JSON.stringify(sample.data)).join("\n"),
    );
    expect(session).toMatchObject({
      fileType: "Claude Code",
      meta: {
        sessionId: "claude-session",
        model: "claude-sonnet-4-5",
        eventCount: 5,
        turnCount: 1,
      },
    });
    expect(conversationItems(session).map((item) => item.role)).toEqual([
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

    const items = conversationItems(session);
    const toolCall = items.find((item) => item.role === "tool_call");
    const toolResult = items.find((item) => item.role === "tool_result");
    expect(toolCall?.block).toMatchObject({
      type: "tool_use",
      toolName: "Bash",
      toolCallId: "toolu_123",
    });
    expect(toolResult?.block).toMatchObject({
      type: "tool_result",
      toolCallId: "toolu_123",
      status: "completed",
      text: "file.txt",
    });
  });

  it("maps each Claude parallel tool_result to its own tool_use", () => {
    const session = createAgentSessionFromText(
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          promptId: "prompt-1",
          message: { role: "user", content: "Read both files" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_alpha", name: "Read", input: { path: "a.ts" } },
              { type: "tool_use", id: "toolu_beta", name: "Read", input: { path: "b.ts" } },
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
              { type: "tool_result", tool_use_id: "toolu_alpha", content: "alpha output" },
              { type: "text", text: "note between results" },
              {
                type: "tool_result",
                tool_use_id: "toolu_beta",
                content: "beta failed",
                is_error: true,
              },
              { type: "tool_result", content: "unattributed output" },
            ],
          },
        }),
      ].join("\n"),
      "transcript.jsonl",
    );

    const model = createAgentSessionModel(session!);
    expect(
      model.conversation
        .filter(({ item }) => item.block?.type === "tool_use")
        .map(({ item }) => item.block),
    ).toMatchObject([{ toolCallId: "toolu_alpha" }, { toolCallId: "toolu_beta" }]);

    const results = model.conversation.filter(({ item }) => item.block?.type === "tool_result");
    expect(results.map(({ item }) => item.block)).toEqual([
      {
        type: "tool_result",
        text: "alpha output",
        status: "completed",
        toolCallId: "toolu_alpha",
      },
      { type: "tool_result", text: "beta failed", status: "failed", toolCallId: "toolu_beta" },
      { type: "tool_result", text: "unattributed output", status: "completed" },
    ]);

    // The interleaved user text stays its own item instead of being folded
    // into a neighbouring result.
    expect(model.conversation.map(({ item }) => item.role)).toEqual([
      "user",
      "tool_call",
      "tool_call",
      "tool_result",
      "user",
      "tool_result",
      "tool_result",
    ]);

    for (const { item, event } of results) {
      const selection = model.selectConversation(item.id);
      expect(selection).toEqual({
        kind: "conversation",
        id: item.id,
        recordId: "record-3",
      });
      expect(model.resolveDetail(selection)).toEqual({
        event,
        conversationItem: item,
        recordId: "record-3",
      });
    }
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
