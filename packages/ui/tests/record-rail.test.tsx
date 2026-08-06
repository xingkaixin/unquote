import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordRail, recordRailVirtualizationThreshold } from "../src/components/record-rail";
import { I18nProvider } from "../src/i18n/context";
import { createRecordInsight } from "../src/lib/record-insight";
import type { RecordInsight } from "../src/lib/record-insight";
import type { ScrollIntent } from "../src/lib/scroll-intent";

const scrollViewportHeight = 600;
const measuredRowHeight = 76;

const buildRecords = (count: number, failedIndexes: Set<number> = new Set()): JsonlRecord[] => {
  const lines = Array.from({ length: count }, (_, index) =>
    failedIndexes.has(index) ? "not json" : JSON.stringify({ event: "ping", i: index }),
  );
  return parseInput(lines.join("\n"), { forcedFormat: "jsonl" }).records;
};

const insightsFor = (records: JsonlRecord[]) => {
  const insights = new Map<string, RecordInsight>();
  for (const record of records) {
    const insight = createRecordInsight(record);
    if (insight) {
      insights.set(record.id, insight);
    }
  }
  return insights;
};

const renderRail = (
  records: JsonlRecord[],
  overrides: Partial<{
    activeRecordId: string | null;
    scrollIntent: ScrollIntent | null;
    turnIndexByRecordId: ReadonlyMap<string, number> | null;
  }> = {},
) => {
  const onSelect = vi.fn();
  render(
    <I18nProvider>
      <RecordRail
        records={records}
        recordInsights={insightsFor(records)}
        turnIndexByRecordId={overrides.turnIndexByRecordId ?? null}
        activeRecordId={overrides.activeRecordId ?? null}
        scrollIntent={overrides.scrollIntent ?? null}
        onSelect={onSelect}
      />
    </I18nProvider>,
  );
  return { onSelect };
};

const railButton = (lineNumber: number) =>
  screen
    .getAllByText(`#${lineNumber}`)
    .map((node) => node.closest("button"))
    .find((button): button is HTMLButtonElement => Boolean(button))!;

// jsdom has no layout engine: the virtualizer reads the scroll container's
// offsetHeight for its viewport size and each row's getBoundingClientRect
// for its measured size, both of which default to 0 without this stub.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(scrollViewportHeight);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 340,
    height: measuredRowHeight,
    top: 0,
    left: 0,
    right: 340,
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

describe("RecordRail", () => {
  it("renders every record without virtualizing below the threshold", () => {
    const records = buildRecords(5);
    const { onSelect } = renderRail(records, { activeRecordId: "record-2" });

    expect(railButton(2)).toHaveAttribute("aria-pressed", "true");
    expect(railButton(1)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(railButton(1));
    expect(onSelect).toHaveBeenCalledWith(records[0]);
  });

  it("labels a failed record with the parse failure instead of an insight kind", () => {
    const records = buildRecords(2, new Set([1]));
    renderRail(records);

    expect(railButton(1)).toHaveTextContent("Event");
    expect(railButton(2)).toHaveTextContent("Parse failed");
    expect(railButton(2)).toHaveTextContent("not json");
  });

  it("appends the turn only when the session supplies one", () => {
    const records = buildRecords(2);
    renderRail(records, { turnIndexByRecordId: new Map([["record-2", 3]]) });

    expect(railButton(1)).toHaveTextContent("Line 1");
    expect(railButton(1)).not.toHaveTextContent("Turn");
    expect(railButton(2)).toHaveTextContent("Line 2 · Turn 3");
  });

  it("windows the rendered rows once records exceed the virtualization threshold", () => {
    const total = recordRailVirtualizationThreshold + 340;
    renderRail(buildRecords(total));

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.queryByText(`#${total}`)).not.toBeInTheDocument();
  });

  it("scrolls to the record a scroll intent targets", async () => {
    // tests/setup.ts stubs HTMLElement.prototype.scrollIntoView (jsdom has no
    // implementation); spy on that shared stub rather than Element.prototype.
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    renderRail(buildRecords(5), { scrollIntent: { kind: "record", recordId: "record-4" } });

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect((scrollIntoView.mock.instances[0] as HTMLElement).dataset.recordId).toBe("record-4");
  });
});
