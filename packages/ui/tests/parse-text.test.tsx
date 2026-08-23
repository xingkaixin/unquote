import { describe, expect, it } from "vitest";
import { parseText, parseTextResult } from "../src/lib/parse-text";

describe("parse text", () => {
  it("applies an optional forced format through one interface", () => {
    const input = '{"first":1}\n{"second":2}';

    expect(parseTextResult(input).format).toBe("jsonl");
    expect(parseTextResult(input, "json").format).toBe("json");
  });

  it("returns the parsed result, agent session, and completed progress", () => {
    const input = JSON.stringify({
      type: "session_meta",
      payload: { session_id: "shared-parse" },
    });

    const parsed = parseText(input, { forcedFormat: "jsonl", fileName: "rollout.jsonl" });

    expect(parsed.result.stats).toEqual({ total: 1, success: 1, failed: 0 });
    expect(parsed.agentSession).toMatchObject({
      fileType: "Codex",
      fileName: "rollout.jsonl",
      meta: { sessionId: "shared-parse" },
    });
    expect(parsed.progress).toEqual({
      elapsedMs: expect.any(Number),
      done: true,
    });
  });

  it("keeps deeply nested Agent output inside the projection budget", () => {
    const nestedOutput = `${"[".repeat(7_000)}"ok"${"]".repeat(7_000)}`;
    const input = [
      '{"type":"session_meta","payload":{"session_id":"deep-output"}}',
      `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call-1","output":${nestedOutput}}}`,
    ].join("\n");

    const parsed = parseText(input, { forcedFormat: "jsonl" });
    const block = parsed.agentSession?.events[1]?.conversationItems[0]?.block;

    expect(parsed.result.stats).toEqual({ total: 2, success: 2, failed: 0 });
    expect(block?.text).toMatch(/\.\.\. \[truncated\]$/);
    expect(block?.text.length).toBeLessThanOrEqual(8_015);
  });
});
