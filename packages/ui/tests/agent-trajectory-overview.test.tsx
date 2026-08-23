import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTrajectoryOverview } from "../src/components/agent-trajectory-overview";
import { TooltipProvider } from "../src/components/tooltip";
import { I18nProvider, useTranslation } from "../src/i18n/context";
import type { Locale } from "../src/i18n/i18n";
import { createTranslator } from "../src/i18n/i18n";
import { en } from "../src/i18n/en";
import { formatClockTime } from "../src/lib/format";
import { formatTrajectoryDuration } from "../src/components/agent-trajectory-format";
import type { AgentCanonicalSelection } from "../src/lib/agent-session/session-types";
import type {
  AgentSessionModel,
  AgentTrajectoryItem,
  AgentTrajectoryStatus,
  AgentTrajectoryTurn,
} from "../src/lib/agent-session";
import {
  createAgentTrajectoryPresentation,
  type AgentTrajectoryPresentation,
  type AgentTrajectoryTimeRange,
} from "../src/lib/agent-session/trajectory-presentation";

const translate = createTranslator(en);

const formattedTimestamp = (timestamp: number, locale: Locale = "en") =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);

const LocaleProbe = () => {
  const { setLocale } = useTranslation();
  return (
    <button type="button" onClick={() => setLocale("zh-CN")}>
      Switch to Chinese
    </button>
  );
};

const selectionFor = (id: string): AgentCanonicalSelection => ({
  kind: "event",
  id,
  recordId: `record-${id}`,
});

const itemFor = (
  id: string,
  kind: AgentTrajectoryItem["kind"],
  status: AgentTrajectoryStatus,
  timestamp: number,
): AgentTrajectoryItem =>
  ({
    id: `item-${id}`,
    kind,
    status,
    recordId: `record-${id}`,
    lineNumber: 1,
    selection: selectionFor(id),
    timestamp,
  }) as AgentTrajectoryItem;

const turnFor = (
  id: string,
  _items: readonly AgentTrajectoryItem[],
  startedAt: number,
  endedAt: number,
): AgentTrajectoryTurn => ({
  id,
  status: "completed",
  startedAt,
  endedAt,
});

const modelFor = (
  items: readonly AgentTrajectoryItem[],
  turns: readonly AgentTrajectoryTurn[] = [],
): AgentSessionModel => {
  return {
    events: [],
    conversation: [],
    integrityIssues: [],
    trajectory: {
      turns,
      items,
      warnings: [],
      stats: {
        tokenUsage: {},
      },
    },
    resolveDetail: () => null,
    selectEvent: () => null,
    selectConversation: () => null,
    selectTrajectory: () => null,
    resolveToolStatus: () => "pending",
    resolveToolName: () => undefined,
  };
};

const presentationFor = (
  items: readonly AgentTrajectoryItem[],
  turns: readonly AgentTrajectoryTurn[] = [],
) => createAgentTrajectoryPresentation(modelFor(items, turns));

const presentationForDomain = (start = 0, end = 100) =>
  presentationFor([
    itemFor("domain-start", "assistant", "completed", start),
    itemFor("domain-end", "assistant", "completed", end),
  ]);

const renderOverview = (
  presentation: AgentTrajectoryPresentation,
  timeRange: AgentTrajectoryTimeRange | null = null,
  onTimeRangeChange = vi.fn(),
  className = "",
) =>
  render(
    <I18nProvider>
      <TooltipProvider>
        <AgentTrajectoryOverview
          presentation={presentation}
          timeRange={timeRange}
          onTimeRangeChange={onTimeRangeChange}
          className={className}
        />
      </TooltipProvider>
    </I18nProvider>,
  );

const ControlledOverview = ({
  presentation,
  initialTimeRange,
  onTimeRangeChange,
}: {
  presentation: AgentTrajectoryPresentation;
  initialTimeRange: AgentTrajectoryTimeRange | null;
  onTimeRangeChange: (range: AgentTrajectoryTimeRange | null) => void;
}) => {
  const [timeRange, setTimeRange] = useState(initialTimeRange);

  return (
    <AgentTrajectoryOverview
      presentation={presentation}
      timeRange={timeRange}
      onTimeRangeChange={(range) => {
        onTimeRangeChange(range);
        setTimeRange(range);
      }}
    />
  );
};

