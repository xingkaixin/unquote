import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentFactsPane } from "../src/components/agent-facts-pane";
import { I18nProvider } from "../src/i18n/context";
import { createAgentSessionModel } from "../src/lib/agent-session";
import type { AgentSession, AgentTimelineEvent } from "../src/lib/agent-session";

afterEach(cleanup);

const toolCallItem = {
  id: "conversation-1",
  role: "tool_call",
  block: { type: "tool_use", text: "{}" },
} as const;
const toolResultItem = {
  id: "conversation-2",
  role: "tool_result",
  block: { type: "tool_result", text: "ok" },
} as const;

const firstTurnEvent: AgentTimelineEvent = {
  id: "event-1",
  recordId: "record-1",
  lineNumber: 1,
  category: "user",
  kind: "message",
  label: "User message",
  preview: "start",
  conversationItems: [],
  turnIndex: 1,
  sessionEvidence: [{ kind: "turn-lifecycle", phase: "start" }],
};

const toolEvent: AgentTimelineEvent = {
  id: "event-2",
  recordId: "record-2",
  lineNumber: 2,
  category: "tool",
  kind: "function_call",
  label: "Tool call",
  preview: "shell",
  turnIndex: 2,
  conversationItems: [
    toolCallItem,
    toolResultItem,
    { id: "conversation-3", role: "assistant", block: { type: "text", text: "done" } },
  ],
  sessionEvidence: [
    {
      kind: "tool-lifecycle",
      phase: "call",
      toolName: "shell",
      callId: "call-1",
      conversationItemId: toolCallItem.id,
    },
    {
      kind: "tool-lifecycle",
      phase: "result",
      status: "completed",
      callId: "call-1",
      conversationItemId: toolResultItem.id,
    },
  ],
};

const session: AgentSession = {
  fileType: "Codex",
  fileName: "rollout.jsonl",
  meta: {
    sessionId: "session-1",
    model: "gpt-5",
    cwd: "/repo",
    version: "1.0.0",
  },
  events: [firstTurnEvent, toolEvent],
  parseWarnings: [{ kind: "invalid-json", recordId: "record-3", lineNumber: 3 }],
  parseWarningCount: 1,
};

const renderPane = (next: AgentSession = session, onOpenRecord = vi.fn()) => {
  render(
    <I18nProvider>
      <AgentFactsPane
        session={next}
        model={createAgentSessionModel(next)}
        onOpenRecord={onOpenRecord}
      />
    </I18nProvider>,
  );
  return { onOpenRecord };
};

describe("AgentFactsPane", () => {
  it("counts events, messages, turns, and tool exchanges", () => {
    renderPane();
    const metrics = document.querySelector("[data-agent-metrics]")!;

    expect(metrics).toHaveAttribute("data-agent-metrics", "4");
    expect(metrics).toHaveTextContent("Events2");
    expect(metrics).toHaveTextContent("Messages3");
    expect(metrics).toHaveTextContent("Turns2");
    expect(metrics).toHaveTextContent("Tools2");
  });

  it("chips the file type, file name, and parse warnings", () => {
    renderPane();

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("rollout.jsonl")).toBeInTheDocument();
    expect(screen.getByText("1 warnings")).toBeInTheDocument();
  });

  it("shows the total when warning details are bounded", () => {
    renderPane({ ...session, parseWarningCount: 150 });

    expect(screen.getByText("150 warnings")).toBeInTheDocument();
    expect(screen.getByText("149 more warnings not shown")).toBeInTheDocument();
  });

  it("explains parse warnings and opens their canonical Records", () => {
    const projectionWarning = {
      kind: "projection-failed" as const,
      recordId: "record-4",
      lineNumber: 4,
    };
    const { onOpenRecord } = renderPane({
      ...session,
      parseWarnings: [...session.parseWarnings, projectionWarning],
      parseWarningCount: 2,
    });

    expect(screen.getByText("Parsing warnings")).toBeInTheDocument();
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("Could not interpret Agent data in this Record")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Record: Line 4" }));
    expect(onOpenRecord).toHaveBeenCalledWith("record-4");
  });

  it("composes the working directory and version under the session id", () => {
    renderPane();

    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("session-1")).toBeInTheDocument();
    expect(screen.getByText("/repo · v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
  });

  it("keeps the session block for a working directory with no version", () => {
    renderPane({ ...session, meta: { cwd: "/repo" } });

    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("/repo")).toBeInTheDocument();
  });

  it("omits every fact the session does not carry", () => {
    renderPane({
      fileType: "Claude Code",
      meta: { sessionId: "session-1" },
      events: session.events,
      parseWarnings: [],
      parseWarningCount: 0,
    });

    expect(screen.getByText("session-1")).toBeInTheDocument();
    expect(screen.queryByText("rollout.jsonl")).not.toBeInTheDocument();
    expect(screen.queryByText(/warnings/)).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });

  it("drops the session block entirely when nothing identifies the session", () => {
    renderPane({ ...session, meta: {} });

    expect(screen.queryByText("Session")).not.toBeInTheDocument();
  });
});
