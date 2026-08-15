import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticAgentFixture,
  syntheticAgentMatchesPerToolResult,
  syntheticAgentMaxRecordCount,
  syntheticAgentMaxTotalMatches,
  syntheticAgentMaxTurnCount,
  syntheticAgentRecordCount,
  syntheticAgentStressMatchesPerToolResult,
  syntheticAgentStressRecordCount,
  syntheticAgentStressTurnCount,
  syntheticAgentTurnCount,
  writeSyntheticAgentFixtures,
} from "../generate-agent-fixture.mjs";
import {
  agentSessionFixturePath,
  agentSessionStressFixturePath,
  benchmarkScenarioFor,
  defaultBenchmarkFixturePaths,
} from "../fixture-manifest.mjs";
import { parseText } from "../../packages/ui/src/lib/parse-text";
import { createAgentSessionModel } from "../../packages/ui/src/lib/agent-session";

const stressOptions = {
  turnCount: syntheticAgentStressTurnCount,
  matchesPerToolResult: syntheticAgentStressMatchesPerToolResult,
};

const defaultFixtureBytes = 1_131_587;
const defaultFixtureSha256 = "736464c2ba397a5b6e88e016f9b51162243fa11e76d008122417b57096d2fa4e";
const stressFixtureBytes = 1_119_670;
const stressFixtureSha256 = "11a5baf70e544d20c86d5b978f0198ee651274e34d72c544e5aba054f2d2ab87";
const sha256 = (contents: string) => createHash("sha256").update(contents).digest("hex");