const renderControlledOverview = (
  presentation: AgentTrajectoryPresentation,
  initialTimeRange: AgentTrajectoryTimeRange | null,
  onTimeRangeChange = vi.fn(),
) =>
  render(
    <I18nProvider>
      <TooltipProvider>
        <ControlledOverview
          presentation={presentation}
          initialTimeRange={initialTimeRange}
          onTimeRangeChange={onTimeRangeChange}
        />
      </TooltipProvider>
    </I18nProvider>,
  );

const overviewRoot = () => screen.getByRole("region", { name: translate("trajectory.overview") });

const rangeStart = () =>
  screen.getByLabelText(translate("trajectory.rangeStart")) as HTMLInputElement;

const rangeEnd = () => screen.getByLabelText(translate("trajectory.rangeEnd")) as HTMLInputElement;

const control = (key: "trajectory.zoomIn" | "trajectory.zoomOut" | "trajectory.reset") =>
  screen.getByRole("button", { name: translate(key) });

const renderWithProviders = (
  presentation: AgentTrajectoryPresentation,
  timeRange: AgentTrajectoryTimeRange | null,
  onTimeRangeChange: (range: AgentTrajectoryTimeRange | null) => void,
) => (
  <I18nProvider>
    <TooltipProvider>
      <AgentTrajectoryOverview
        presentation={presentation}
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
      />
    </TooltipProvider>
  </I18nProvider>
);

