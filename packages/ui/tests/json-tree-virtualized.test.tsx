import { parseInput } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch } from "../src/lib/record-search";
import type { ScrollIntent } from "../src/lib/scroll-intent";

// The virtualized branch scrolls by display-row index rather than by element
// id, so the index lookup is only observable through scrollToIndex. Proxy the
// virtualizer instead of spreading it: its methods are instance properties and
// a spread would silently drop the ones the component still needs.
const scrollToIndex = vi.fn();
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const virtualizer = actual.useVirtualizer(options);
      return new Proxy(virtualizer, {
        get: (target, property, receiver) =>
          property === "scrollToIndex" ? scrollToIndex : Reflect.get(target, property, receiver),
      });
    }) as typeof actual.useVirtualizer,
  };
});

const { JsonTree } = await import("../src/components/json-tree");
const { I18nProvider } = await import("../src/i18n/context");

const rowCount = 200;
const recordId = "record-1";
const viewportHeight = 600;
const measuredElements: Element[] = [];

interface WideTreeOptions {
  specialValue?: { index: number; value: string };
  searchMatches?: SearchMatch[];
  activeMatchPath?: string | null;
  scrollIntent?: ScrollIntent | null;
}

const renderWideTree = (options: WideTreeOptions = {}) => {
  const source = JSON.stringify(
    Object.fromEntries(
      Array.from({ length: rowCount }, (_, index) => [
        `k${index}`,
        options.specialValue?.index === index ? options.specialValue.value : index,
      ]),
    ),
  );
  const record = parseInput(source).records[0]!;
  const treeView = (expandedStringifiedPaths: ReadonlySet<string>) => (
    <I18nProvider>
      <JsonTree
        record={record}
        expandedStringifiedPaths={expandedStringifiedPaths}
        searchMatches={options.searchMatches ?? []}
        activeMatchPath={options.activeMatchPath ?? null}
        scrollIntent={options.scrollIntent ?? null}
        selectedPath={null}
        actions={{
          togglePath: vi.fn(),
          copyRecord: vi.fn(),
          copyRawLine: vi.fn(),
          copyError: vi.fn(),
          selectNode: vi.fn(),
          requestFullRecord: vi.fn(),
        }}
      />
    </I18nProvider>
  );
  const { rerender } = render(treeView(new Set()));

  return {
    tree: screen.getByRole("tree"),
    setExpandedPaths: (paths: ReadonlySet<string>) => rerender(treeView(paths)),
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  scrollToIndex.mockClear();
  measuredElements.length = 0;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(viewportHeight);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    measuredElements.push(this);
    const height = this.textContent && this.textContent.length > 200 ? 72 : 24;
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      right: 800,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect;
  });
});

describe("JsonTree virtualized keyboard navigation", () => {
  it("scrolls to the display index of the newly active row", () => {
    const { tree } = renderWideTree();

    // Display rows are: the root open row, one row per key, then the close
    // row. Interactive rows drop the close row, so ArrowDown from the root
    // lands on `$.k0` at display index 1.
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${recordId}:$.k0`);
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: "auto" });
  });

  it("tags every virtualized row with its display index", () => {
    const { tree } = renderWideTree();

    // `measureElement` resolves a row to its item through `data-index`; without
    // it the estimate is never corrected and the rows overlap.
    const indexes = Array.from(tree.querySelectorAll("[role='treeitem']")).map((row) =>
      Number(row.getAttribute("data-index")),
    );
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.every(Number.isInteger)).toBe(true);
    expect(indexes).toStrictEqual([...indexes].sort((left, right) => left - right));
  });

  it("reports each mounted tree item's position in the full interactive set", () => {
    const { tree } = renderWideTree();
    const treeItems = Array.from(tree.querySelectorAll<HTMLElement>("[role='treeitem']"));

    expect(treeItems.length).toBeGreaterThan(0);
    for (const treeItem of treeItems) {
      expect(treeItem).toHaveAttribute("aria-setsize", String(rowCount + 1));
      expect(treeItem).toHaveAttribute("aria-posinset", String(Number(treeItem.dataset.index) + 1));
    }
  });

  it("resolves boundary navigation to the last interactive display index", () => {
    const { tree } = renderWideTree();

    fireEvent.keyDown(tree, { key: "End" });

    expect(tree).not.toHaveAttribute("aria-activedescendant");
    expect(scrollToIndex).toHaveBeenLastCalledWith(rowCount, { align: "auto" });

    fireEvent.keyDown(tree, { key: "Home" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${recordId}:$`);
    expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "auto" });
  });

  it.each([
    ["top", 0, "x".repeat(600)],
    ["middle", Math.floor(rowCount / 2), "x".repeat(600)],
    ["bottom", rowCount - 1, "x".repeat(600)],
    ["multiline", Math.floor(rowCount / 2), "first line\nsecond line\nthird line"],
  ])("keeps a %s dynamic-height value inside the virtualized DOM budget", (_, index, value) => {
    const { tree } = renderWideTree({ specialValue: { index, value } });
    const mountedRows = tree.querySelectorAll("[data-index]");

    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(rowCount / 2);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("measures a mounted long row after applying search highlights", () => {
    const pathText = "$.k0";
    renderWideTree({
      specialValue: { index: 0, value: "x".repeat(600) },
      activeMatchPath: pathText,
      searchMatches: [
        {
          recordId,
          pathText,
          keyRanges: [],
          valueRanges: [{ start: 1, end: 4 }],
          pathRanges: [],
          stringifiedPathChain: [],
        },
      ],
    });

    const longRow = document.getElementById(`${recordId}:${pathText}`);
    expect(longRow?.querySelector("mark")).toBeInTheDocument();
    expect(measuredElements).toContain(longRow);
  });

  it("uses the virtualizer for path navigation in a tree with a long value", async () => {
    renderWideTree({
      specialValue: { index: 100, value: "x".repeat(600) },
      scrollIntent: { kind: "path", recordId, pathText: `$.k${rowCount - 1}` },
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(scrollToIndex).toHaveBeenLastCalledWith(rowCount, { align: "center" });
  });

  it("remeasures an expanded stringified value and stays virtualized after collapse", () => {
    const pathText = "$.k0";
    const nestedPath = `${pathText}.detail`;
    const { tree, setExpandedPaths } = renderWideTree({
      specialValue: {
        index: 0,
        value: JSON.stringify({ detail: "x".repeat(600), status: "ok" }),
      },
    });

    expect(document.getElementById(`${recordId}:${nestedPath}`)).not.toBeInTheDocument();

    setExpandedPaths(new Set([pathText]));

    const nestedRow = document.getElementById(`${recordId}:${nestedPath}`);
    expect(nestedRow).toBeInTheDocument();
    expect(measuredElements).toContain(nestedRow);
    expect(tree.querySelectorAll("[data-index]").length).toBeLessThan(rowCount / 2);

    setExpandedPaths(new Set());

    expect(document.getElementById(`${recordId}:${nestedPath}`)).not.toBeInTheDocument();
    fireEvent.keyDown(tree, { key: "End" });
    expect(scrollToIndex).toHaveBeenLastCalledWith(rowCount, { align: "auto" });
  });
});
