// @vitest-environment jsdom
import React, { act } from "react";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimSelectionHandoffMessageType } from "../src/selection-handoff";

const mocks = vi.hoisted(() => ({
  roots: [] as Root[],
  initializeThemePreference: vi.fn(),
  getMessage: vi.fn(() => "Import failed. Please paste or open a file."),
  sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
}));

vi.mock("react-dom/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...original,
    default: {
      ...original,
      createRoot: (container: Element) => {
        const root = original.createRoot(container);
        mocks.roots.push(root);
        return root;
      },
    },
  };
});
vi.mock("@unquote/ui", async () => {
  const { Toaster } = await import("sonner");
  return {
    I18nProvider: ({ children }: { children: ReactNode }) => children,
    UnquoteApp: ({ initialInput }: { initialInput: string }) => (
      <>
        <textarea aria-label="Input" defaultValue={initialInput} />
        <Toaster closeButton />
      </>
    ),
  };
});
vi.mock("@unquote/ui/styles.css", () => ({}));
vi.mock("@unquote/ui/theme-preference", () => ({
  initializeThemePreference: mocks.initializeThemePreference,
}));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: mocks.sendMessage }, i18n: { getMessage: mocks.getMessage } },
}));

const handoffId = "00000000-0000-4000-8000-000000000001";
const warningText = "Import failed. Please paste or open a file.";
const warningCount = () => document.querySelectorAll("[data-sonner-toast]").length;
const input = () => document.querySelector("textarea")?.value;

const openPage = async () => {
  vi.resetModules();
  await act(async () => {
    await import("../entrypoints/options/main");
  });
};

const reloadPage = async () => {
  await act(async () => {
    mocks.roots.pop()?.unmount();
  });
  await openPage();
};

describe("extension options entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({ retained: true }, "", "/options.html");
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of mocks.roots.splice(0)) root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("imports the selection and clears only the handoff parameter before reload", async () => {
    window.history.replaceState({ retained: true }, "", `?handoff=${handoffId}&other=keep#editor`);
    mocks.sendMessage.mockResolvedValue("selected input");
    await openPage();
    expect(input()).toBe("selected input");
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });
    expect(window.location.search).toBe("?other=keep");
    expect(window.location.hash).toBe("#editor");
    expect(window.history.state).toEqual({ retained: true });
    expect(warningCount()).toBe(0);

    await reloadPage();
    expect(input()).toBe("");
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(warningCount()).toBe(0);
  });

  it.each(["?handoff=failed", `?handoff=${handoffId}`])(
    "renders one dismissible warning for %s and does not repeat it on reload",
    async (search) => {
      window.history.replaceState(null, "", search);
      mocks.sendMessage.mockResolvedValue("");
      await openPage();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(input()).toBe("");
      expect(document.body.textContent).toContain(warningText);
      expect(warningCount()).toBe(1);
      expect(document.querySelector("[data-close-button]")).not.toBeNull();
      expect(window.location.search).toBe("");
      await reloadPage();
      expect(warningCount()).toBe(0);
    },
  );

  it("opens normally without messaging or warning", async () => {
    await openPage();
    expect(input()).toBe("");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(warningCount()).toBe(0);
  });
});
