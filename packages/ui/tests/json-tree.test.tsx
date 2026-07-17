import { parseInput } from "@unquote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonTree } from "../src/components/json-tree";
import { I18nProvider } from "../src/i18n/context";

const renderTree = (expandedStringifiedPaths: ReadonlySet<string> = new Set()) => {
  const record = parseInput('{"payload":"{\\"answer\\":42}","status":"ok"}').records[0]!;
  const onSelectNode = vi.fn();
  const onTogglePath = vi.fn();

  render(
    <I18nProvider>
      <JsonTree
        record={record}
        insight={undefined}
        expandedStringifiedPaths={expandedStringifiedPaths}
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
    </I18nProvider>,
  );

  return { onSelectNode, onTogglePath, record };
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
});
