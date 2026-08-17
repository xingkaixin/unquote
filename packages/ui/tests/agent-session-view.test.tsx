import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionView } from "../src/components/agent-session-view";
import { I18nProvider } from "../src/i18n/context";
import { createAgentSessionModel, type AgentSession } from "../src/lib/agent-session";

const trajectoryMeasureName = "unquote:agentTrajectory:build";

const session: AgentSession = {
  fileType: "Codex",
  fileName: "rollout.jsonl",
  meta: {
    sessionId: "session-1",
    model: "gpt-5",
    cwd: "/repo",
    version: "1.0.0",
    eventCount: 3,
    turnCount: 1,
  },
  events: [
    {
      id: "event-1",
      recordId: "record-1",
      lineNumber: 1,
      category: "meta",
      kind: "session_meta",
      label: "Session metadata",
      preview: "session-1",
      conversationItems: [],
      timestampLabel: "2026-07-16T10:00:00.000Z",
    },
    {
      id: "event-2",
      recordId: "record-2",
      lineNumber: 2,
      category: "user",
      kind: "message",
      label: "User message",
      preview: "hello",
      conversationItems: [
        {
          id: "conversation-1",
          role: "user",
          turnIndex: 1,
          block: { type: "text", text: "hello" },
        },
      ],
      turnIndex: 1,
    },
    {
      id: "event-3",
      recordId: "record-3",
      lineNumber: 3,
      category: "unknown",
      kind: "invalid",
      label: "Invalid line",
      preview: "",
      conversationItems: [],
    },
  ],
  parseWarnings: [{ lineNumber: 3, message: "Invalid JSON on this line" }],
  parseWarningCount: 1,
};

const renderView = (overrides: Partial<ComponentProps<typeof AgentSessionView>> = {}) => {
  const callbacks = {
    onDetailSelectionChange: vi.fn(),
    onOpenRecord: vi.fn(),
  };
  const sourceSession = overrides.session ?? session;
  const props: ComponentProps<typeof AgentSessionView> = {
    session: sourceSession,
    model: overrides.model ?? createAgentSessionModel(sourceSession),
    isDesktop: true,
    detailSelection: null,
    onDetailSelectionChange: callbacks.onDetailSelectionChange,
    onOpenRecord: callbacks.onOpenRecord,
    ...overrides,
  };
  const view = render(
    <I18nProvider>
      <AgentSessionView {...props} />
    </I18nProvider>,
  );
  return { callbacks, ...view };
};

afterEach(() => {
  cleanup();
  performance.clearMeasures(trajectoryMeasureName);
});

describe("AgentSessionView", () => {
  it("does not build the model while rendering or rerendering", () => {
    const model = createAgentSessionModel(session);
    performance.clearMeasures(trajectoryMeasureName);
    const { callbacks, rerender } = renderView({ model });

    rerender(
      <I18nProvider>
        <AgentSessionView
          session={session}
          model={model}
          isDesktop
          detailSelection={{ kind: "event", id: "event-2", recordId: "record-2" }}
          onDetailSelectionChange={callbacks.onDetailSelectionChange}
          onOpenRecord={callbacks.onOpenRecord}
        />
      </I18nProvider>,
    );

    expect(performance.getEntriesByName(trajectoryMeasureName, "measure")).toHaveLength(0);
  });

  it("renders the three columns and links every navigation source", () => {
    const { callbacks } = renderView();

    expect(document.querySelector(".uq-agent-shell")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Session overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Timeline: meta · Session metadata" }));
    expect(callbacks.onDetailSelectionChange).toHaveBeenLastCalledWith({
      kind: "event",
      id: "event-1",
      recordId: "record-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Timeline: user · User message" }));
    expect(callbacks.onDetailSelectionChange).toHaveBeenLastCalledWith({
      kind: "conversation",
      id: "conversation-1",
      recordId: "record-2",
    });
    fireEvent.click(screen.getByRole("button", { name: "Conversation: User" }));
    expect(callbacks.onDetailSelectionChange).toHaveBeenLastCalledWith({
      kind: "conversation",
      id: "conversation-1",
      recordId: "record-2",
    });
  });

  it("reports the selected detail to the timeline and the conversation together", () => {
    renderView({
      detailSelection: { kind: "conversation", id: "conversation-1", recordId: "record-2" },
    });

    const userTimelineItem = screen
      .getByRole("button", { name: "Timeline: user · User message" })
      .closest("[role='listitem']");
    const metaTimelineItem = screen
      .getByRole("button", { name: "Timeline: meta · Session metadata" })
      .closest("[role='listitem']");
    const conversationItem = screen
      .getByRole("button", { name: "Conversation: User" })
      .closest("[role='listitem']");

    expect(userTimelineItem).toHaveAttribute("aria-current", "true");
    expect(metaTimelineItem).not.toHaveAttribute("aria-current");
    expect(conversationItem).toHaveAttribute("aria-current", "true");
  });

  it("opens the record behind a conversation turn", () => {
    const { callbacks } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "View in JSONL" }));
    expect(callbacks.onOpenRecord).toHaveBeenCalledWith("record-2");
  });

  it("summarizes the session in the facts pane", () => {
    renderView();

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("rollout.jsonl")).toBeInTheDocument();
    expect(screen.getByText("1 warnings")).toBeInTheDocument();
    expect(screen.getByText("session-1")).toBeInTheDocument();
    expect(screen.getByText("/repo · v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();

    const metrics = document.querySelector("[data-agent-metrics]");
    expect(metrics).toHaveAttribute("data-agent-metrics", "4");
    expect(metrics).toHaveTextContent("Events3");
    expect(metrics).toHaveTextContent("Messages1");
  });

  it("stacks the columns behind a disclosure on a narrow viewport", () => {
    renderView({ isDesktop: false });

    const disclosure = document.querySelector("details");
    expect(disclosure).toBeInTheDocument();
    expect(disclosure).toHaveTextContent("Session overview");
  });

  it("renders a minimal empty session", () => {
    const emptySession: AgentSession = {
      fileType: "Claude Code",
      meta: { eventCount: 0, turnCount: 0 },
      events: [],
      parseWarnings: [],
      parseWarningCount: 0,
    };
    renderView({ session: emptySession });

    expect(screen.getByText("No conversation items in this session")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Timeline:/ })).toHaveLength(0);
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
  });
});
