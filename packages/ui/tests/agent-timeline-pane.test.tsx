import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTimelinePane,
  timelineVirtualizationThreshold,
} from "../src/components/agent-timeline-pane";
import { I18nProvider } from "../src/i18n/context";
import type { AgentTimelineEvent } from "../src/lib/agent-session";

const scrollViewportHeight = 600;
const measuredRowHeight = 54;

const buildEvent = (index: number): AgentTimelineEvent => ({
  id: `event-${index}`,
  recordId: `record-${index}`,
  lineNumber: index + 1,
  category: "assistant",
  kind: "message",
  label: `Event ${index}`,
  preview: "",
  conversationItems: [],
});

const renderPane = (
  events: AgentTimelineEvent[],
  overrides: Partial<{
    highlightedRecordId: string | undefined;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onSelectEvent: (eventId: string) => void;
  }> = {},
) => {
  const onSelectEvent = overrides.onSelectEvent ?? vi.fn();
  const onToggleCollapsed = overrides.onToggleCollapsed ?? vi.fn();
  render(
    <I18nProvider>
      <AgentTimelinePane
        events={events}
        highlightedRecordId={overrides.highlightedRecordId}
        collapsed={overrides.collapsed ?? false}
        onToggleCollapsed={onToggleCollapsed}
        onSelectEvent={onSelectEvent}
      />
    </I18nProvider>,
  );
  return { onSelectEvent, onToggleCollapsed };
};

const timelineButtons = () => screen.getAllByRole("button", { name: /^Timeline:/ });

// jsdom has no layout engine: the virtualizer reads the scroll container's
// offsetHeight for its viewport size and each row's getBoundingClientRect
// for its measured size, both of which default to 0 without this stub.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(scrollViewportHeight);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: measuredRowHeight,
    top: 0,
    left: 0,
    right: 400,
    bottom: measuredRowHeight,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AgentTimelinePane", () => {
  it("renders every event without virtualizing below the threshold", () => {
    const events = Array.from({ length: 5 }, (_, index) => buildEvent(index));
    const { onSelectEvent } = renderPane(events, { highlightedRecordId: "record-2" });

    const buttons = timelineButtons();
    expect(buttons).toHaveLength(5);
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[2]).toHaveClass("bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(buttons[0]!);
    expect(onSelectEvent).toHaveBeenCalledWith("event-0");
  });

  it("triggers the collapse toggle", () => {
    const { onToggleCollapsed } = renderPane([buildEvent(0)]);
    fireEvent.click(screen.getByLabelText("Collapse timeline"));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("windows the rendered rows once events exceed the virtualization threshold", () => {
    const total = timelineVirtualizationThreshold + 340;
    const events = Array.from({ length: total }, (_, index) => buildEvent(index));
    renderPane(events);

    const buttons = timelineButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(total);
    expect(screen.getByText("Event 0")).toBeInTheDocument();
    expect(screen.queryByText(`Event ${total - 1}`)).not.toBeInTheDocument();
  });

  it("selects a windowed row and reports the highlighted event as pressed", () => {
    const total = timelineVirtualizationThreshold + 40;
    const events = Array.from({ length: total }, (_, index) => buildEvent(index));
    const { onSelectEvent } = renderPane(events, { highlightedRecordId: "record-1" });

    const buttons = timelineButtons();
    const highlighted = screen.getByLabelText("Timeline: Event 1");
    expect(highlighted).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(buttons[0]!);
    expect(onSelectEvent).toHaveBeenCalled();
  });
});
