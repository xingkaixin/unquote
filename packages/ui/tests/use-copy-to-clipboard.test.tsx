import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../src/hooks/use-copy-to-clipboard";
import { I18nProvider } from "../src/i18n/context";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const originalClipboard = navigator.clipboard;
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
});

describe("useCopyToClipboard", () => {
  it("writes text without reporting a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(useCopyToClipboard, { wrapper });

    await act(() => result.current("payload"));

    expect(writeText).toHaveBeenCalledWith("payload");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("reports a failed clipboard write", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(useCopyToClipboard, { wrapper });

    await act(() => result.current("payload"));

    expect(toastMocks.error).toHaveBeenCalledWith("Copy failed");
  });
});
