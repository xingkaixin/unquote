import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentSessionFixturePath } from "./fixture-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultOutputPath = path.resolve(repoRoot, agentSessionFixturePath);

export const syntheticAgentFixtureSeed = 0x1a2b3c4d;
export const syntheticAgentTurnCount = 48;
export const syntheticAgentRecordCount = 1 + syntheticAgentTurnCount * 9;

const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const pad = (value, length = 3) => String(value).padStart(length, "0");

export const buildSyntheticAgentFixture = ({
  seed = syntheticAgentFixtureSeed,
  turnCount = syntheticAgentTurnCount,
} = {}) => {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("seed must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(turnCount) || turnCount <= 0) {
    throw new Error("turnCount must be a positive safe integer");
  }

  const random = createRandom(seed);
  const records = [];
  const startedAt = Date.UTC(2026, 0, 15, 9, 0, 0);
  let eventIndex = 0;
  const timestamp = () => new Date(startedAt + eventIndex++ * 250).toISOString();
  const push = (type, payload) =>
    records.push(JSON.stringify({ timestamp: timestamp(), type, payload }));

  push("session_meta", {
    session_id: "synthetic-agent-session-v1",
    cwd: "workspace/synthetic-project",
    cli_version: "0.0.0-benchmark",
  });

  const toolNames = ["fixture.search", "fixture.read", "fixture.inspect"];
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnId = `turn-${pad(turn)}`;
    const callId = `call-${pad(turn)}`;
    const toolName = toolNames[Math.floor(random() * toolNames.length)];
    const successful = random() > 0.08;

    push("turn_context", {
      turn_id: turnId,
      cwd: "workspace/synthetic-project",
      model: "benchmark-model-v1",
    });
    push("event_msg", { type: "task_started", turn_id: turnId });
    push("response_item", {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Inspect nested synthetic fixture data for turn ${turn}.`,
        },
      ],
    });
    push("response_item", {
      type: "reasoning",
      summary: [{ text: `Plan deterministic nested benchmark work for turn ${turn}.` }],
    });
    push("response_item", {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: `I will use ${toolName} against non-sensitive fixture records.`,
        },
      ],
    });
    push("response_item", {
      type: "function_call",
      name: toolName,
      call_id: callId,
      arguments: JSON.stringify({
        query: `nested benchmark turn ${turn}`,
        scope: "workspace/synthetic-project",
        filters: { extension: ["ts", "tsx"], generated: false },
      }),
    });
    push("response_item", {
      type: "function_call_output",
      call_id: callId,
      status: successful ? "completed" : "failed",
      output: JSON.stringify({
        summary: `nested synthetic result for turn ${turn}`,
        matches: Array.from({ length: 160 }, (_, matchIndex) => ({
          path: `src/fixture-${pad(turn % 8, 2)}/module-${pad(matchIndex % 24, 2)}.ts`,
          line: matchIndex + 1,
          preview: `nested placeholder match ${turn}-${matchIndex} for reproducible performance data`,
        })),
        metadata: { exit_code: successful ? 0 : 1 },
      }),
    });
    push("event_msg", {
      type: "token_count",
      turn_id: turnId,
      input_tokens: 800 + turn * 7,
      output_tokens: 240 + turn * 3,
    });
    push("event_msg", {
      type: "task_complete",
      turn_id: turnId,
      message: successful ? "synthetic turn complete" : "synthetic turn completed with failure",
    });
  }

  return `${records.join("\n")}\n`;
};

export const writeSyntheticAgentFixture = ({
  outputPath = defaultOutputPath,
  force = false,
} = {}) => {
  const contents = buildSyntheticAgentFixture();
  if (!force && fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8") === contents) {
    console.log(`${path.relative(repoRoot, outputPath)}: already reproducible`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents);
  console.log(
    `${path.relative(repoRoot, outputPath)}: ${syntheticAgentRecordCount} records, ${Buffer.byteLength(contents)} bytes`,
  );
};

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === invokedUrl) {
  writeSyntheticAgentFixture({ force: process.argv.includes("--force") });
}
