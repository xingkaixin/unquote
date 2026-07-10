import { parseInput } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TocPane, tocVirtualizationThreshold } from "../src/components/toc-pane";
import { I18nProvider } from "../src/i18n/context";

const scrollViewportHeight = 600;
const measuredRowHeight = 64;

const buildRecords = (count: number, failedIndexes: Set<number> = new Set()): JsonlRecord[] => {
  const lines = Array.from({ length: count }, (_, index) =>
    failedIndexes.has(index) ? "not json" : JSON.stringify({ i: index }),
  );
  return parseInput(lines.join("\n"), { forcedFormat: "jsonl" }).records;
};

const statsFor = (records: JsonlRecord[]) => {
  const success = records.filter((record) => record.node || record.deferred).length;
  return { total: records.length, success, failed: records.length - success };
};

const renderPane = (
  records: JsonlRecord[],
  overrides: Partial<{
    totalCount: number;
    activeRecordId: string | null;
    selectedRecordId: string | null;
    onSelect: (record: JsonlRecord) => void;
    onCopyRawLine: (record: JsonlRecord) => void;
  }> = {},
) => {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onCopyRawLine = overrides.onCopyRawLine ?? vi.fn();
  const stats = statsFor(records);
  render(
    <I18nProvider>
      <TocPane
        records={records}
        recordInsights={new Map()}
        stats={stats}
        totalCount={overrides.totalCount ?? stats.total}
        activeRecordId={overrides.activeRecordId ?? null}
        selectedRecordId={overrides.selectedRecordId ?? null}
        onSelect={onSelect}
        onCopyRawLine={onCopyRawLine}
      />
    </I18nProvider>,
  );
  return { onSelect, onCopyRawLine, stats };
};

const tocSelectButton = (lineNumber: number) =>
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
    width: 300,
    height: measuredRowHeight,
    top: 0,
    left: 0,
    right: 300,
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

describe("TocPane", () => {
  it("renders every record without virtualizing below the threshold", () => {
    const records = buildRecords(5);
    const { onSelect } = renderPane(records, { selectedRecordId: "record-2" });

    expect(tocSelectButton(2)).toHaveAttribute("aria-pressed", "true");
    expect(tocSelectButton(1)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(tocSelectButton(1));
    expect(onSelect).toHaveBeenCalledWith(records[0]);
  });

  it("prefers selectedRecordId over activeRecordId for highlighting", () => {
    const records = buildRecords(3);
    renderPane(records, { selectedRecordId: "record-2", activeRecordId: "record-1" });

    expect(tocSelectButton(2)).toHaveAttribute("aria-pressed", "true");
    expect(tocSelectButton(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a copy-raw-line button for failed records and triggers the callback", () => {
    const records = buildRecords(3, new Set([1]));
    const { onCopyRawLine } = renderPane(records);

    expect(tocSelectButton(2)).toHaveAttribute("aria-pressed", "false");
    const copyButton = screen.getByLabelText("Copy raw line");
    fireEvent.click(copyButton);
    expect(onCopyRawLine).toHaveBeenCalledWith(records[1]);
  });

  it("shows the full-set stats description when nothing is filtered", () => {
    const records = buildRecords(3);
    renderPane(records);

    expect(screen.getByText("3 ok · 0 err")).toBeInTheDocument();
  });

  it("shows the filtered stats description when the shown count is below the total", () => {
    const records = buildRecords(3);
    renderPane(records, { totalCount: 5 });

    expect(screen.getByText("3/5 records · 3 ok · 0 err")).toBeInTheDocument();
  });

  it("windows the rendered rows once records exceed the virtualization threshold", () => {
    const total = tocVirtualizationThreshold + 340;
    const records = buildRecords(total);
    renderPane(records);

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.queryByText(`#${total}`)).not.toBeInTheDocument();
  });

  it("selects a windowed row and reports the highlighted record as pressed", () => {
    const total = tocVirtualizationThreshold + 40;
    const records = buildRecords(total);
    const { onSelect } = renderPane(records, { selectedRecordId: "record-2" });

    expect(tocSelectButton(2)).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(tocSelectButton(1));
    expect(onSelect).toHaveBeenCalledWith(records[0]);
  });
});
