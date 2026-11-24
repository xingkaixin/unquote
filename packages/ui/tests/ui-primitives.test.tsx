import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { Dialog } from "../src/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../src/components/dropdown-menu";
import { RangeSlider } from "../src/components/range-slider";
import { Tabs, TabsList, TabsTrigger } from "../src/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../src/components/tooltip";
import { I18nProvider } from "../src/i18n/context";
import { maxInMemorySourceBytes } from "../src/hooks/use-source-loader";

afterEach(cleanup);

describe("Dialog primitive", () => {
  it("traps Tab focus, restores focus on close, and closes on backdrop/viewport click", async () => {
    const user = userEvent.setup();
    const Demo = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
              <Dialog.Backdrop data-testid="backdrop" />
              <Dialog.Viewport data-testid="viewport">
                <Dialog.Popup>
                  <Dialog.Title>Title</Dialog.Title>
                  <button type="button">First</button>
                  <Dialog.Close>Done</Dialog.Close>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      );
    };

    render(<Demo />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);

    const first = screen.getByRole("button", { name: "First" });
    const done = screen.getByRole("button", { name: "Done" });
    expect(document.activeElement).toBe(first);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(done);

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(first);

    await user.click(screen.getByTestId("backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(screen.getByTestId("viewport"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps background inert and retains focus when clicking outside a non-dismissible dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="background">
          <button type="button">Background action</button>
        </div>
        <Dialog.Root open onOpenChange={() => undefined}>
          <Dialog.Portal>
            <Dialog.Backdrop data-testid="backdrop" />
            <Dialog.Viewport data-testid="viewport">
              <Dialog.Popup>
                <Dialog.Title>Locked</Dialog.Title>
                <button type="button">Inside action</button>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </>,
    );

    const inside = screen.getByRole("button", { name: "Inside action" });
    const backgroundWrapper = screen.getByTestId("background").parentElement!;
    expect(backgroundWrapper.inert).toBe(true);
    expect(document.activeElement).toBe(inside);

    await user.click(screen.getByTestId("viewport"));
    expect(document.activeElement).toBe(inside);

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(inside);
  });
});

describe("DropdownMenu primitive", () => {
  it("focuses the first item on keyboard open, navigates skipping disabled items, and closes on outside click or Escape", async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    const onRadio = vi.fn();

    render(
      <div>
        <button type="button">Outside</button>
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuItem onClick={onFirst}>First</DropdownMenuItem>
            <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
            <DropdownMenuRadioGroup value="a" onValueChange={onRadio}>
              <DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="b" closeOnClick={false}>
                Option B
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button">After</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Actions" });
    const before = screen.getByRole("button", { name: "Outside" });
    const after = screen.getByRole("button", { name: "After" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Option B" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First" }));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Option B" }));

    await user.keyboard("{Enter}");
    expect(onRadio).toHaveBeenCalledWith("b");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(before);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(after);

    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(before);
  });
});