const expectNonSensitiveFixture = (contents: string) => {
  expect(contents).not.toContain(os.homedir());
  expect(contents).not.toContain(process.cwd());
  expect(contents).not.toMatch(/"(?:cwd|path)":"\//);
  expect(contents).toContain('"session_id":"synthetic-agent-session-v1"');
};

const expectCodexSession = (
  contents: string,
  fileName: string,
  turnCount: number,
  recordCount: number,
) => {
  const parsed = parseText(contents, {
    forcedFormat: "jsonl",
    fileName,
  });
  const session = parsed.agentSession;

  expect(parsed.result.stats).toEqual({
    total: recordCount,
    success: recordCount,
    failed: 0,
  });
  expect(session).toMatchObject({
    fileType: "Codex",
    meta: {
      sessionId: "synthetic-agent-session-v1",
      model: "benchmark-model-v1",
      turnCount,
      eventCount: recordCount,
    },
    parseWarnings: [],
  });
  if (!session) {
    throw new Error("Synthetic fixture did not produce an Agent Session");
  }

  const model = createAgentSessionModel(session);
  expect(
    model.conversation.filter(
      ({ item }) => item.role === "tool_call" || item.role === "tool_result",
    ),
  ).toHaveLength(turnCount * 2);
};

describe("synthetic Agent benchmark fixture", () => {
  it("keeps the default fixture deterministic, non-sensitive, and larger than 1 MB", () => {
    const first = buildSyntheticAgentFixture();
    const second = buildSyntheticAgentFixture();

    expect(first).toBe(second);
    expect(first.trim().split("\n")).toHaveLength(syntheticAgentRecordCount);
    expect(Buffer.byteLength(first)).toBe(defaultFixtureBytes);
    expect(sha256(first)).toBe(defaultFixtureSha256);
    expectNonSensitiveFixture(first);
  });

  it("generates a bounded deterministic 5K fixture", () => {
    const first = buildSyntheticAgentFixture(stressOptions);
    const second = buildSyntheticAgentFixture(stressOptions);

    expect(first).toBe(second);
    expect(first.trim().split("\n")).toHaveLength(syntheticAgentStressRecordCount);
    expect(syntheticAgentStressRecordCount).toBe(5_005);
    expect(Buffer.byteLength(first)).toBe(stressFixtureBytes);
    expect(sha256(first)).toBe(stressFixtureSha256);
    expectNonSensitiveFixture(first);

    const toolOutputs = first
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type?: string; payload?: Record<string, unknown> })
      .filter(
        ({ type, payload }) => type === "response_item" && payload?.type === "function_call_output",
      )
      .map(({ payload }) => JSON.parse(String(payload?.output)) as { matches?: unknown[] });
    expect(toolOutputs).toHaveLength(syntheticAgentStressTurnCount);
    expect(toolOutputs.every(({ matches }) => matches?.length === 2)).toBe(true);
  });

  it("detects both fixture sizes as complete Codex sessions", () => {
    expectCodexSession(
      buildSyntheticAgentFixture(),
      agentSessionFixturePath,
      syntheticAgentTurnCount,
      syntheticAgentRecordCount,
    );
    expectCodexSession(
      buildSyntheticAgentFixture(stressOptions),
      agentSessionStressFixturePath,
      syntheticAgentStressTurnCount,
      syntheticAgentStressRecordCount,
    );
  });

  it("registers both Agent fixtures in the default benchmark manifest", () => {
    expect(benchmarkScenarioFor(agentSessionFixturePath)).toBe("agent-session");
    expect(benchmarkScenarioFor(agentSessionStressFixturePath)).toBe("agent-session");
    expect(defaultBenchmarkFixturePaths).toEqual([
      agentSessionFixturePath,
      agentSessionStressFixturePath,
      "benchmark/case2-1MB.jsonl",
      "benchmark/case2-5MB.jsonl",
      "benchmark/case2-10MB.jsonl",
      "benchmark/case4-5K-rows.jsonl",
    ]);
  });

  it("writes both deterministic fixtures to explicit output paths", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "unquote-agent-fixtures-"));
    const defaultOutputPath = path.join(directory, "default.jsonl");
    const stressOutputPath = path.join(directory, "stress.jsonl");

    try {
      writeSyntheticAgentFixtures({ force: true, defaultOutputPath, stressOutputPath });

      expect(fs.readFileSync(defaultOutputPath, "utf8")).toBe(buildSyntheticAgentFixture());
      expect(fs.readFileSync(stressOutputPath, "utf8")).toBe(
        buildSyntheticAgentFixture(stressOptions),
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [{ seed: -1 }, /seed must be a non-negative safe integer/],
    [{ seed: Number.MAX_SAFE_INTEGER + 1 }, /seed must be a non-negative safe integer/],
    [{ turnCount: 0 }, /turnCount must be a positive safe integer/],
    [{ turnCount: 1.5 }, /turnCount must be a positive safe integer/],
    [{ turnCount: syntheticAgentMaxTurnCount + 1 }, /turnCount exceeds record budget/],
    [{ matchesPerToolResult: -1 }, /matchesPerToolResult must be a non-negative safe integer/],
    [
      { matchesPerToolResult: Number.MAX_SAFE_INTEGER + 1 },
      /matchesPerToolResult must be a non-negative safe integer/,
    ],
    [{ matchesPerToolResult: Number.MAX_SAFE_INTEGER }, /total matches budget/],
  ])("rejects invalid generator options %j", (options, message) => {
    expect(() => buildSyntheticAgentFixture(options)).toThrow(message);
  });

  it("accepts the exact record and total-match generation budgets", () => {
    expect(syntheticAgentMaxRecordCount).toBe(100_000);
    expect(syntheticAgentMaxTotalMatches).toBe(100_000);
    expect(syntheticAgentMaxTurnCount).toBe(11_111);
    expect(
      buildSyntheticAgentFixture({
        turnCount: syntheticAgentMaxTurnCount,
        matchesPerToolResult: 0,
      })
        .trim()
        .split("\n"),
    ).toHaveLength(syntheticAgentMaxRecordCount);
    expect(() =>
      buildSyntheticAgentFixture({ turnCount: 1, matchesPerToolResult: 100_000 }),
    ).not.toThrow();
  });

  it("rejects fixture generation above either budget", () => {
    expect(() =>
      buildSyntheticAgentFixture({ turnCount: 11_112, matchesPerToolResult: 0 }),
    ).toThrow(/record budget of 100000/);
    expect(() =>
      buildSyntheticAgentFixture({ turnCount: 1, matchesPerToolResult: 100_001 }),
    ).toThrow(/total matches budget of 100000/);
    expect(() =>
      buildSyntheticAgentFixture({ turnCount: 2, matchesPerToolResult: 50_001 }),
    ).toThrow(/total matches budget of 100000/);
  });

  it("preserves the default tool-result width", () => {
    expect(syntheticAgentMatchesPerToolResult).toBe(160);
    expect(syntheticAgentStressMatchesPerToolResult).toBe(2);
  });
});
