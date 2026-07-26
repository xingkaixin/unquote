import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentConversationPane,
  conversationVirtualizationThreshold,
} from "../src/components/agent-conversation-pane";
import { I18nProvider } from "../src/i18n/context";
import type { AgentConversationEntry, AgentDetailSelection } from "../src/lib/agent-session";

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

const renderPane = (
  entries: AgentConversationEntry[],
  overrides: Partial<{
    selectedConversationId: string | undefined;
    detailSelection: AgentDetailSelection | null;
    onSelectItem: (itemId: string) => void;
  }> = {},
) => {
  const onSelectItem = overrides.onSelectItem ?? vi.fn();
  const { rerender } = render(
    <I18nProvider>
      <AgentConversationPane
        entries={entries}
        selectedConversationId={overrides.selectedConversationId}
        detailSelection={overrides.detailSelection ?? null}
        onSelectItem={onSelectItem}
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
          selectedConversationId={next.selectedConversationId}
          detailSelection={next.detailSelection ?? null}
          onSelectItem={onSelectItem}
        />
      </I18nProvider>,
    );
  };

  return { onSelectItem, rerenderWith };
};

const conversationButtons = () => screen.getAllByRole("button", { name: /^Conversation:/ });

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
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(buttons[0]!);
    expect(onSelectItem).toHaveBeenCalledWith("item-0");
  });

  it("styles Tool Result content as code without treating plain text as code", () => {
    renderPane([
      buildEntry(0, { type: "text", text: "Plain response" }),
      buildEntry(1, {
        type: "tool_result",
        text: '{"ok":true}',
        status: "completed",
      }),
    ]);

    expect(screen.getByText("Plain response")).toHaveClass("font-sans");
    expect(screen.getByText('{"ok":true}')).toHaveClass("font-mono");
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
  });

  it("selects a windowed item and reports it as pressed", () => {
    const total = conversationVirtualizationThreshold + 40;
    const entries = Array.from({ length: total }, (_, index) => buildEntry(index));
    const { onSelectItem } = renderPane(entries, { selectedConversationId: "item-1" });

    const pressedButtons = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressedButtons).toHaveLength(1);

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
