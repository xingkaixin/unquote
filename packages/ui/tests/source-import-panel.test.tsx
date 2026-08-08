import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceImportPanel } from "../src/components/source-import-panel";
import { I18nProvider } from "../src/i18n/context";

const originalClipboard = navigator.clipboard;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
});

const sample = {
  id: "escaped-api-response",
  label: "Escaped API response",
  value: '{"body":"{}"}',
  expandedPathsByRecord: [],
};

const renderPanel = (overrides: Partial<ComponentProps<typeof SourceImportPanel>> = {}) => {
  const props: ComponentProps<typeof SourceImportPanel> = {
    initialDraft: "",
    initialFile: null,
    initialMode: "auto",
    onCommit: vi.fn(),
    samples: [sample],
    onSampleSelect: vi.fn(),
    textareaClassName: "h-[180px]",
    ...overrides,
  };
  const rendered = render(
    <I18nProvider>
      <SourceImportPanel {...props} />
    </I18nProvider>,
  );
  return { ...rendered, props };
};

const dropTarget = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[class*='border-dashed']")!;

const transfer = ({
  files = [],
  items = [],
  types = ["Files"],
}: {
  files?: File[];
  items?: Array<{ kind: string; getAsFile: () => File | null }>;
  types?: string[];
} = {}) => ({ files, items, types, dropEffect: "none" }) as unknown as DataTransfer;

describe("SourceImportPanel draft commit", () => {
  it("publishes the draft only when Parse is pressed", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const textarea = screen.getByRole("textbox", { name: "Source input" });

    expect(screen.getByRole("button", { name: "Parse" })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: '{"ok":true}' } });
    expect(props.onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Parse" }));
    expect(props.onCommit).toHaveBeenCalledWith({
      kind: "text",
      text: '{"ok":true}',
      mode: "auto",
    });
  });

  it("publishes the draft from the keyboard", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ initialDraft: '{"seeded":true}' });

    await user.click(screen.getByRole("textbox", { name: "Source input" }));
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(props.onCommit).toHaveBeenCalledWith({
      kind: "text",
      text: '{"seeded":true}',
      mode: "auto",
    });
  });

  it("reports the detected format of the draft", () => {
    renderPanel();
    const textarea = screen.getByRole("textbox", { name: "Source input" });

    expect(screen.getByText("Waiting for input")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '{"ok":true}' } });
    expect(screen.getByText("Detected JSON")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '{"a":1}\n{"b":2}' } });
    expect(screen.getByText("Detected JSONL · 2 lines")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "not json" } });
    expect(screen.getByText("Cannot parse — check the format")).toBeInTheDocument();
  });

  it("selects the parse mode from the format chips", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const group = screen.getByRole("group", { name: "Input format" });

    expect(within(group).getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "JSONL" }));
    expect(within(group).getByRole("button", { name: "JSONL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(props.onCommit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Source input" }), {
      target: { value: '{"ok":true}' },
    });
    await user.click(screen.getByRole("button", { name: "Parse" }));
    expect(props.onCommit).toHaveBeenCalledWith({
      kind: "text",
      text: '{"ok":true}',
      mode: "jsonl",
    });
  });

  it("recommits an unchanged current file with the selected mode", async () => {
    const user = userEvent.setup();
    const file = new File(["{}"], "current.jsonl");
    const { props } = renderPanel({ initialFile: file });
    const group = screen.getByRole("group", { name: "Input format" });

    await user.click(within(group).getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Parse" }));

    expect(props.onCommit).toHaveBeenCalledWith({ kind: "file", file, mode: "json" });
  });

  it("publishes a sample without waiting for Parse", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    const group = screen.getByRole("group", { name: "Sample inputs" });

    await user.click(within(group).getByRole("button", { name: "Escaped API response" }));

    expect(props.onSampleSelect).toHaveBeenCalledWith(sample);
    expect(props.onCommit).not.toHaveBeenCalled();
  });
});

describe("SourceImportPanel file interactions", () => {
  it("opens the native picker and forwards selected files", () => {
    const { container, props } = renderPanel();
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(fileInput, "click");

    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    expect(click).toHaveBeenCalledOnce();

    const file = new File(["{}"], "payload.json", { type: "application/json" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(props.onCommit).toHaveBeenCalledWith({ kind: "file", file, mode: "auto" });

    vi.mocked(props.onCommit).mockClear();
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("tracks nested drag depth and drops files from items or file lists", () => {
    const { container, props } = renderPanel();
    const target = dropTarget(container);
    const itemFile = new File(["{}"], "item.json", { type: "application/json" });
    const itemTransfer = transfer({
      items: [{ kind: "file", getAsFile: () => itemFile }],
    });

    fireEvent.dragEnter(target, { dataTransfer: itemTransfer });
    fireEvent.dragEnter(target, { dataTransfer: itemTransfer });
    expect(screen.getByText("Release to parse")).toBeInTheDocument();

    fireEvent.dragOver(target, { dataTransfer: itemTransfer });
    expect(itemTransfer.dropEffect).toBe("copy");

    fireEvent.dragLeave(target, { dataTransfer: itemTransfer });
    expect(screen.getByText("Release to parse")).toBeInTheDocument();
    fireEvent.dragLeave(target, { dataTransfer: itemTransfer });
    expect(screen.queryByText("Release to parse")).not.toBeInTheDocument();

    fireEvent.dragEnter(target, { dataTransfer: itemTransfer });
    fireEvent.drop(target, { dataTransfer: itemTransfer });
    expect(props.onCommit).toHaveBeenLastCalledWith({
      kind: "file",
      file: itemFile,
      mode: "auto",
    });
    expect(screen.queryByText("Release to parse")).not.toBeInTheDocument();

    const listFile = new File(["[]"], "list.json", { type: "application/json" });
    const listTransfer = transfer({
      files: [listFile],
      items: [{ kind: "file", getAsFile: () => null }],
    });
    fireEvent.drop(target, { dataTransfer: listTransfer });
    expect(props.onCommit).toHaveBeenLastCalledWith({
      kind: "file",
      file: listFile,
      mode: "auto",
    });
  });

  it("ignores non-file drags and empty drops", () => {
    const { container, props } = renderPanel();
    const target = dropTarget(container);
    const textTransfer = transfer({ types: ["text/plain"] });

    fireEvent.dragOver(target, { dataTransfer: textTransfer });
    fireEvent.dragLeave(target, { dataTransfer: textTransfer });
    fireEvent.drop(target, { dataTransfer: textTransfer });

    expect(textTransfer.dropEffect).toBe("none");
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("reads JSON-looking clipboard files while skipping unsupported clipboard items", async () => {
    const read = vi.fn().mockResolvedValue([
      {
        types: ["image/png", "text/plain"],
        getType: vi.fn(async () => ({ text: async () => "not json" })),
      },
      {
        types: ["application/json"],
        getType: vi.fn(async () => ({ text: async () => '  {"ok":true}' })),
      },
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read, writeText: vi.fn() },
    });
    const { props } = renderPanel();

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/plain"],
        getData: () => "C:\\imports\\payload.json",
      },
    });

    await waitFor(() => expect(props.onCommit).toHaveBeenCalledOnce());
    expect(vi.mocked(props.onCommit).mock.calls[0]?.[0]).toMatchObject({
      kind: "file",
      mode: "auto",
      file: {
        name: "payload.json",
        type: "application/json",
      },
    });
  });
});