class ResizeObserverMock {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }

  disconnect() {}

  observe() {}

  unobserve() {}

  notify(width: number) {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

let resizeObservers: ResizeObserverMock[] = [];

const resizeTo = async (width: number) => {
  await waitFor(() => expect(resizeObservers.length).toBeGreaterThan(0));
  act(() => {
    for (const observer of resizeObservers) {
      observer.notify(width);
    }
  });
};

beforeEach(() => {
  resizeObservers = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AgentTrajectoryOverview", () => {
  it("preserves caller sizing in a constrained mobile container", () => {
    renderOverview(presentationForDomain(), null, vi.fn(), "shrink-0");

    expect(overviewRoot()).toHaveClass("shrink-0");
  });

  it("derives bounded buckets from ResizeObserver width changes", async () => {
    renderOverview(presentationForDomain());

    await resizeTo(360);
    expect(overviewRoot()).toHaveAttribute("data-bucket-count", "60");

    await resizeTo(60);
    expect(overviewRoot()).toHaveAttribute("data-bucket-count", "10");

    await resizeTo(10_000);
    expect(overviewRoot()).toHaveAttribute("data-bucket-count", "512");
  });

  it("allocates buckets for a time domain supplied only by turn boundaries", async () => {
    const presentation = presentationFor([], [turnFor("turn-only", [], 0, 100)]);
    renderOverview(presentation);
    await resizeTo(360);

    const root = overviewRoot();
    const turnBoundary = root.querySelector("[data-trajectory-turn-boundary]");
    expect(root).toHaveAttribute("data-bucket-count", "60");
    expect(turnBoundary).toHaveAttribute("d", expect.stringContaining("M"));
  });

  it("keeps SVG paths and total DOM bounded for large trajectories", async () => {
    const items: AgentTrajectoryItem[] = [];
    const turns: AgentTrajectoryTurn[] = [];
    for (let index = 0; index < 5_005; index += 1) {
      items.push(itemFor(`large-${index}`, "assistant", "completed", index));
    }
    for (let index = 0; index < 556; index += 1) {
      turns.push(turnFor(`turn-${index}`, [], index, index + 1));
    }

    renderOverview(presentationFor(items, turns));
    await resizeTo(10_000);

    const root = overviewRoot();
    const svg = root.querySelector("[data-trajectory-chart]");
    expect(svg).not.toBeNull();
    // Aggregated mode: 30 kind paths (per lane, kind + error, tier) + boundary.
    expect(svg?.querySelectorAll("path")).toHaveLength(31);
    expect(svg?.querySelectorAll("[data-trajectory-kind]")).toHaveLength(30);
    expect(svg?.querySelectorAll("[data-trajectory-turn-boundary]")).toHaveLength(1);
    expect(root.querySelector("[data-trajectory-spans]")).toBeNull();
    expect(root.querySelectorAll("*").length).toBeLessThanOrEqual(110);
  });

  it("zooms the viewport to the selected time range", async () => {
    const { unmount } = renderOverview(presentationForDomain(0, 100), { start: 25, end: 50 });
    await resizeTo(60);

    expect(overviewRoot()).toHaveAttribute("data-viewport-start", "25");
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "50");
    // Only the two selected-range events remain as spans in the viewport.
    expect(overviewRoot().querySelectorAll("[data-trajectory-span]")).toHaveLength(0);

    unmount();
    renderOverview(presentationForDomain(0, 100), null);
    await resizeTo(60);

    expect(overviewRoot()).toHaveAttribute("data-viewport-start", "0");
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "100");
    expect(overviewRoot().querySelectorAll("[data-trajectory-span]")).toHaveLength(2);
  });

  it("labels the viewport with an absolute start tick and relative offsets", async () => {
    const start = Date.UTC(2026, 5, 6, 10, 0, 0);
    renderOverview(presentationForDomain(start, start + 60_000));
    await resizeTo(60);

    const ticks = overviewRoot().querySelector("[data-trajectory-ticks]")!;
    expect(ticks.textContent).toContain(formatClockTime(start, "en"));
    expect(ticks.textContent).toContain(`+${formatTrajectoryDuration(30_000, "en")}`);
    expect(ticks.textContent).toContain(`+${formatTrajectoryDuration(60_000, "en")}`);
  });

  it("splits a kind into density tiers by bucket count", async () => {
    // Timestamps stay gap-free so the compressed axis leaves bucketing linear.
    const items: ReturnType<typeof itemFor>[] = [];
    for (let index = 0; index < 800; index += 1) {
      items.push(itemFor(`dense-${index}`, "assistant", "completed", index % 30));
    }
    for (let index = 0; index < 260; index += 1) {
      items.push(itemFor(`sparse-${index}`, "assistant", "completed", 30 + (index % 30)));
    }
    renderOverview(presentationFor(items));
    await resizeTo(12);

    const svg = overviewRoot().querySelector("[data-trajectory-chart]")!;
    const segmentsAt = (tier: number) =>
      svg
        .querySelector(
          `[data-trajectory-kind="model-assistant"][data-trajectory-density="${tier}"]`,
        )
        ?.getAttribute("d") ?? "";
    expect(segmentsAt(2)).toContain("M");
    expect(segmentsAt(0)).toContain("M");
    expect(segmentsAt(1)).toBe("");
  });

  it("colors event spans by kind and flags failures in red", async () => {
    const presentation = presentationFor([
      itemFor("prompt", "user", "completed", 0),
      itemFor("reply", "assistant", "completed", 10),
      itemFor("shell", "tool", "running", 20),
      itemFor("broken", "tool", "failed", 30),
      itemFor("aborted", "subagent", "aborted", 40),
    ]);
    renderOverview(presentation);
    await resizeTo(60);

    const spanFor = (ordinal: number) =>
      overviewRoot().querySelector(`[data-trajectory-span="${ordinal}"]`)!;
    expect(overviewRoot().querySelectorAll("[data-trajectory-span]")).toHaveLength(5);
    expect(spanFor(0).className).toContain("bg-code-boolean");
    expect(spanFor(1).className).toContain("bg-code-string");
    expect(spanFor(2).className).toContain("bg-accent");
    expect(spanFor(3).className).toContain("bg-error");
    expect(spanFor(4).className).toContain("bg-error");
    expect(screen.getByText(translate("trajectory.kind.user"))).toBeInTheDocument();
    expect(screen.getByText(translate("trajectory.kind.assistant"))).toBeInTheDocument();
    expect(
      screen.getByText(
        `${translate("trajectory.status.failed")} / ${translate("trajectory.status.aborted")}`,
      ),
    ).toBeInTheDocument();
  });

  it("selects an event span on click and marks the current one", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    const presentation = presentationFor([
      itemFor("prompt", "user", "completed", 0),
      itemFor("reply", "assistant", "completed", 10),
    ]);
    render(
      <I18nProvider>
        <TooltipProvider>
          <AgentTrajectoryOverview
            presentation={presentation}
            timeRange={null}
            onTimeRangeChange={vi.fn()}
            selectedItemId="item-reply"
            onSelectItem={onSelectItem}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    await resizeTo(60);

    const spans = overviewRoot().querySelectorAll("[data-trajectory-span]");
    expect(spans[1]).toHaveAttribute("aria-current", "true");
    expect(spans[0]).not.toHaveAttribute("aria-current");

    await user.click(spans[0] as HTMLElement);
    expect(onSelectItem).toHaveBeenCalledWith("item-prompt");
  });

  it("collapses a long idle stretch into a labeled gap marker", async () => {
    const presentation = presentationFor([
      itemFor("burst-start", "assistant", "completed", 0),
      itemFor("burst-end", "assistant", "completed", 60_000),
      itemFor("late", "assistant", "completed", 36_060_000),
    ]);
    renderOverview(presentation);
    await resizeTo(360);

    const gap = overviewRoot().querySelector('[data-trajectory-gap="0"]') as HTMLElement;
    expect(gap).not.toBeNull();
    expect(gap.title).toBe(`Idle ${formatTrajectoryDuration(36_000_000, "en")}`);
    // Active clusters keep most of the width: the last span sits at ~97%.
    const late = overviewRoot().querySelector('[data-trajectory-span="2"]') as HTMLElement;
    expect(Number.parseFloat(late.style.left)).toBeGreaterThan(90);
  });

  it("keeps a gap-free session without gap markers", async () => {
    renderOverview(presentationForDomain(0, 100));
    await resizeTo(360);

    expect(overviewRoot().querySelector("[data-trajectory-gap]")).toBeNull();
  });

  it("falls back to aggregated buckets above the span limit", async () => {
    const items: ReturnType<typeof itemFor>[] = [];
    for (let index = 0; index < 1001; index += 1) {
      items.push(itemFor(`bulk-${index}`, "assistant", "completed", index));
    }
    renderOverview(presentationFor(items));
    await resizeTo(360);

    expect(overviewRoot().querySelector("[data-trajectory-spans]")).toBeNull();
    expect(
      overviewRoot().querySelectorAll('[data-trajectory-kind="model-assistant"]').length,
    ).toBeGreaterThan(0);
  });

  it("combines controlled range inputs and clamps their boundaries", async () => {
    const onTimeRangeChange = vi.fn();
    const user = userEvent.setup();
    renderControlledOverview(presentationForDomain(), { start: 20, end: 80 }, onTimeRangeChange);
    await resizeTo(360);

    await user.click(rangeStart());
    fireEvent.change(rangeStart(), { target: { value: "90" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 80, end: 80 });
    expect(rangeStart()).toHaveValue("80");

    await user.click(rangeEnd());
    fireEvent.change(rangeEnd(), { target: { value: "10" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 80, end: 80 });
    expect(rangeEnd()).toHaveValue("80");
  });

  it("derives usable keyboard steps and visible localized values from an epoch domain", async () => {
    const domainStart = Date.UTC(2026, 5, 6, 10, 0, 0);
    const domainEnd = domainStart + 60 * 60 * 1000;
    renderOverview(presentationForDomain(domainStart, domainEnd));
    await resizeTo(360);

    expect(Number(rangeStart().step)).toBe(36_000);
    expect(rangeStart()).toHaveAttribute("aria-valuetext", formattedTimestamp(domainStart));
    expect(rangeEnd()).toHaveAttribute("aria-valuetext", formattedTimestamp(domainEnd));
    expect(screen.getByText(formattedTimestamp(domainStart))).toBeInTheDocument();
    expect(screen.getByText(formattedTimestamp(domainEnd))).toBeInTheDocument();
  });

  it("keeps dates distinguishable in range values that cross multiple local days", async () => {
    const domainStart = Date.UTC(2026, 5, 6, 23, 30, 0);
    const domainEnd = domainStart + 48 * 60 * 60 * 1000;
    const startText = formattedTimestamp(domainStart);
    const endText = formattedTimestamp(domainEnd);
    renderOverview(presentationForDomain(domainStart, domainEnd));
    await resizeTo(360);

    expect(startText).not.toBe(endText);
    expect(rangeStart()).toHaveAttribute("aria-valuetext", startText);
    expect(rangeEnd()).toHaveAttribute("aria-valuetext", endText);
    expect(screen.getByText(startText)).toBeInTheDocument();
    expect(screen.getByText(endText)).toBeInTheDocument();
  });

  it("derives a positive finite step for a single-point expanded domain", async () => {
    const timestamp = Date.UTC(2026, 5, 6, 10, 0, 0);
    const presentation = presentationFor([
      itemFor("single-point", "assistant", "completed", timestamp),
    ]);
    renderOverview(presentation);
    await resizeTo(360);

    expect(presentation.timeDomain).toEqual({ start: timestamp, end: timestamp + 1 });
    expect(Number(rangeStart().step)).toBe(0.01);
    expect(Number(rangeEnd().step)).toBe(0.01);
  });

  it.each([
    ["huge", -1e300, 1e300, 2e298],
    ["subnormal", 0, Number.MIN_VALUE, Number.MIN_VALUE],
  ] as const)(
    "derives a finite positive step for a %s finite span",
    async (_, start, end, step) => {
      renderOverview(presentationForDomain(start, end));
      await resizeTo(360);

      expect(Number.isFinite(Number(rangeStart().step))).toBe(true);
      expect(Number(rangeStart().step) / step).toBeCloseTo(1, 12);
      expect(Number(rangeEnd().step) / step).toBeCloseTo(1, 12);
    },
  );

  it("uses the configured finite step for an ArrowRight range increment", async () => {
    const domainStart = Date.UTC(2026, 5, 6, 10, 0, 0);
    const domainEnd = domainStart + 60 * 60 * 1000;
    const onTimeRangeChange = vi.fn();
    const user = userEvent.setup();
    renderControlledOverview(
      presentationForDomain(domainStart, domainEnd),
      null,
      onTimeRangeChange,
    );
    await resizeTo(360);

    const input = rangeStart();
    const before = Number(input.value);
    input.focus();
    // Base UI handles Arrow keys itself, so one press moves exactly one step.
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(input);

    expect(onTimeRangeChange).toHaveBeenLastCalledWith({
      start: domainStart + before + Number(input.step),
      end: domainEnd,
    });
  });

  it.each([
    ["microsecond epoch", Date.UTC(2026, 5, 6, 10, 0, 0), Date.UTC(2026, 5, 6, 10, 0, 0) + 0.001],
    ["large narrow", 1e16, 1e16 + 2],
  ] as const)(
    "advances a %s range through native stepUp and controlled change",
    async (_, start, end) => {
      const onTimeRangeChange = vi.fn();
      renderControlledOverview(presentationForDomain(start, end), null, onTimeRangeChange);
      await resizeTo(360);

      const input = rangeStart();
      const before = Number(input.value);
      expect(input).toHaveAttribute("min", "0");
      expect(Number(input.max)).toBe(end - start);
      input.stepUp();
      const after = Number(input.value);
      fireEvent.change(input, { target: { value: input.value } });

      expect(after).toBeGreaterThan(before);
      expect(after).toBeLessThanOrEqual(end - start);
      expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: start + after, end });
      expect(Number(rangeStart().value)).toBe(after);
    },
  );

  it.each([
    ["microsecond epoch", Date.UTC(2026, 5, 6, 10, 0, 0), Date.UTC(2026, 5, 6, 10, 0, 0) + 0.001],
    ["large narrow", 1e16, 1e16 + 2],
  ] as const)("retreats a %s end range through native stepDown", async (_, start, end) => {
    const onTimeRangeChange = vi.fn();
    renderControlledOverview(presentationForDomain(start, end), null, onTimeRangeChange);
    await resizeTo(360);

    const input = rangeEnd();
    const before = Number(input.value);
    input.stepDown();
    const after = Number(input.value);
    fireEvent.change(input, { target: { value: input.value } });

    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start, end: start + after });
    expect(Number(rangeEnd().value)).toBe(after);
  });

  it.each([
    ["shifted positive", 200, 300, 220, 280, 20, 80],
    ["negative", -300, -200, -280, -220, 20, 80],
    ["cross-zero", -50, 50, -20, 30, 30, 80],
  ] as const)(
    "projects a %s controlled absolute range into finite offset coordinates",
    async (_, domainStart, domainEnd, selectedStart, selectedEnd, startOffset, endOffset) => {
      const onTimeRangeChange = vi.fn();
      renderControlledOverview(
        presentationForDomain(domainStart, domainEnd),
        { start: selectedStart, end: selectedEnd },
        onTimeRangeChange,
      );
      await resizeTo(360);

      expect(rangeStart()).toHaveAttribute("min", "0");
      expect(Number(rangeStart().max)).toBe(domainEnd - domainStart);
      expect(Number(rangeStart().value)).toBe(startOffset);
      expect(Number(rangeEnd().value)).toBe(endOffset);

      rangeStart().stepUp();
      const nextOffset = Number(rangeStart().value);
      fireEvent.change(rangeStart(), { target: { value: rangeStart().value } });

      expect(onTimeRangeChange).toHaveBeenLastCalledWith({
        start: domainStart + nextOffset,
        end: selectedEnd,
      });
    },
  );

  it("snaps normalized input coordinates and clamps them to the paired boundary", async () => {
    const onTimeRangeChange = vi.fn();
    renderControlledOverview(
      presentationForDomain(200, 300),
      { start: 210, end: 290 },
      onTimeRangeChange,
    );
    await resizeTo(360);

    fireEvent.change(rangeStart(), { target: { value: "20.49" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 220, end: 290 });

    fireEvent.change(rangeStart(), { target: { value: "99" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 290, end: 290 });

    fireEvent.change(rangeEnd(), { target: { value: "0.49" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 290, end: 290 });
  });

  it("uses a finite ratio coordinate for an overflowing domain in both directions", async () => {
    const domainStart = -Number.MAX_VALUE;
    const domainEnd = Number.MAX_VALUE;
    const onTimeRangeChange = vi.fn();
    renderControlledOverview(
      presentationForDomain(domainStart, domainEnd),
      null,
      onTimeRangeChange,
    );
    await resizeTo(360);

    expect(rangeStart()).toHaveAttribute("min", "0");
    expect(rangeStart()).toHaveAttribute("max", "1");
    expect(rangeStart()).toHaveAttribute("step", "0.01");
    expect(rangeStart()).toHaveValue("0");
    expect(rangeEnd()).toHaveValue("1");

    rangeStart().stepUp();
    const startCoordinate = Number(rangeStart().value);
    fireEvent.change(rangeStart(), { target: { value: rangeStart().value } });
    const advanced = onTimeRangeChange.mock.lastCall?.[0] as AgentTrajectoryTimeRange;
    expect(advanced.start).toBeGreaterThan(domainStart);
    expect(Number.isFinite(advanced.start)).toBe(true);
    expect(advanced.end).toBe(domainEnd);
    expect(Number(rangeStart().value)).toBeCloseTo(startCoordinate, 12);

    rangeEnd().stepDown();
    const endCoordinate = Number(rangeEnd().value);
    fireEvent.change(rangeEnd(), { target: { value: rangeEnd().value } });
    const retreated = onTimeRangeChange.mock.lastCall?.[0] as AgentTrajectoryTimeRange;
    expect(retreated.start).toBe(advanced.start);
    expect(retreated.end).toBeLessThan(domainEnd);
    expect(Number.isFinite(retreated.end)).toBe(true);
    expect(retreated.end).toBeGreaterThan(retreated.start);
    expect(Number(rangeEnd().value)).toBeCloseTo(endCoordinate, 12);
  });

  it.each(["en", "zh-CN", "ja"] as const)(
    "distinguishes sub-millisecond values in %s visible and assistive text",
    async (locale) => {
      const start = Date.UTC(2026, 5, 6, 10, 0, 0);
      const end = start + 0.5;
      const offsetFormatter = new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "millisecond",
        unitDisplay: "short",
        signDisplay: "always",
        notation: "standard",
        maximumSignificantDigits: 15,
      });
      localStorage.setItem("unquote-locale", locale);
      renderOverview(presentationForDomain(start, end));
      await resizeTo(360);

      const rangeInputs = screen.getAllByRole("slider") as HTMLInputElement[];
      const startText = rangeInputs[0]!.getAttribute("aria-valuetext") ?? "";
      const endText = rangeInputs[1]!.getAttribute("aria-valuetext") ?? "";

      expect(startText).toMatch(/\.\d{3}/);
      expect(endText).toMatch(/\.\d{3}/);
      expect(endText).toContain(offsetFormatter.format(0.5));
      expect(startText).not.toBe(endText);
      expect(screen.getByText(startText)).toBeInTheDocument();
      expect(screen.getByText(endText)).toBeInTheDocument();
    },
  );

  it.each([
    ["en", "positive adjacent", 1e16, 1e16 + 2],
    ["en", "negative adjacent", -1e16, -1e16 + 2],
    ["en", "huge", 1e300, 1.1e300],
    ["zh-CN", "positive adjacent", 1e16, 1e16 + 2],
    ["zh-CN", "negative adjacent", -1e16, -1e16 + 2],
    ["zh-CN", "huge", 1e300, 1.1e300],
    ["ja", "positive adjacent", 1e16, 1e16 + 2],
    ["ja", "negative adjacent", -1e16, -1e16 + 2],
    ["ja", "huge", 1e300, 1.1e300],
  ] as const)(
    "keeps %s %s invalid-Date values distinct and bounded",
    async (locale, _, start, end) => {
      localStorage.setItem("unquote-locale", locale);
      renderOverview(presentationForDomain(start, end));
      await resizeTo(360);

      const rangeInputs = screen.getAllByRole("slider") as HTMLInputElement[];
      const startText = rangeInputs[0]!.getAttribute("aria-valuetext") ?? "";
      const endText = rangeInputs[1]!.getAttribute("aria-valuetext") ?? "";

      expect(startText).not.toBe(endText);
      expect(startText).toContain("E");
      expect(endText).toContain("E");
      expect(Math.max(startText.length, endText.length)).toBeLessThanOrEqual(80);
      // The viewport tick may legitimately repeat the same fallback text.
      expect(screen.getAllByText(startText).length).toBeGreaterThan(0);
      expect(screen.getAllByText(endText).length).toBeGreaterThan(0);
    },
  );

  it("updates range values and their assistive text when the locale changes", async () => {
    const domainStart = Date.UTC(2026, 5, 6, 10, 0, 0);
    const domainEnd = domainStart + 60 * 60 * 1000;
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <TooltipProvider>
          <LocaleProbe />
          <AgentTrajectoryOverview
            presentation={presentationForDomain(domainStart, domainEnd)}
            timeRange={null}
            onTimeRangeChange={vi.fn()}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    await resizeTo(360);

    const input = rangeStart();
    expect(input).toHaveAttribute("aria-valuetext", formattedTimestamp(domainStart));

    await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    const chineseTimestamp = formattedTimestamp(domainStart, "zh-CN");
    expect(input).toHaveAttribute("aria-valuetext", chineseTimestamp);
    expect(screen.getByText(chineseTimestamp)).toBeInTheDocument();
  });

  it("zooms by narrowing the selected range and clears it on reset", async () => {
    const onTimeRangeChange = vi.fn();
    const user = userEvent.setup();
    renderControlledOverview(presentationForDomain(), { start: 20, end: 80 }, onTimeRangeChange);
    await resizeTo(360);

    expect(overviewRoot()).toHaveAttribute("data-viewport-start", "20");
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "80");
    expect(rangeStart()).toHaveValue("20");
    expect(rangeEnd()).toHaveValue("80");

    await user.click(control("trajectory.zoomIn"));
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 35, end: 65 });
    await waitFor(() => expect(overviewRoot()).toHaveAttribute("data-viewport-start", "35"));
    expect(rangeStart()).toHaveValue("35");
    expect(rangeEnd()).toHaveValue("65");

    fireEvent.change(rangeStart(), { target: { value: "10" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 10, end: 65 });
    await waitFor(() => expect(overviewRoot()).toHaveAttribute("data-viewport-start", "10"));

    // Zooming out past the domain clears the range entirely.
    await user.click(control("trajectory.zoomOut"));
    expect(onTimeRangeChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(overviewRoot()).toHaveAttribute("data-viewport-start", "0"));
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "100");

    fireEvent.change(rangeEnd(), { target: { value: "40" } });
    expect(onTimeRangeChange).toHaveBeenLastCalledWith({ start: 0, end: 40 });
    await user.click(control("trajectory.reset"));
    expect(onTimeRangeChange).toHaveBeenLastCalledWith(null);
  });

  it("resets its local viewport safely when the presentation domain changes", async () => {
    const first = presentationForDomain(0, 100);
    const second = presentationForDomain(200, 300);
    const onTimeRangeChange = vi.fn();
    const { rerender } = render(renderWithProviders(first, null, onTimeRangeChange));
    await resizeTo(360);

    rerender(renderWithProviders(second, null, onTimeRangeChange));
    await waitFor(() => expect(rangeStart()).toHaveAttribute("min", "0"));
    expect(rangeEnd()).toHaveAttribute("max", "100");
  });

  it("derives the viewport purely from the selected range across presentations", async () => {
    const first = presentationForDomain(0, 100);
    const second = presentationForDomain(0, 100);
    const onTimeRangeChange = vi.fn();
    const { rerender } = render(
      renderWithProviders(first, { start: 20, end: 80 }, onTimeRangeChange),
    );
    await resizeTo(360);

    expect(overviewRoot()).toHaveAttribute("data-viewport-start", "20");
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "80");

    // No component-local zoom state: a new presentation identity with the
    // same selected range keeps the same viewport.
    rerender(renderWithProviders(second, { start: 20, end: 80 }, onTimeRangeChange));
    expect(overviewRoot()).toHaveAttribute("data-viewport-start", "20");
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "80");

    rerender(renderWithProviders(second, null, onTimeRangeChange));
    await waitFor(() => expect(overviewRoot()).toHaveAttribute("data-viewport-start", "0"));
    expect(overviewRoot()).toHaveAttribute("data-viewport-end", "100");
  });

  it("starts measuring when a time domain appears after an empty presentation", async () => {
    const onTimeRangeChange = vi.fn();
    const { rerender } = render(renderWithProviders(presentationFor([]), null, onTimeRangeChange));

    rerender(renderWithProviders(presentationForDomain(), null, onTimeRangeChange));
    await resizeTo(360);

    expect(overviewRoot()).toHaveAttribute("data-bucket-count", "60");
  });

  it("disables timeline controls and explains the empty time domain", () => {
    renderOverview(presentationFor([]));

    expect(screen.getByText(translate("trajectory.noTimeline"))).toBeInTheDocument();
    expect(rangeStart()).toBeDisabled();
    expect(rangeEnd()).toBeDisabled();
    expect(control("trajectory.zoomIn")).toBeDisabled();
    expect(control("trajectory.zoomOut")).toBeDisabled();
    expect(control("trajectory.reset")).toBeDisabled();
  });

  it("hides the SVG from assistive technology while naming controls and lanes", async () => {
    renderOverview(presentationForDomain());
    await resizeTo(360);

    const svg = overviewRoot().querySelector("[data-trajectory-chart]");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
    expect(control("trajectory.zoomIn")).toBeInTheDocument();
    expect(rangeStart()).toBeInTheDocument();
    expect(rangeEnd()).toBeInTheDocument();
    expect(screen.getByText(translate("trajectory.lane.activity"))).toBeInTheDocument();
    expect(screen.getByText(translate("trajectory.lane.model"))).toBeInTheDocument();
    // The kind legend can repeat the "Tool" lane label.
    expect(screen.getAllByText(translate("trajectory.lane.tool")).length).toBeGreaterThan(0);
  });

  it("does not modify a readonly presentation", async () => {
    const presentation = presentationForDomain();
    Object.freeze(presentation.timeDomain);
    Object.freeze(presentation.items);
    Object.freeze(presentation.groups);
    Object.freeze(presentation);

    renderOverview(presentation);
    await resizeTo(360);

    expect(presentation.timeDomain).toEqual({ start: 0, end: 100 });
    expect(presentation.items).toHaveLength(2);
    expect(presentation.groups).toHaveLength(1);
  });
});
