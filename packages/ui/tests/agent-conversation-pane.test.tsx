import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentConversationPane,
  conversationVirtualizationThreshold,
} from "../src/components/agent-conversation-pane";
import { I18nProvider } from "../src/i18n/context";
import { createAgentSessionModel } from "../src/lib/agent-session";
import type {
  AgentConversationEntry,
  AgentDetailSelection,
  AgentSession,
} from "../src/lib/agent-session";

const measuredRowHeight = 96;
const containerTop = 40;

const buildEntry = (
  index: number,
  block?: AgentConversationEntry["item"]["block"],
): AgentConversationEntry => ({
  item: {
    id: `item-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    ...(block ? { block } : {}),
  },
  event: {
    id: `event-${index}`,
    recordId: `record-${index}`,
    lineNumber: index + 1,
    category: "assistant",
    kind: "message",
    label: `Event ${index}`,
    preview: "",
    conversationItems: [],
  },
});

// The pane reads tool status and tool names through the model, so the entries
// it renders must be the ones the model indexed.
const modelFor = (entries: AgentConversationEntry[]) => {
  const session: AgentSession = {
    fileType: "Codex",
    meta: {},
    events: entries.map(({ item, event }) => ({
      ...event,
      conversationItems: [item],
      ...(item.block?.type === "tool_use"
        ? {
            sessionEvidence: [
              {
                kind: "tool-lifecycle" as const,
                phase: "call" as const,
                toolName: "shell",
                callId: "call-1",
                conversationItemId: item.id,
              },
            ],
          }
        : item.block?.type === "tool_result"
          ? {
              sessionEvidence: [
                {
                  kind: "tool-lifecycle" as const,
                  phase: "result" as const,
                  status: item.block.text.includes("total 0")
                    ? ("failed" as const)
                    : ("completed" as const),
                  callId: "call-1",
                  conversationItemId: item.id,
                },
              ],
            }
          : {}),
    })),
    parseWarnings: [],
    parseWarningCount: 0,
  };
  return createAgentSessionModel(session);
};

const renderPane = (
  entries: AgentConversationEntry[],
  overrides: Partial<{
    selectedConversationId: string | undefined;
    detailSelection: AgentDetailSelection | null;
    onSelectItem: (itemId: string) => void;
    onOpenRecord: (recordId: string) => void;
  }> = {},
) => {
  const onSelectItem = overrides.onSelectItem ?? vi.fn();
  const onOpenRecord = overrides.onOpenRecord ?? vi.fn();
  const model = modelFor(entries);
  const { rerender } = render(
    <I18nProvider>
      <AgentConversationPane
        entries={entries}
        model={model}
        selectedConversationId={overrides.selectedConversationId}
        detailSelection={overrides.detailSelection ?? null}
        onSelectItem={onSelectItem}
        onOpenRecord={onOpenRecord}
      />
    </I18nProvider>,
  );

  const rerenderWith = (
    next: Partial<{
      entries: AgentConversationEntry[];
      selectedConversationId: string | undefined;
      detailSelection: AgentDetailSelection | null;
    }>,
  ) => {
    rerender(
      <I18nProvider>
        <AgentConversationPane
          entries={next.entries ?? entries}
          model={model}
          selectedConversationId={next.selectedConversationId}
          detailSelection={next.detailSelection ?? null}
          onSelectItem={onSelectItem}
          onOpenRecord={onOpenRecord}
        />
      </I18nProvider>,
    );
  };

  return { onSelectItem, onOpenRecord, rerenderWith };
};

const conversationButtons = () => screen.getAllByRole("button", { name: /^Conversation:/ });
const conversationItem = (button: HTMLElement) => button.closest<HTMLElement>("[role='listitem']")!;

let offsetHeightSpy: ReturnType<typeof vi.spyOn>;

// jsdom has no layout engine: useWindowVirtualizer reads window.innerHeight for
// its viewport (non-zero by default in jsdom). The default measureElement
// reads each row's offsetHeight, and the scroll-margin layout effect reads
// the list container's getBoundingClientRect().top — both default to 0
// without these stubs.
beforeEach(() => {
  offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(measuredRowHeight);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: measuredRowHeight,
    top: containerTop,
    left: 0,
    right: 400,
    bottom: containerTop + measuredRowHeight,
    x: 0,
    y: containerTop,
    toJSON: () => {},
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AgentConversationPane", () => {
  it("renders the empty state", () => {
    renderPane([]);
    expect(screen.getByText("No conversation items in this session")).toBeInTheDocument();
  });

  it("renders every item without virtualizing below the threshold", () => {
    const entries = Array.from({ length: 5 }, (_, index) => buildEntry(index));
    const { onSelectItem } = renderPane(entries, { selectedConversationId: "item-2" });

    const buttons = conversationButtons();
    expect(buttons).toHaveLength(5);
    expect(screen.getByRole("list", { name: "Conversation" })).toBeInTheDocument();
    expect(conversationItem(buttons[2]!)).toHaveAttribute("aria-current", "true");
    expect(conversationItem(buttons[0]!)).not.toHaveAttribute("aria-current");
    expect(conversationItem(buttons[2]!)).not.toHaveAttribute("aria-setsize");

    fireEvent.click(buttons[0]!);
    expect(onSelectItem).toHaveBeenCalledWith("item-0");
  });

  it("opens the underlying record from every turn header", () => {
    const entries = [
      buildEntry(0, { type: "text", text: "Plain response" }),
      buildEntry(1, { type: "tool_result", text: '{"ok":true}' }),
    ];
    const { onOpenRecord } = renderPane(entries);

    const openButtons = screen.getAllByRole("button", { name: "View in JSONL" });
    expect(openButtons).toHaveLength(2);

    fireEvent.click(openButtons[1]!);
    expect(onOpenRecord).toHaveBeenCalledWith("record-1");
  });

  it("renders a text turn as prose and a tool turn as a collapsed card", () => {
    const entries = [
      buildEntry(0, { type: "text", text: "Plain response" }),
      buildEntry(1, {
        type: "tool_use",
        text: '{"cmd":"ls -la"}',
      }),
    ];
    renderPane(entries);

    expect(screen.getByText("Plain response")).toBeInTheDocument();
    expect(screen.getByText("shell")).toBeInTheDocument();
    // Unpaired call: the status is never guessed as done.
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("cmd")).not.toBeInTheDocument();
  });

  it("expands the selected tool card into a field table", () => {
    const entries = [
      buildEntry(1, {
        type: "tool_use",
        text: '{"cmd":"ls -la","timeout":30}',
      }),
    ];
    renderPane(entries, { selectedConversationId: "item-1" });

    expect(screen.getByText("cmd")).toBeInTheDocument();
    expect(screen.getByText("ls -la")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("bounds deeply nested field values when a tool card expands", () => {
    const nestedValue = `${"[".repeat(2_000)}"ok"${"]".repeat(2_000)}`;
    const entries = [
      buildEntry(1, {
        type: "tool_use",
        text: `{"payload":${nestedValue}}`,
      }),
    ];

    renderPane(entries, { selectedConversationId: "item-1" });

    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(screen.getByText(/\.\.\. \[truncated\]$/)).toBeInTheDocument();
  });

  it("falls back to the raw text when the tool payload is not a JSON object", () => {
    const entries = [
      buildEntry(1, {
        type: "tool_result",
        text: "total 0\ndrwxr-xr-x  3 user",
      }),
    ];
    renderPane(entries, { selectedConversationId: "item-1" });

    expect(screen.getAllByText(/total 0/).length).toBeGreaterThan(0);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("titles a tool result with the paired call's tool name", () => {
    const entries = [
      buildEntry(0, {
        type: "tool_use",
        text: "{}",
      }),
      buildEntry(1, {
        type: "tool_result",
        text: "done",
      }),
    ];
    renderPane(entries);

    expect(screen.getByText("shell → output")).toBeInTheDocument();
    expect(screen.getAllByText("Done")).toHaveLength(2);
  });

  it("re-scrolls to the same item when it is selected again below the threshold", () => {
    const entries = Array.from({ length: 5 }, (_, index) => buildEntry(index));
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    // A click handler builds a fresh selection object per click, so reselecting
    // the same item still produces a new `detailSelection` reference — that
    // identity change (not a value change) is what re-triggers the effect.
    const firstSelection: AgentDetailSelection = {
      kind: "conversation",
      id: "item-1",
      recordId: "record-1",
    };
    const { rerenderWith } = renderPane(entries, {
      selectedConversationId: "item-1",
      detailSelection: firstSelection,
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerenderWith({ selectedConversationId: "item-1", detailSelection: firstSelection });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const secondSelection: AgentDetailSelection = {
      kind: "conversation",
      id: "item-1",
      recordId: "record-1",
    };
    rerenderWith({ selectedConversationId: "item-1", detailSelection: secondSelection });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not re-scroll when the items array is rebuilt with the same selection", () => {
    const entries = Array.from({ length: 5 }, (_, index) => buildEntry(index));
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    const selection: AgentDetailSelection = {
      kind: "conversation",
      id: "item-1",
      recordId: "record-1",
    };
    const { rerenderWith } = renderPane(entries, {
      selectedConversationId: "item-1",
      detailSelection: selection,
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerenderWith({
      entries: entries.map((entry) => ({ ...entry })),
      selectedConversationId: "item-1",
      detailSelection: selection,
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("windows the rendered rows once items exceed the virtualization threshold", () => {
    const total = conversationVirtualizationThreshold + 340;
    const entries = Array.from({ length: total }, (_, index) => buildEntry(index));
    renderPane(entries);

    const buttons = conversationButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(total);
    expect(screen.getByText("Line 1")).toBeInTheDocument();
    expect(screen.queryByText(`Line ${total}`)).not.toBeInTheDocument();
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveAttribute("aria-setsize", String(total));
      expect(item).toHaveAttribute("aria-posinset", String(Number(item.dataset.index) + 1));
    }
  });

  it("selects a windowed item and reports it as current", () => {
    const total = conversationVirtualizationThreshold + 40;
    const entries = Array.from({ length: total }, (_, index) => buildEntry(index));
    const { onSelectItem } = renderPane(entries, { selectedConversationId: "item-1" });

    const currentItems = screen
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "true");
    expect(currentItems).toHaveLength(1);

    const buttons = conversationButtons();
    fireEvent.click(buttons[0]!);
    expect(onSelectItem).toHaveBeenCalled();
  });

  it("invokes measureElement per rendered row for the dynamic-height virtualized path", () => {
    const total = conversationVirtualizationThreshold + 40;
    const entries = Array.from({ length: total }, (_, index) => buildEntry(index));
    offsetHeightSpy.mockClear();

    renderPane(entries);

    const rowCount = document.querySelectorAll("[data-index]").length;
    expect(rowCount).toBeGreaterThan(0);
    // the default measureElement reads offsetHeight once per mounted row's ref callback
    expect(offsetHeightSpy.mock.calls.length).toBeGreaterThanOrEqual(rowCount);
  });
});
