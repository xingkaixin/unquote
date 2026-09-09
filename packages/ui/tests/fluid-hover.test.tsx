import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animate } from "framer-motion/dom/mini";
import { FluidHover } from "../src/components/fluid-hover";
import { Tabs, TabsList, TabsTrigger } from "../src/components/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../src/components/dropdown-menu";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function box(element: HTMLElement, left: number, top: number, width = 80, height = 30) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(left, top, width, height));
  for (const [key, value] of Object.entries({
    offsetLeft: left,
    offsetTop: top,
    offsetWidth: width,
    offsetHeight: height,
  })) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
}

function move(element: HTMLElement, x: number, y: number, pointerType = "mouse") {
  const event = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
}

function renderList() {
  const onClick = vi.fn();
  const result = render(
    <FluidHover>
      <button data-fluid-hover-item onClick={onClick}>
        First
      </button>
      <button data-fluid-hover-item disabled>
        Disabled
      </button>
      <button data-fluid-hover-item onClick={onClick}>
        Last
      </button>
    </FluidHover>,
  );
  const [first, disabled, last] = screen.getAllByRole("button");
  box(first!, 0, 0);
  box(disabled!, 0, 40);
  box(last!, 0, 80);
  const container = first!.parentElement!;
  const highlight = container.querySelector<HTMLElement>("[data-slot=fluid-hover-highlight]")!;
  return {
    ...result,
    onClick,
    first: first!,
    disabled: disabled!,
    last: last!,
    container,
    highlight,
  };
}

async function expectActive(element: HTMLElement) {
  await waitFor(() => expect(element).toHaveAttribute("data-fluid-hover-active"));
}

describe("FluidHover", () => {
  it("keeps one nearest highlight across gaps, skips disabled items, and leaves gap clicks inert", async () => {
    const { container, first, disabled, last, highlight, onClick } = renderList();
    move(container, 20, 15);
    await expectActive(first);
    move(container, 20, 75);
    await expectActive(last);
    expect(first).not.toHaveAttribute("data-fluid-hover-active");
    expect(disabled).not.toHaveAttribute("data-fluid-hover-active");
    expect(highlight).toHaveStyle({
      transform: "translate(0px, 80px)",
      width: "80px",
      height: "30px",
    });
    fireEvent.click(container, { clientX: 20, clientY: 75 });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(last);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued hover when the pointer leaves and starts a new entry at its own row", async () => {
    const { container, first, last, highlight } = renderList();
    move(container, 20, 15);
    fireEvent.pointerLeave(container);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(first).not.toHaveAttribute("data-fluid-hover-active");
    move(container, 20, 95);
    await expectActive(last);
    expect(highlight).toHaveStyle({ transform: "translate(0px, 80px)" });
    expect(animate).toHaveBeenLastCalledWith(highlight, { opacity: 1 }, { duration: 0.08 });
  });

  it("ignores touch hover and clears the mouse decoration on keyboard input", async () => {
    const { container, first, highlight } = renderList();
    move(container, 20, 15, "touch");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(first).not.toHaveAttribute("data-fluid-hover-active");
    move(container, 20, 15);
    await expectActive(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(first).not.toHaveAttribute("data-fluid-hover-active");
    expect(highlight).toHaveStyle({ opacity: "0" });
  });

  it("snaps between items with reduced motion while retaining the opacity fade", async () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ ...media, matches: true })),
    );
    const { container, first, last, highlight } = renderList();
    move(container, 20, 15);
    await expectActive(first);
    move(container, 20, 95);
    await expectActive(last);
    expect(highlight).toHaveStyle({ transform: "translate(0px, 80px)" });
    expect(animate).toHaveBeenLastCalledWith(highlight, { opacity: 1 }, { duration: 0.08 });
  });

  it("clears a removed target and picks a replacement using its current element", async () => {
    const { rerender, container, first, highlight } = renderList();
    move(container, 20, 15);
    await expectActive(first);
    rerender(
      <FluidHover>
        <button key="replacement" data-fluid-hover-item>
          Replacement
        </button>
      </FluidHover>,
    );
    await waitFor(() => expect(highlight).toHaveStyle({ opacity: "0" }));
    const replacement = screen.getByRole("button", { name: "Replacement" });
    box(replacement, 0, 0);
    move(container, 20, 15);
    await expectActive(replacement);
  });

  it("does not change the selected tab on hover and preserves arrow-key activation", async () => {
    const onValueChange = vi.fn();
    render(
      <Tabs defaultValue="agent" onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="trajectory">Trajectory</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const [agent, trajectory, json] = screen.getAllByRole("tab");
    box(agent!, 0, 0);
    box(trajectory!, 80, 0, 110);
    box(json!, 190, 0, 60);
    move(json!.parentElement!, 210, 15);
    await expectActive(json!);
    expect(agent).toHaveAttribute("aria-selected", "true");
    expect(onValueChange).not.toHaveBeenCalled();
    act(() => agent!.focus());
    fireEvent.keyDown(agent!, { key: "ArrowRight" });
    await waitFor(() => expect(trajectory).toHaveFocus());
    expect(json).not.toHaveAttribute("data-fluid-hover-active");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(trajectory).toHaveAttribute("aria-selected", "true"));
  });

  it("preserves menu keyboard selection and trigger focus when reopened", async () => {
    const onClick = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Export</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onClick}>Copy</DropdownMenuItem>
          <DropdownMenuItem disabled>Unavailable</DropdownMenuItem>
          <DropdownMenuItem>Download</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Export" });
    fireEvent.click(trigger);
    const copy = await screen.findByRole("menuitem", { name: "Copy" });
    act(() => copy.focus());
    fireEvent.keyDown(copy, { key: "Enter" });
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Copy" })).not.toHaveAttribute(
      "data-fluid-hover-active",
    );
  });
});
