import { parseInput } from "@unquote/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionView } from "../src/components/agent-session-view";
import { I18nProvider } from "../src/i18n/context";
import type { AgentDetailSelection, AgentSession } from "../src/lib/agent-session";
import type { RecordViewState } from "../src/lib/record-view";

const rawLines = [
  '{"type":"session_meta","payload":{"session_id":"session-1"},"nested":"{\\"a\\":1}"}',
  '{"type":"response_item","payload":{"type":"message","role":"user"}}',
  "not json",
];

const records = parseInput(rawLines.join("\n"), { forcedFormat: "jsonl" }).records;

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
};

const recordMap = new Map(records.map((record) => [record.id, record]));

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 900,
            height: 600,
            top: 0,
            right: 900,
            bottom: 600,
            left: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [{ inlineSize: 900, blockSize: 600 }],
          contentBoxSize: [{ inlineSize: 900, blockSize: 600 }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
}

const renderView = (
  overrides: Partial<ComponentProps<typeof AgentSessionView>> = {},
  stateOverrides: Partial<RecordViewState> = {},
) => {
  const callbacks = {
    onDetailSelectionChange: vi.fn(),
    onTogglePath: vi.fn(),
    onCopyRecord: vi.fn(),
    onCopyRawLine: vi.fn(),
    copyError: vi.fn(),
    onSelectNode: vi.fn(),
    onRequestFullRecord: vi.fn(),
    onClearFocus: vi.fn(),
  };
  const props: ComponentProps<typeof AgentSessionView> = {
    session,
    recordsById: recordMap,
    recordView: {
      state: {
        resolveRecord: (record) => record,
        recordInsights: new Map(),
        expandedStringifiedPathsByRecord: new Map(),
        selectedPath: { recordId: "record-1", pathText: "$" },
        focusedPath: { recordId: "record-1", pathText: "$" },
        ...stateOverrides,
      },
      actions: {
        togglePath: callbacks.onTogglePath,
        copyRecord: callbacks.onCopyRecord,
        copyRawLine: callbacks.onCopyRawLine,
        copyError: callbacks.copyError,
        selectNode: callbacks.onSelectNode,
        requestFullRecord: callbacks.onRequestFullRecord,
        clearFocus: callbacks.onClearFocus,
      },
    },
    detailSelection: null,
    onDetailSelectionChange: callbacks.onDetailSelectionChange,
    ...overrides,
  };
  const view = render(
    <I18nProvider>
      <AgentSessionView {...props} />
    </I18nProvider>,
  );
  return { callbacks, ...view };
};

describe("AgentSessionView", () => {
  beforeEach(() => {
    localStorage.clear();
    MockResizeObserver.instances = [];
    Object.assign(globalThis, { ResizeObserver: MockResizeObserver });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("renders the horizontal workspace and links every navigation source", () => {
    const { callbacks, unmount } = renderView();

    expect(screen.getByText("rollout.jsonl")).toBeInTheDocument();
    expect(screen.getByText("1 warnings")).toBeInTheDocument();
    expect(screen.getAllByText("session-1")).toHaveLength(2);
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("/repo")).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByTestId("uq-agent-workspace")).toHaveAttribute("data-group", "true");

    fireEvent.click(screen.getByRole("button", { name: "Copy record" }));
    expect(callbacks.onCopyRecord).toHaveBeenCalledWith(records[0]);
    fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
    expect(callbacks.onClearFocus).toHaveBeenCalledTimes(1);

    const treeItems = screen.getAllByRole("treeitem");
    const expandableTreeItem = treeItems.find((item) => item.querySelector("[data-tree-toggle]"));
    expect(expandableTreeItem).toBeDefined();
    fireEvent.click(expandableTreeItem!.querySelector("[data-tree-toggle]")!);
    expect(callbacks.onTogglePath).toHaveBeenCalledWith("record-1", expect.any(String));
    fireEvent.click(treeItems[0]!);
    expect(callbacks.onSelectNode).toHaveBeenCalledWith(records[0], expect.any(Object));

    fireEvent.click(screen.getByRole("button", { name: "Timeline: Session metadata" }));
    expect(callbacks.onDetailSelectionChange).toHaveBeenLastCalledWith({
      kind: "event",
      id: "event-1",
      recordId: "record-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Timeline: User message" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Collapse timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse raw data" }));
    expect(screen.queryByRole("complementary", { name: "Raw JSONL" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand raw data" }));
    expect(screen.getByRole("complementary", { name: "Raw JSONL" })).toBeInTheDocument();

    const observer = MockResizeObserver.instances[0];
    unmount();
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("forwards copy actions for a selected parse-error record", () => {
    const selection: AgentDetailSelection = { kind: "record", recordId: "record-3" };
    const { callbacks } = renderView(
      { detailSelection: selection },
      { selectedPath: null, focusedPath: null },
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy raw line" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy error" }));

    expect(callbacks.onCopyRawLine).toHaveBeenCalledWith(records[2]);
    expect(callbacks.copyError).toHaveBeenCalledWith(records[2]);
  });

  it("shows the role and record linked from a conversation selection", () => {
    renderView(
      {
        detailSelection: {
          kind: "conversation",
          id: "conversation-1",
          recordId: "record-2",
        },
      },
      { selectedPath: null, focusedPath: null },
    );

    expect(screen.getAllByText("User").length).toBeGreaterThan(1);
    expect(screen.getByRole("complementary", { name: "Raw JSONL" })).toHaveTextContent(
      "User message",
    );
  });

  it("loads the raw line on demand when its record is unavailable", async () => {
    const readRawLine = vi.fn().mockResolvedValue(rawLines[2]);
    renderView(
      {
        detailSelection: { kind: "event", id: "event-3", recordId: "record-3" },
        recordsById: new Map([
          ["record-1", records[0]!],
          ["record-2", records[1]!],
        ]),
        readRawLine,
      },
      { selectedPath: null, focusedPath: null },
    );

    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Raw JSONL" })).toHaveTextContent(
        "not json",
      ),
    );
    expect(readRawLine).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: "Copy raw line" })).not.toBeInTheDocument();
  });

  it("renders a minimal empty session without browser resize support", () => {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    const emptySession: AgentSession = {
      fileType: "Claude Code",
      meta: { eventCount: 0, turnCount: 0 },
      events: [],
      parseWarnings: [],
    };
    renderView(
      { session: emptySession, recordsById: new Map() },
      { selectedPath: null, focusedPath: null },
    );

    expect(screen.getByText("No conversation items in this session")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Raw JSONL" })).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-panel-group-direction="horizontal"]'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
  });
});
