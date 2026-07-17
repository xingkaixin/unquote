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
      processedLines: 1,
      success: 1,
      failed: 0,
      elapsedMs: expect.any(Number),
      done: true,
    });
  });
});
