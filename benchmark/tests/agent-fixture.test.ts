import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticAgentFixture,
  syntheticAgentRecordCount,
  syntheticAgentTurnCount,
} from "../generate-agent-fixture.mjs";
import { parseText } from "../../packages/ui/src/lib/parse-text";
import { createAgentSessionModel } from "../../packages/ui/src/lib/agent-session";

describe("synthetic Agent benchmark fixture", () => {
  it("is deterministic, non-sensitive, and large enough for Local-file Source Access", () => {
    const first = buildSyntheticAgentFixture();
    const second = buildSyntheticAgentFixture();

    expect(first).toBe(second);
    expect(first.trim().split("\n")).toHaveLength(syntheticAgentRecordCount);
    expect(Buffer.byteLength(first)).toBeGreaterThan(1_000_000);
    expect(first).not.toContain(os.homedir());
    expect(first).not.toContain(process.cwd());
    expect(first).not.toMatch(/"(?:cwd|path)":"\//);
    expect(first).toContain('"session_id":"synthetic-agent-session-v1"');
  });

  it("is detected as the intended Codex session with virtualized-scale data", () => {
    const parsed = parseText(buildSyntheticAgentFixture(), {
      forcedFormat: "jsonl",
      fileName: "case1-agent-session.jsonl",
    });
    const session = parsed.agentSession;

    expect(parsed.result.stats).toEqual({
      total: syntheticAgentRecordCount,
      success: syntheticAgentRecordCount,
      failed: 0,
    });
    expect(session).toMatchObject({
      fileType: "Codex",
      meta: {
        sessionId: "synthetic-agent-session-v1",
        model: "benchmark-model-v1",
        turnCount: syntheticAgentTurnCount,
        eventCount: syntheticAgentRecordCount,
      },
      parseWarnings: [],
    });
    if (!session) {
      throw new Error("Synthetic fixture did not produce an Agent Session");
    }

    const model = createAgentSessionModel(session);
    expect(model.events.length).toBeGreaterThan(160);
    expect(model.conversation.length).toBeGreaterThan(160);
    expect(
      model.conversation.filter(
        ({ item }) => item.role === "tool_call" || item.role === "tool_result",
      ),
    ).toHaveLength(syntheticAgentTurnCount * 2);
  });
});
