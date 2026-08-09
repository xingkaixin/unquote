import { parseJsonlRecordLineWithValue, parsePreviewJsonlRecordLineWithValue } from "@unquote/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJsonlIngestion } from "../src/lib/jsonl-ingestion";
import { parseText } from "../src/lib/parse-text";

const jsonl = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join("\n");

const streamText = (input: string, fileName?: string) => {
  const ingestion = createJsonlIngestion(fileName);
  const records = input.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) {
      return [];
    }
    return [ingestion.push(parseJsonlRecordLineWithValue(line, index + 1))];
  });

  return {
    result: {
      format: "jsonl" as const,
      records,
      stats: ingestion.stats(),
    },
    agentSession: ingestion.finishAgentSession(),
  };
};

afterEach(() => vi.restoreAllMocks());

describe("JSONL ingestion", () => {
  it("decodes each batch line once for both Records and Agent facts", () => {
    const validLine = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "single-decode" },
    });
    const invalidLine = "{bad}";
    const parse = vi.spyOn(JSON, "parse");

    parseText(`${validLine}\n${invalidLine}`, { forcedFormat: "jsonl" });

    expect(parse.mock.calls.filter(([input]) => input === validLine)).toHaveLength(1);
    expect(parse.mock.calls.filter(([input]) => input === invalidLine)).toHaveLength(1);
  });

  it("links Full and Preview Agent events to their producing Record identity", () => {
    const input = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "canonical-link" },
    });

    for (const parseLine of [parseJsonlRecordLineWithValue, parsePreviewJsonlRecordLineWithValue]) {
      const ingestion = createJsonlIngestion("rollout.jsonl");
      const record = ingestion.push(parseLine(input, 17));
      const session = ingestion.finishAgentSession();

      expect(session?.events[0]?.recordId).toBe(record.id);
      expect(session?.events[0]?.lineNumber).toBe(record.lineNumber);
    }
  });

  it.each([
    {
      name: "Codex rollout",
      fileName: "rollout.jsonl",
      input: jsonl(
        { type: "session_meta", payload: { session_id: "codex-session" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      ),
    },
    {
      name: "Claude transcript",
      fileName: "claude.jsonl",
      input: jsonl(
        { type: "mode", mode: "default", sessionId: "claude-session" },
        {
          type: "user",
          uuid: "user-1",
          sessionId: "claude-session",
          promptId: "prompt-1",
          message: { role: "user", content: "Run it" },
        },
        {
          type: "assistant",
          uuid: "assistant-1",
          sessionId: "claude-session",
          message: { role: "assistant", content: "Done" },
        },
      ),
    },
    {
      name: "generic records",
      fileName: "events.jsonl",
      input: jsonl({ event: "worker.tick", index: 1 }, { event: "worker.tick", index: 2 }),
    },
    {
      name: "invalid line mixture",
      fileName: "partial.jsonl",
      input: `${jsonl({ type: "session_meta", payload: { session_id: "partial" } })}\n\n{bad}\n${jsonl(
        { type: "event_msg", payload: { type: "task_complete" } },
      )}`,
    },
  ])("keeps batch and streamed $name output identical", ({ fileName, input }) => {
    const batch = parseText(input, { forcedFormat: "jsonl", fileName });
    const streamed = streamText(input, fileName);

    expect(streamed.result).toEqual(batch.result);
    expect(streamed.agentSession).toEqual(batch.agentSession);
    for (const parsed of [batch, streamed]) {
      for (const event of parsed.agentSession?.events ?? []) {
        const producingRecord = parsed.result.records.find(
          (record) => record.lineNumber === event.lineNumber,
        );
        expect(event.recordId).toBe(producingRecord?.id);
      }
    }
  });
});
