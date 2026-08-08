import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeInspector } from "../src/components/node-inspector";
import { I18nProvider } from "../src/i18n/context";
import { inspectorCharLimit, inspectorNodeLimit } from "../src/lib/selected-node";

afterEach(cleanup);

const recordOf = (source: string): JsonlRecord => parseInput(source).records[0]!;

const selectionFor = (record: JsonlRecord, pathText: string, rawKey: string) => ({
  recordId: record.id,
  pathText,
  rawKey,
});

const renderInspector = (overrides: Partial<ComponentProps<typeof NodeInspector>> = {}) => {
  const props: ComponentProps<typeof NodeInspector> = {
    record: null,
    selectedPath: null,
    hasNestedJson: false,
    onCopyValue: vi.fn(),
    onCopyPath: vi.fn(),
    onExpandNested: vi.fn(),
    ...overrides,
  };
  const rendered = render(
    <I18nProvider>
      <NodeInspector {...props} />
    </I18nProvider>,
  );
  const rerender = (next: Partial<ComponentProps<typeof NodeInspector>>) =>
    rendered.rerender(
      <I18nProvider>
        <NodeInspector {...props} {...next} />
      </I18nProvider>,
    );
  return { ...rendered, props, rerender };
};

const valuePanel = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".whitespace-pre-wrap");

describe("NodeInspector", () => {
  it("prompts for a selection until one belongs to the shown record", () => {
    const record = recordOf('{"a":1}');
    const { container, rerender } = renderInspector({ record });

    expect(screen.getByText("Select a node in the tree")).toBeInTheDocument();
    expect(valuePanel(container)).toBeNull();

    rerender({ selectedPath: { recordId: "record-9", pathText: "$.a", rawKey: "a" } });
    expect(screen.getByText("Select a node in the tree")).toBeInTheDocument();

    // A selection this record cannot resolve is the same nothing-to-show state.
    rerender({ selectedPath: selectionFor(record, "$.gone", "gone") });
    expect(screen.getByText("Select a node in the tree")).toBeInTheDocument();
    expect(valuePanel(container)).toBeNull();
  });

  it("shows the selected key, path, and pretty-printed value", async () => {
    const user = userEvent.setup();
    const record = recordOf('{"a":{"b":1}}');
    const { container, props } = renderInspector({
      record,
      selectedPath: selectionFor(record, "$.a", "a"),
    });

    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("$.a")).toBeInTheDocument();
    expect(valuePanel(container)).toHaveTextContent('{ "b": 1 }');

    await user.click(screen.getByRole("button", { name: "Copy value" }));
    await user.click(screen.getByRole("button", { name: "Copy path" }));
    expect(props.onCopyValue).toHaveBeenCalledOnce();
    expect(props.onCopyPath).toHaveBeenCalledOnce();
  });

  it("shows an unsafe number without rounding it", () => {
    const record = recordOf('{"large":9007199254740993}');
    const { container } = renderInspector({
      record,
      selectedPath: selectionFor(record, "$.large", "large"),
    });

    expect(valuePanel(container)).toHaveTextContent("9007199254740993");
  });

  it("clips an oversized value and says so", () => {
    const record = recordOf(JSON.stringify({ big: "x".repeat(inspectorCharLimit + 5_000) }));
    const { container } = renderInspector({
      record,
      selectedPath: selectionFor(record, "$.big", "big"),
    });

    expect(valuePanel(container)?.textContent).toHaveLength(inspectorCharLimit);
    expect(screen.getByText("Value truncated for preview")).toBeInTheDocument();
  });

  it("refuses to materialize a value above the node budget", () => {
    const list = Array.from({ length: inspectorNodeLimit + 1 }, (_, index) => index);
    const record = recordOf(JSON.stringify({ list }));
    renderInspector({ record, selectedPath: selectionFor(record, "$.list", "list") });

    expect(screen.getByText("This value is too large to preview")).toBeInTheDocument();
    expect(screen.queryByText("Value truncated for preview")).not.toBeInTheDocument();
  });

  it("waits for a Preview Record to fill in", () => {
    const record = parsePreviewJsonlRecordLine('{"a":1}', 1);
    renderInspector({ record, selectedPath: selectionFor(record, "$.a", "a") });

    expect(screen.getByText("Loading value…")).toBeInTheDocument();
  });

  it("offers to expand the record's stringified JSON", async () => {
    const user = userEvent.setup();
    const { props } = renderInspector({ hasNestedJson: true });

    expect(screen.getByText("This record contains stringified JSON")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(props.onExpandNested).toHaveBeenCalledOnce();
  });

  it("re-materializes only when the record or the selection changes", () => {
    const record = recordOf('{"a":{"b":1}}');
    const selectedPath = selectionFor(record, "$.a.b", "b");
    const stringify = vi.spyOn(JSON, "stringify");
    const { rerender } = renderInspector({ record, selectedPath });

    const afterFirstRender = stringify.mock.calls.length;
    rerender({});
    expect(stringify.mock.calls.length).toBe(afterFirstRender);

    rerender({ selectedPath: selectionFor(record, "$.a", "a") });
    expect(stringify.mock.calls.length).toBeGreaterThan(afterFirstRender);
    stringify.mockRestore();
  });
});
