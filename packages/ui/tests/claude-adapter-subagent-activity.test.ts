import { describe, expect, it } from "vitest";
import { claudeTranscriptAdapter } from "../src/lib/agent-session/claude-adapter";
import { expectTrajectorySelectionsToResolve, parsedLine } from "./claude-adapter.support";

const prompt = (promptId: string, timestamp: number, content: string) => ({
  type: "user",
  promptId,
  timestamp,
  message: { content },
});

const subagentCall = (id: string, timestamp: number, name = "Agent") => ({
  type: "assistant",
  timestamp,
  message: {
    content: [{ type: "tool_use", id, name, input: { description: "Review", prompt: "Review" } }],
  },
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Claude Code writes toolUseResult as either an object or an error string.
const toolResult = (id: string, timestamp: number, toolUseResult: unknown, isError = false) => ({
  type: "user",
  timestamp,
  toolUseResult,
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content: "done", is_error: isError }],
  },
});

const notification = (promptId: string, timestamp: number, taskId: string, status: string) =>
  prompt(
    promptId,
    timestamp,
    `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>Done</summary>\n</task-notification>`,
  );

const subagentItems = (lines: readonly object[]) => {
  const builder = claudeTranscriptAdapter.createBuilder();
  lines.forEach((line, index) => builder.push(parsedLine(line, index + 1)));
  const trajectory = expectTrajectorySelectionsToResolve(builder.finish([]));
  return trajectory.items
    .filter((item) => item.kind === "subagent")
    .map(({ status, recordId }) => ({ status, recordId }));
};

describe("claudeTranscriptAdapter: subagent-activity", () => {
  it("projects foreground subagents from their calls and results", () => {
    expect(
      subagentItems([
        prompt("prompt-1", 100, "Review the change"),
        subagentCall("call-agent", 200),
        toolResult("call-agent", 300, { status: "completed", agentId: "agent-1" }),
        subagentCall("call-task", 400, "Task"),
        toolResult("call-task", 500, "Subagent crashed", true),
        subagentCall("call-bash", 600, "Bash"),
        toolResult("call-bash", 700, { stdout: "ok" }),
      ]),
    ).toEqual([
      { status: "running", recordId: "record-2" },
      { status: "completed", recordId: "record-3" },
      { status: "running", recordId: "record-4" },
      { status: "failed", recordId: "record-5" },
    ]);
  });

  it("ends background subagents at their task notifications", () => {
    expect(
      subagentItems([
        prompt("prompt-1", 100, "Research in parallel"),
        subagentCall("call-a", 200),
        toolResult("call-a", 210, { status: "async_launched", agentId: "agent-a" }),
        subagentCall("call-b", 220),
        toolResult("call-b", 230, { status: "async_launched", agentId: "agent-b" }),
        notification("prompt-2", 400, "agent-a", "completed"),
        notification("prompt-3", 500, "bash-task", "failed"),
        notification("prompt-4", 600, "agent-b", "killed"),
      ]),
    ).toEqual([
      { status: "running", recordId: "record-2" },
      { status: "running", recordId: "record-4" },
      { status: "completed", recordId: "record-6" },
      { status: "aborted", recordId: "record-8" },
    ]);
  });
});
