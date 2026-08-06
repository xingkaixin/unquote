import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemePreference } from "../src/hooks/use-theme-preference";
import { initializeThemePreference } from "../src/lib/theme-preference";

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
    document.documentElement.style.colorScheme = "";
    document.head.innerHTML = '<meta name="theme-color" content="#f4f5f6" />';
    systemMatches = false;
    changeListener = null;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });
  });

  it("applies the stored theme before React renders", () => {
    localStorage.setItem("unquote-theme", "dark");

    initializeThemePreference();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveStyle({ colorScheme: "dark" });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#0d0f11",
    );
  });

  it("applies the system theme before React renders", () => {
    systemMatches = true;

    initializeThemePreference();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveStyle({ colorScheme: "dark" });
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
    expect(document.documentElement).toHaveStyle({ colorScheme: "light" });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#f4f5f6",
    );
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
    expect(document.documentElement).toHaveStyle({ colorScheme: "dark" });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#0d0f11",
    );

    unmount();
    expect(vi.mocked(mediaQuery.removeEventListener)).toHaveBeenCalledWith("change", listener);
  });
});