describe("RangeSlider primitive", () => {
  it("supports keyboard stepping, bounds, pointer dragging, and disabled mode", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <RangeSlider
        value={[20, 80]}
        min={0}
        max={100}
        step={5}
        onValueChange={onValueChange}
        getAriaLabel={(index) => (index === 0 ? "Start" : "End")}
      />,
    );

    const [startSlider, endSlider] = screen.getAllByRole("slider");
    fireEvent.keyDown(startSlider!, { key: "ArrowLeft" });
    expect(onValueChange).toHaveBeenLastCalledWith([15, 80]);
    fireEvent.keyDown(startSlider!, { key: "PageUp" });
    expect(onValueChange).toHaveBeenLastCalledWith([70, 80]);
    fireEvent.keyDown(startSlider!, { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith([80, 80]);
    fireEvent.keyDown(startSlider!, { key: "Home" });
    expect(onValueChange).toHaveBeenLastCalledWith([0, 80]);

    fireEvent.keyDown(endSlider!, { key: "PageDown" });
    expect(onValueChange).toHaveBeenLastCalledWith([20, 30]);
    fireEvent.keyDown(endSlider!, { key: "Home" });
    expect(onValueChange).toHaveBeenLastCalledWith([20, 20]);
    fireEvent.keyDown(endSlider!, { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith([20, 100]);

    const track = startSlider!.parentElement!.parentElement!;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    });

    const control = track.parentElement!;
    fireEvent.pointerDown(control, { button: 0, clientX: 10, pointerId: 1 });
    expect(onValueChange).toHaveBeenLastCalledWith([10, 80]);
    fireEvent.pointerMove(control, { clientX: 35, pointerId: 1 });
    expect(onValueChange).toHaveBeenLastCalledWith([35, 80]);
    fireEvent.pointerUp(control, { pointerId: 1 });

    fireEvent.pointerDown(control, { button: 0, clientX: 90, pointerId: 2 });
    expect(onValueChange).toHaveBeenLastCalledWith([20, 90]);
    fireEvent.pointerCancel(control, { pointerId: 2 });

    onValueChange.mockClear();
    rerender(
      <RangeSlider
        value={[20, 80]}
        min={0}
        max={100}
        step={5}
        disabled
        onValueChange={onValueChange}
        getAriaLabel={(index) => (index === 0 ? "Start" : "End")}
      />,
    );
    fireEvent.keyDown(startSlider!, { key: "ArrowRight" });
    fireEvent.pointerDown(control, { button: 0, clientX: 50, pointerId: 3 });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("Tabs and Tooltip primitives", () => {
  it("supports Home/End keyboard focus in Tabs and focus/Escape in Tooltip", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <TooltipProvider delay={0} closeDelay={0}>
        <Tabs value="one" onValueChange={onChange}>
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two" disabled>
              Two
            </TabsTrigger>
            <TabsTrigger value="three">Three</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tooltip>
          <TooltipTrigger render={<button type="button">Info</button>} />
          <TooltipContent>Help text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const one = screen.getByRole("tab", { name: "One" });
    const three = screen.getByRole("tab", { name: "Three" });
    one.focus();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(three);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("three");
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(one);

    const info = screen.getByRole("button", { name: "Info" });
    fireEvent.focus(info);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Help text");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("moves the roving tab stop to the controlled active tab once focus leaves the tablist", async () => {
    const user = userEvent.setup();
    const Demo = () => {
      const [value, setValue] = useState("agent");
      return (
        <>
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="agent">Agent</TabsTrigger>
              <TabsTrigger value="trajectory">Trajectory</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
          </Tabs>
          <button type="button" onClick={() => setValue("json")}>
            Switch to JSON
          </button>
        </>
      );
    };

    render(<Demo />);
    const agent = screen.getByRole("tab", { name: "Agent" });
    const trajectory = screen.getByRole("tab", { name: "Trajectory" });
    const json = screen.getByRole("tab", { name: "JSON" });

    agent.focus();
    await user.keyboard("{ArrowRight}");
    expect(trajectory).toHaveAttribute("tabindex", "0");

    await user.click(screen.getByRole("button", { name: "Switch to JSON" }));
    expect(json).toHaveAttribute("tabindex", "0");
    expect(trajectory).toHaveAttribute("tabindex", "-1");
    expect(agent).toHaveAttribute("tabindex", "-1");
  });
});

describe("empty-state toaster activation", () => {
  it("mounts Toaster and shows an error when an oversized JSON file is chosen from the empty page", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    const file = new File(["{}"], "huge.json", { type: "application/json" });
    Object.defineProperty(file, "size", { value: maxInMemorySourceBytes + 1 });

    const input = document.querySelector<HTMLInputElement>(
      '[data-benchmark-action="source-file-input"]',
    )!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        screen.getByText("File is too large to load as JSON — choose JSONL to stream it"),
      ).toBeInTheDocument(),
    );
  });

  it("preserves search focus and selection across workspace mount and discards stale pending queries on source replacement", async () => {
    vi.resetModules();
    const { UnquoteApp: FreshUnquoteApp } = await import("../src/app");
    const { I18nProvider: FreshI18nProvider } = await import("../src/i18n/context");

    render(
      <FreshI18nProvider>
        <FreshUnquoteApp initialInput='{"hello":"world"}' />
      </FreshI18nProvider>,
    );

    const initialInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Search or jump" });
    initialInput.focus();
    fireEvent.change(initialInput, { target: { value: "hello" } });
    initialInput.setSelectionRange(2, 4, "backward");

    await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());
    const mountedInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Search or jump" });
    expect(mountedInput).toHaveValue("hello");
    expect(document.activeElement).toBe(mountedInput);
    expect(mountedInput.selectionStart).toBe(2);
    expect(mountedInput.selectionEnd).toBe(4);
    expect(mountedInput.selectionDirection).toBe("backward");

    cleanup();
    vi.resetModules();
    const { UnquoteApp: SecondUnquoteApp } = await import("../src/app");
    const { I18nProvider: SecondI18nProvider } = await import("../src/i18n/context");

    render(
      <SecondI18nProvider>
        <SecondUnquoteApp initialInput='{"first":1}' />
      </SecondI18nProvider>,
    );

    const staleInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Search or jump" });
    fireEvent.change(staleInput, { target: { value: "stale" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Source input" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Search or jump" })).toHaveValue("");
  });
});
