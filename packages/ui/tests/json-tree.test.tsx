import { parseInput } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonTree } from "../src/components/json-tree";
import { I18nProvider } from "../src/i18n/context";

const renderTree = (expandedStringifiedPaths: ReadonlySet<string> = new Set()) => {
  const record = parseInput('{"payload":"{\\"answer\\":42}","status":"ok"}').records[0]!;
  const onSelectNode = vi.fn();
  const onTogglePath = vi.fn();
  const tree = (paths: ReadonlySet<string>) => (
    <I18nProvider>
      <JsonTree
        record={record}
        insight={undefined}
        expandedStringifiedPaths={paths}
        eager
        searchMatches={[]}
        activeMatch={null}
        scrollIntent={null}
        selectedPath={null}
        focusedPath={null}
        actions={{
          togglePath: onTogglePath,
          copyRecord: vi.fn(),
          copyRawLine: vi.fn(),
          copyError: vi.fn(),
          selectNode: onSelectNode,
          hydrateRecord: vi.fn(),
          clearFocus: vi.fn(),
        }}
      />
    </I18nProvider>
  );

  const { rerender } = render(tree(expandedStringifiedPaths));

  return {
    onSelectNode,
    onTogglePath,
    record,
    setExpandedPaths: (paths: ReadonlySet<string>) => rerender(tree(paths)),
  };
};

afterEach(cleanup);

describe("JsonTree", () => {
  it("exposes rows as a single-tab-stop tree", () => {
    renderTree();

    expect(screen.getByRole("tree")).toBeInTheDocument();
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(3);
    expect(screen.getByRole("tree")).toHaveAttribute("tabindex", "0");
    expect(items[0]).toHaveAttribute("tabindex", "-1");
    expect(items[1]).toHaveAttribute("tabindex", "-1");
    expect(items[1]).toHaveAttribute("aria-expanded", "false");
    expect(items[1]).toHaveAttribute("aria-level", "2");
  });

  it("moves focus with arrow keys and activates selection", () => {
    const { onSelectNode, record } = renderTree();
    const items = screen.getAllByRole("treeitem");

    const tree = screen.getByRole("tree");
    tree.focus();
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(tree).toHaveAttribute("aria-activedescendant", items[1]!.id);

    fireEvent.keyDown(tree, { key: "Enter" });
    expect(onSelectNode).toHaveBeenCalledWith(
      record,
      expect.objectContaining({ pathText: "$.payload" }),
    );
  });

  it("scrolls the newly active row into view when not virtualized", () => {
    // tests/setup.ts stubs HTMLElement.prototype.scrollIntoView (jsdom has no
    // implementation); spy on that shared stub rather than Element.prototype,
    // which sits further up the chain and would never be reached.
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    renderTree();
    const items = screen.getAllByRole("treeitem");
    const tree = screen.getByRole("tree");

    tree.focus();
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect((scrollIntoView.mock.instances[0] as HTMLElement).id).toBe(items[1]!.id);
  });

  it("expands the focused collapsed item with ArrowRight", () => {
    const { onTogglePath, record } = renderTree();
    const tree = screen.getByRole("tree");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    expect(onTogglePath).toHaveBeenNthCalledWith(1, record.id, "$.payload");
  });

  it("moves to a parent before collapsing it with ArrowLeft", () => {
    const { onTogglePath, record } = renderTree(new Set(["$.payload"]));
    const tree = screen.getByRole("tree");
    const items = screen.getAllByRole("treeitem");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(tree).toHaveAttribute("aria-activedescendant", items[1]!.id);

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(onTogglePath).toHaveBeenCalledWith(record.id, "$.payload");
  });

  it("supports boundary navigation and Space selection", () => {
    const { onSelectNode, record } = renderTree();
    const tree = screen.getByRole("tree");
    const items = screen.getAllByRole("treeitem");

    fireEvent.keyDown(tree, { key: "End" });
    expect(tree).toHaveAttribute("aria-activedescendant", items.at(-1)!.id);
    fireEvent.keyDown(tree, { key: "Home" });
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    expect(tree).toHaveAttribute("aria-activedescendant", items[0]!.id);

    fireEvent.keyDown(tree, { key: " " });
    expect(onSelectNode).toHaveBeenCalledWith(record, expect.objectContaining({ pathText: "$" }));
  });

  it("keeps navigation aligned after the row set changes", () => {
    const { setExpandedPaths, record } = renderTree();
    const tree = screen.getByRole("tree");

    fireEvent.keyDown(tree, { key: "End" });
    expect(tree).toHaveAttribute("aria-activedescendant", `${record.id}:$.status`);

    // Expanding inserts rows between the active row and the start of the list,
    // so a stale row-position lookup would land on the wrong row here.
    setExpandedPaths(new Set(["$.payload"]));
    fireEvent.keyDown(tree, { key: "ArrowUp" });

    expect(tree).toHaveAttribute("aria-activedescendant", `${record.id}:$.payload.answer`);
  });

  it("clicking the toggle affordance toggles the path instead of selecting it", () => {
    const { onTogglePath, onSelectNode, record } = renderTree();
    const items = screen.getAllByRole("treeitem");
    const toggle = items[1]!.querySelector("[data-tree-toggle]");

    expect(toggle).not.toBeNull();
    // Enlarged hit area (UQ-107): the toggle's ::before pseudo-element extends the
    // clickable region without changing the visible 15px square, but clicks on it
    // still resolve to this host span as event.target, so closest() keeps matching.
    expect(toggle).toHaveClass("before:-inset-[5px]");

    fireEvent.click(toggle!);

    expect(onTogglePath).toHaveBeenCalledWith(record.id, "$.payload");
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it("clicking elsewhere on a row still selects the node rather than toggling", () => {
    const { onTogglePath, onSelectNode, record } = renderTree();
    const items = screen.getAllByRole("treeitem");

    fireEvent.click(items[1]!);

    expect(onSelectNode).toHaveBeenCalledWith(
      record,
      expect.objectContaining({ pathText: "$.payload" }),
    );
    expect(onTogglePath).not.toHaveBeenCalled();
  });
});
