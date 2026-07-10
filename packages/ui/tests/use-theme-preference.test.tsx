import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemePreference } from "../src/hooks/use-theme-preference";

describe("useThemePreference", () => {
  let systemMatches = false;
  let changeListener: ((event: MediaQueryListEvent) => void) | null = null;
  const mediaQuery = {
    get matches() {
      return systemMatches;
    },
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      changeListener = listener;
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    systemMatches = false;
    changeListener = null;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("persists system after switching from dark and remounts with it", () => {
    localStorage.setItem("unquote-theme", "dark");
    const { result, unmount } = renderHook(() => useThemePreference());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    act(() => result.current.setTheme("system"));

    expect(result.current.theme).toBe("system");
    expect(localStorage.getItem("unquote-theme")).toBe("system");
    unmount();

    const remounted = renderHook(() => useThemePreference());
    expect(remounted.result.current.theme).toBe("system");
  });

  it("persists light and clears the dark class", () => {
    systemMatches = true;
    const { result } = renderHook(() => useThemePreference());

    expect(document.documentElement).toHaveClass("dark");
    act(() => result.current.setTheme("light"));

    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("unquote-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("falls back to system when storage contains an invalid theme", () => {
    localStorage.setItem("unquote-theme", "sepia");

    const { result } = renderHook(() => useThemePreference());

    expect(result.current.theme).toBe("system");
    expect(localStorage.getItem("unquote-theme")).toBe("system");
  });

  it("falls back to system when storage reading throws", () => {
    systemMatches = true;
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const { result } = renderHook(() => useThemePreference());

    expect(result.current.theme).toBe("system");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("keeps system media sync when storage writing throws", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const { result } = renderHook(() => useThemePreference());

    expect(result.current.theme).toBe("system");
    expect(vi.mocked(mediaQuery.addEventListener)).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    act(() => changeListener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement).toHaveClass("dark");
  });

  it("updates system theme on media changes and removes its listener", () => {
    const { unmount } = renderHook(() => useThemePreference());
    const listener = changeListener;

    expect(document.documentElement).not.toHaveClass("dark");
    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement).toHaveClass("dark");

    unmount();
    expect(vi.mocked(mediaQuery.removeEventListener)).toHaveBeenCalledWith("change", listener);
  });
});
