import { parseInput } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Above the 180-row virtualization threshold, with short single-line values so
// the tree does not fall back to the non-virtualized branch.
const rowCount = 200;
const recordId = "record-1";

const renderWideTree = () => {
  const source = JSON.stringify(
    Object.fromEntries(Array.from({ length: rowCount }, (_, index) => [`k${index}`, index])),
  );
  const record = parseInput(source).records[0]!;

  render(
    <I18nProvider>
      <JsonTree
        record={record}
        insight={undefined}
        expandedStringifiedPaths={new Set()}
        eager
        searchMatches={[]}
        activeMatchPath={null}
        scrollIntent={null}
        selectedPath={null}
        focusedPath={null}
        actions={{
          togglePath: vi.fn(),
          copyRecord: vi.fn(),
          copyRawLine: vi.fn(),
          copyError: vi.fn(),
          selectNode: vi.fn(),
          requestFullRecord: vi.fn(),
          clearFocus: vi.fn(),
        }}
      />
    </I18nProvider>,
  );

  return screen.getByRole("tree");
};

afterEach(cleanup);
beforeEach(() => {
  scrollToIndex.mockClear();
});

describe("JsonTree virtualized keyboard navigation", () => {
  it("scrolls to the display index of the newly active row", () => {
    const tree = renderWideTree();

    // Display rows are: the root open row, one row per key, then the close
    // row. Interactive rows drop the close row, so ArrowDown from the root
    // lands on `$.k0` at display index 1.
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${recordId}:$.k0`);
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: "auto" });
  });

  it("resolves boundary navigation to the last interactive display index", () => {
    const tree = renderWideTree();

    fireEvent.keyDown(tree, { key: "End" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${recordId}:$.k${rowCount - 1}`);
    expect(scrollToIndex).toHaveBeenLastCalledWith(rowCount, { align: "auto" });

    fireEvent.keyDown(tree, { key: "Home" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${recordId}:$`);
    expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "auto" });
  });
});
