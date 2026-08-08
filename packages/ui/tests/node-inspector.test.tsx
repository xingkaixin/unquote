import { parseInput, parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord } from "@unquote/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeInspector } from "../src/components/node-inspector";
import { I18nProvider } from "../src/i18n/context";
import {
  inspectorCharLimit,
  inspectorNodeLimit,
  projectSelectedNode,
} from "../src/lib/selected-node";

afterEach(cleanup);

const recordOf = (source: string): JsonlRecord => parseInput(source).records[0]!;

const selectionFor = (record: JsonlRecord, pathText: string, rawKey: string) => ({
  recordId: record.id,
  pathText,
  rawKey,
});

const projectionFor = (record: JsonlRecord, pathText: string, rawKey: string) =>
  projectSelectedNode(record, selectionFor(record, pathText, rawKey));

const renderInspector = (overrides: Partial<ComponentProps<typeof NodeInspector>> = {}) => {
  const props: ComponentProps<typeof NodeInspector> = {
    projection: { kind: "empty", copy: { kind: "blocked" } },
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
  it("prompts for a selection until a projection is available", () => {
    const record = recordOf('{"a":1}');
    const { container, rerender } = renderInspector();

    expect(screen.getByText("Select a node in the tree")).toBeInTheDocument();
    expect(valuePanel(container)).toBeNull();

    rerender({ projection: projectionFor(record, "$.missing", "missing") });
    expect(screen.getByText("Select a node in the tree")).toBeInTheDocument();
    expect(valuePanel(container)).toBeNull();
  });

  it("shows the selected key, path, and pretty-printed value", async () => {
    const user = userEvent.setup();
    const record = recordOf('{"a":{"b":1}}');
    const { container, props } = renderInspector({
      projection: projectionFor(record, "$.a", "a"),
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
      projection: projectionFor(record, "$.large", "large"),
    });

    expect(valuePanel(container)).toHaveTextContent("9007199254740993");
  });

  it("clips an oversized preview while keeping an eligible copy enabled", () => {
    const record = recordOf(JSON.stringify({ big: "x".repeat(inspectorCharLimit + 5_000) }));
    const { container } = renderInspector({
      projection: projectionFor(record, "$.big", "big"),
    });

    expect(valuePanel(container)?.textContent).toHaveLength(inspectorCharLimit);
    expect(screen.getByText("Value truncated for preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy value" })).toBeEnabled();
  });

  it("disables copy for a node above the traversal budget", async () => {
    const user = userEvent.setup();
    const list = Array.from({ length: inspectorNodeLimit + 1 }, (_, index) => index);
    const record = recordOf(JSON.stringify({ list }));
    const onCopyValue = vi.fn();
    renderInspector({
      projection: projectionFor(record, "$.list", "list"),
      onCopyValue,
    });

    expect(screen.getByText("This value is too large to preview")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Copy value" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onCopyValue).not.toHaveBeenCalled();
  });

  it("disables copy while a Preview Record is loading", async () => {
    const user = userEvent.setup();
    const record = parsePreviewJsonlRecordLine('{"a":1}', 1);
    const onCopyValue = vi.fn();
    renderInspector({
      projection: projectionFor(record, "$.a", "a"),
      onCopyValue,
    });

    expect(screen.getByText("Loading value…")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Copy value" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onCopyValue).not.toHaveBeenCalled();
  });

  it("shows the copy-blocked state separately from preview truncation", () => {
    const record = recordOf('{"a":1}');
    const selection = selectionFor(record, "$.a", "a");
    renderInspector({
      projection: {
        kind: "value",
        selection,
        text: "1",
        truncated: false,
        copy: { kind: "blocked" },
      },
    });

    expect(screen.getByText("This value is too large to copy")).toBeInTheDocument();
    expect(screen.queryByText("Value truncated for preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy value" })).toBeDisabled();
  });

  it("offers to expand the record's stringified JSON", async () => {
    const user = userEvent.setup();
    const { props } = renderInspector({ hasNestedJson: true });

    expect(screen.getByText("This record contains stringified JSON")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(props.onExpandNested).toHaveBeenCalledOnce();
  });
});
