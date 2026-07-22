import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGlobalShortcuts } from "../src/hooks/use-global-shortcuts";
import type { GlobalShortcut } from "../src/hooks/use-global-shortcuts";

const dispatchKeyDown = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe("useGlobalShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches to the matching shortcut and ignores non-matching ones", () => {
    const kHandler = vi.fn();
    const cHandler = vi.fn();
    const shortcuts: GlobalShortcut[] = [
      { matches: (event) => event.key === "k", allowInTextEditing: true, handler: kHandler },
      { matches: (event) => event.key === "c", allowInTextEditing: true, handler: cHandler },
    ];
    renderHook(() => useGlobalShortcuts(shortcuts));

    dispatchKeyDown({ key: "k" });

    expect(kHandler).toHaveBeenCalledTimes(1);
    expect(cHandler).not.toHaveBeenCalled();

    dispatchKeyDown({ key: "x" });

    expect(kHandler).toHaveBeenCalledTimes(1);
    expect(cHandler).not.toHaveBeenCalled();
  });

  it("blocks a shortcut while a text-editing element is focused unless allowInTextEditing is set", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    const blockedHandler = vi.fn();
    const allowedHandler = vi.fn();
    const shortcuts: GlobalShortcut[] = [
      { matches: (event) => event.key === "c", handler: blockedHandler },
      { matches: (event) => event.key === "k", allowInTextEditing: true, handler: allowedHandler },
    ];
    renderHook(() => useGlobalShortcuts(shortcuts));

    dispatchKeyDown({ key: "c" });
    expect(blockedHandler).not.toHaveBeenCalled();

    dispatchKeyDown({ key: "k" });
    expect(allowedHandler).toHaveBeenCalledTimes(1);
  });

  it("calls preventDefault unless the handler returns false", () => {
    const shortcuts: GlobalShortcut[] = [
      { matches: (event) => event.key === "a", allowInTextEditing: true, handler: () => undefined },
      {
        matches: (event) => event.key === "b",
        allowInTextEditing: true,
        handler: () => false,
      },
    ];
    renderHook(() => useGlobalShortcuts(shortcuts));

    const consumedEvent = dispatchKeyDown({ key: "a" });
    expect(consumedEvent.defaultPrevented).toBe(true);

    const passthroughEvent = dispatchKeyDown({ key: "b" });
    expect(passthroughEvent.defaultPrevented).toBe(false);
  });

  it("mounts a single keydown listener regardless of shortcut list changes across re-renders", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const first = vi.fn();
    const second = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ shortcuts }: { shortcuts: GlobalShortcut[] }) => useGlobalShortcuts(shortcuts),
      {
        initialProps: {
          shortcuts: [
            { matches: (event) => event.key === "a", allowInTextEditing: true, handler: first },
          ] as GlobalShortcut[],
        },
      },
    );

    const keydownAddCalls = () => addSpy.mock.calls.filter(([type]) => type === "keydown").length;
    expect(keydownAddCalls()).toBe(1);

    // A fresh shortcuts array on rerender must not re-mount the listener: the
    // hook reads the latest shortcuts via a ref instead of an effect dependency.
    rerender({
      shortcuts: [
        { matches: (event) => event.key === "a", allowInTextEditing: true, handler: second },
      ],
    });
    expect(keydownAddCalls()).toBe(1);

    dispatchKeyDown({ key: "a" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy.mock.calls.filter(([type]) => type === "keydown").length).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
