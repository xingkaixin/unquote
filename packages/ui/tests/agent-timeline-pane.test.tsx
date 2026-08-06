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
    onSelectEvent: (eventId: string) => void;
  }> = {},
) => {
  const onSelectEvent = overrides.onSelectEvent ?? vi.fn();
  const view = render(
    <I18nProvider>
      <AgentTimelinePane
        events={events}
        highlightedRecordId={overrides.highlightedRecordId}
        onSelectEvent={onSelectEvent}
      />
    </I18nProvider>,
  );
  return { onSelectEvent, ...view };
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
    expect(buttons[2]).toHaveClass("bg-accent-soft");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(buttons[0]!);
    expect(onSelectEvent).toHaveBeenCalledWith("event-0");
  });

  it("leads with the category, then the envelope type and line meta", () => {
    renderPane([{ ...buildEvent(0), preview: "a preview line", turnIndex: 2 }]);

    // dc:587 orders the row `category · type` so the column scans by kind, and
    // the accessible name has to carry the same order (WCAG 2.5.3).
    const [row] = timelineButtons();
    expect(row).toHaveTextContent(/^assistant· Event 0Line 1 · Turn 2$/);
    expect(row).toHaveAccessibleName("Timeline: assistant · Event 0");
    expect(screen.queryByText("a preview line")).not.toBeInTheDocument();
  });

  it("names the turn in the header only when the first event carries one", () => {
    const { unmount } = renderPane([buildEvent(0)]);
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.queryByText("· Turn 1")).not.toBeInTheDocument();
    unmount();

    renderPane([{ ...buildEvent(0), turnIndex: 1 }]);
    expect(screen.getByText("· Turn 1")).toBeInTheDocument();
  });

  it("windows the rendered rows once events exceed the virtualization threshold", () => {
    const total = timelineVirtualizationThreshold + 340;
    const events = Array.from({ length: total }, (_, index) => buildEvent(index));
    renderPane(events);

    const buttons = timelineButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThan(total);
    expect(screen.getByText("· Event 0")).toBeInTheDocument();
    expect(screen.queryByText(`· Event ${total - 1}`)).not.toBeInTheDocument();
  });

  it("selects a windowed row and reports the highlighted event as pressed", () => {
    const total = timelineVirtualizationThreshold + 40;
    const events = Array.from({ length: total }, (_, index) => buildEvent(index));
    const { onSelectEvent } = renderPane(events, { highlightedRecordId: "record-1" });

    const buttons = timelineButtons();
    const highlighted = screen.getByLabelText("Timeline: assistant · Event 1");
    expect(highlighted).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(buttons[0]!);
    expect(onSelectEvent).toHaveBeenCalled();
  });
});
