import { describe, expect, it } from "vitest";
import { createAgentSessionModel } from "../src/lib/agent-session";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import { createAgentTrajectoryPresentation } from "../src/lib/agent-session/trajectory-presentation";
import {
  expectTrajectorySelectionsToResolve,
  parsedLine,
  trajectoryTurnId,
} from "./claude-adapter.support";

const prompt = (promptId: string, timestamp: number) => ({
  type: "user",
  promptId,
  timestamp,
  message: { content: "Summarize the build" },
});

interface ApiErrorOverrides {
  readonly error?: { readonly message?: string; readonly formatted?: string };
  readonly retryAttempt?: number | string;
  readonly maxRetries?: number;
  readonly retryInMs?: number | undefined;
}

const apiError = (timestamp: number, fields: ApiErrorOverrides = {}) => ({
  type: "system",
  subtype: "api_error",
  level: "error",
  error: { message: "Socket closed", formatted: "Connection error" },
  retryInMs: 1_200,
  retryAttempt: 1,
  maxRetries: 10,
  source: "connection_retry",
  timestamp,
  ...fields,
});

const assistant = (timestamp: number, stopReason?: string) => ({
  type: "assistant",
  timestamp,
  message: {
    content: [{ type: "text", text: "Done" }],
    ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
  },
});

const failedToolTurn = (timestamp: number) => [
  {
    type: "assistant",
    timestamp,
    message: { content: [{ type: "tool_use", id: "call-1", name: "Bash", input: {} }] },
  },
  {
    type: "user",
    timestamp: timestamp + 10,
    message: {
      content: [{ type: "tool_result", tool_use_id: "call-1", content: "exit 1", is_error: true }],
    },
  },
];

const sessionFor = (records: readonly object[]) => {
  const builder = claudeTranscriptAdapter.createBuilder();
  records.forEach((record, index) => builder.push(parsedLine(record, index + 1)));
  return builder.finish([]);
};

describe("claudeTranscriptAdapter: API errors", () => {
  it("projects each API error onto its turn with the retry the log reports", () => {
    const session = sessionFor([
      prompt("prompt-1", 100),
      apiError(200),
      apiError(300, { retryAttempt: 2, retryInMs: 2_400 }),
      assistant(400, "end_turn"),
    ]);
    const trajectory = expectTrajectorySelectionsToResolve(session);
    const model = createAgentSessionModel(session);

    const apiErrors = trajectory.items.filter((item) => item.kind === "api-error");
    expect(apiErrors).toEqual([
      expect.objectContaining({
        status: "failed",
        recordId: "record-2",
        lineNumber: 2,
        timestamp: 200,
        turnId: trajectoryTurnId("evidence", "prompt-1"),
        retryAttempt: 1,
        maxRetries: 10,
        retryInMs: 1_200,
      }),
      expect.objectContaining({ recordId: "record-3", retryAttempt: 2, retryInMs: 2_400 }),
    ]);
    expect(model.resolveDetail(apiErrors[0]!.selection)?.event.preview).toBe("Socket closed");
    expect(trajectory.turns).toMatchObject([{ status: "completed" }]);
  });

  it("omits retry facts the log does not provide and falls back to the formatted message", () => {
    const session = sessionFor([
      prompt("prompt-1", 100),
      apiError(200, {
        error: { formatted: "Connection error" },
        retryAttempt: "2",
        maxRetries: -1,
        retryInMs: undefined,
      }),
    ]);
    const [item] = createAgentSessionModel(session).trajectory.items.filter(
      (candidate) => candidate.kind === "api-error",
    );

    expect(item).not.toHaveProperty("retryAttempt");
    expect(item).not.toHaveProperty("maxRetries");
    expect(item).not.toHaveProperty("retryInMs");
    expect(session.events[1]?.preview).toBe("Connection error");
  });

  it("keeps API errors out of the tool and failure counts", () => {
    const session = sessionFor([
      prompt("prompt-1", 100),
      apiError(150),
      ...failedToolTurn(200),
      assistant(300, "end_turn"),
    ]);

    const { summary } = createAgentTrajectoryPresentation(createAgentSessionModel(session));

    expect(summary).toMatchObject({ tools: 1, failures: 1 });
    expect(summary.toolSummaries).toEqual([
      expect.objectContaining({ toolName: "Bash", calls: 1, failures: 1 }),
    ]);
  });
});
