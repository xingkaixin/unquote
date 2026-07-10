import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentConversationPane,
  conversationVirtualizationThreshold,
} from "../src/components/agent-conversation-pane";
import { I18nProvider } from "../src/i18n/context";
import type { AgentConversationItem, AgentTimelineEvent } from "../src/lib/agent-session";
import type { AgentDetailSelection } from "../src/components/agent-session-view";

const measuredRowHeight = 96;
const containerTop = 40;

const buildItem = (index: number): AgentConversationItem => ({
  id: `item-${index}`,
  eventId: `event-${index}`,
  recordId: `record-${index}`,
  lineNumber: index + 1,
  role: index % 2 === 0 ? "user" : "assistant",
});

const renderPane = (
  items: AgentConversationItem[],
  overrides: Partial<{
    selectedConversationId: string | undefined;
    detailSelection: AgentDetailSelection | null;
    onSelectItem: (itemId: string, recordId: string) => void;
  }> = {},
) => {
  const onSelectItem = overrides.onSelectItem ?? vi.fn();
  const { rerender } = render(
    <I18nProvider>
      <AgentConversationPane
        items={items}
        eventById={new Map<string, AgentTimelineEvent>()}
        selectedConversationId={overrides.selectedConversationId}
        detailSelection={overrides.detailSelection ?? null}
        onSelectItem={onSelectItem}
      />
    </I18nProvider>,
  );

  const rerenderWith = (
    next: Partial<{
      items: AgentConversationItem[];
      selectedConversationId: string | undefined;
      detailSelection: AgentDetailSelection | null;
    }>,
  ) => {
    rerender(
      <I18nProvider>
        <AgentConversationPane
          items={next.items ?? items}
          eventById={new Map<string, AgentTimelineEvent>()}
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
    const items = Array.from({ length: 5 }, (_, index) => buildItem(index));
    const { onSelectItem } = renderPane(items, { selectedConversationId: "item-2" });

    const buttons = conversationButtons();
    expect(buttons).toHaveLength(5);
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(buttons[0]!);
    expect(onSelectItem).toHaveBeenCalledWith("item-0", "record-0");
  });

  it("re-scrolls to the same item when it is selected again below the threshold", () => {
    const items = Array.from({ length: 5 }, (_, index) => buildItem(index));
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
    const { rerenderWith } = renderPane(items, {
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
    const items = Array.from({ length: 5 }, (_, index) => buildItem(index));
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    const selection: AgentDetailSelection = {
      kind: "conversation",
      id: "item-1",
      recordId: "record-1",
    };
    const { rerenderWith } = renderPane(items, {
      selectedConversationId: "item-1",
      detailSelection: selection,
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerenderWith({
      items: items.map((item) => ({ ...item })),
      selectedConversationId: "item-1",
      detailSelection: selection,
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("windows the rendered rows once items exceed the virtualization threshold", () => {
    const total = conversationVirtualizationThreshold + 340;
    const items = Array.from({ length: total }, (_, index) => buildItem(index));
    renderPane(items);

    const buttons = conversationButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(total);
    expect(screen.getByText("Line 1")).toBeInTheDocument();
    expect(screen.queryByText(`Line ${total}`)).not.toBeInTheDocument();
  });

  it("selects a windowed item and reports it as pressed", () => {
    const total = conversationVirtualizationThreshold + 40;
    const items = Array.from({ length: total }, (_, index) => buildItem(index));
    const { onSelectItem } = renderPane(items, { selectedConversationId: "item-1" });

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
    const items = Array.from({ length: total }, (_, index) => buildItem(index));
    offsetHeightSpy.mockClear();

    renderPane(items);

    const rowCount = document.querySelectorAll("[data-index]").length;
    expect(rowCount).toBeGreaterThan(0);
    // the default measureElement reads offsetHeight once per mounted row's ref callback
    expect(offsetHeightSpy.mock.calls.length).toBeGreaterThanOrEqual(rowCount);
  });
});
