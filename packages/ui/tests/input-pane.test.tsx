import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputPane } from "../src/components/input-pane";
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

const renderPane = (overrides: Partial<ComponentProps<typeof InputPane>> = {}) => {
  const props: ComponentProps<typeof InputPane> = {
    value: "",
    mode: "auto",
    onChange: vi.fn(),
    onModeChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  const rendered = render(
    <I18nProvider>
      <InputPane {...props} />
    </I18nProvider>,
  );
  return { ...rendered, props };
};

const transfer = ({
  files = [],
  items = [],
  types = ["Files"],
}: {
  files?: File[];
  items?: Array<{ kind: string; getAsFile: () => File | null }>;
  types?: string[];
} = {}) => ({ files, items, types, dropEffect: "none" }) as unknown as DataTransfer;

describe("InputPane file interactions", () => {
  it("opens the native picker and forwards selected files", () => {
    const onFileDrop = vi.fn();
    const { container } = renderPane({ onFileDrop });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(fileInput, "click");

    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    expect(click).toHaveBeenCalledOnce();

    const file = new File(["{}"], "payload.json", { type: "application/json" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(onFileDrop).toHaveBeenCalledWith(file);

    onFileDrop.mockClear();
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it("uses the external file opener when direct file drops are unavailable", () => {
    const onOpenFile = vi.fn();
    renderPane({ onOpenFile });

    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("tracks nested drag depth and drops files from items or file lists", () => {
    const onFileDrop = vi.fn();
    const { container } = renderPane({ onFileDrop });
    const dropTarget = container.firstElementChild as HTMLElement;
    const itemFile = new File(["{}"], "item.json", { type: "application/json" });
    const itemTransfer = transfer({
      items: [{ kind: "file", getAsFile: () => itemFile }],
    });

    fireEvent.dragEnter(dropTarget, { dataTransfer: itemTransfer });
    fireEvent.dragEnter(dropTarget, { dataTransfer: itemTransfer });
    expect(screen.getByText("Release to open file")).toBeInTheDocument();

    fireEvent.dragOver(dropTarget, { dataTransfer: itemTransfer });
    expect(itemTransfer.dropEffect).toBe("copy");

    fireEvent.dragLeave(dropTarget, { dataTransfer: itemTransfer });
    expect(screen.getByText("Release to open file")).toBeInTheDocument();
    fireEvent.dragLeave(dropTarget, { dataTransfer: itemTransfer });
    expect(screen.queryByText("Release to open file")).not.toBeInTheDocument();

    fireEvent.dragEnter(dropTarget, { dataTransfer: itemTransfer });
    fireEvent.drop(dropTarget, { dataTransfer: itemTransfer });
    expect(onFileDrop).toHaveBeenLastCalledWith(itemFile);
    expect(screen.queryByText("Release to open file")).not.toBeInTheDocument();

    const listFile = new File(["[]"], "list.json", { type: "application/json" });
    const listTransfer = transfer({
      files: [listFile],
      items: [{ kind: "file", getAsFile: () => null }],
    });
    fireEvent.drop(dropTarget, { dataTransfer: listTransfer });
    expect(onFileDrop).toHaveBeenLastCalledWith(listFile);
  });

  it("ignores non-file drags and empty drops", () => {
    const onFileDrop = vi.fn();
    const { container } = renderPane({ onFileDrop });
    const dropTarget = container.firstElementChild as HTMLElement;
    const textTransfer = transfer({ types: ["text/plain"] });

    fireEvent.dragOver(dropTarget, { dataTransfer: textTransfer });
    fireEvent.dragLeave(dropTarget, { dataTransfer: textTransfer });
    fireEvent.drop(dropTarget, { dataTransfer: textTransfer });

    expect(textTransfer.dropEffect).toBe("none");
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it("reads JSON-looking clipboard files while skipping unsupported clipboard items", async () => {
    const onFileDrop = vi.fn();
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
    renderPane({ onFileDrop });

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/plain"],
        getData: () => "C:\\imports\\payload.json",
      },
    });

    await waitFor(() => expect(onFileDrop).toHaveBeenCalledOnce());
    expect(onFileDrop.mock.calls[0]?.[0]).toMatchObject({
      name: "payload.json",
      type: "application/json",
    });
  });
});
