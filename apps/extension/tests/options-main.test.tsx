import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { claimSelectionHandoffMessageType } from "../src/selection-handoff";

const mocks = vi.hoisted(() => {
  const render = vi.fn<(node: unknown) => void>();
  return {
    createRoot: vi.fn((_container: Element | DocumentFragment) => ({
      render,
      unmount: vi.fn(),
    })),
    initializeThemePreference: vi.fn(),
    render,
    sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
  };
});

vi.mock("react-dom/client", () => ({
  default: { createRoot: mocks.createRoot },
}));
vi.mock("@unquote/ui", () => ({
  I18nProvider: ({ children }: { children: unknown }) => children,
  UnquoteApp: () => null,
}));
vi.mock("@unquote/ui/styles.css", () => ({}));
vi.mock("@unquote/ui/theme-preference", () => ({
  initializeThemePreference: mocks.initializeThemePreference,
}));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: mocks.sendMessage } },
}));

const handoffId = "00000000-0000-4000-8000-000000000001";
const rootElement = {} as Element;

describe("extension options entrypoint", () => {
  beforeAll(async () => {
    vi.stubGlobal("document", { getElementById: vi.fn(() => rootElement) });
    vi.stubGlobal("window", { location: { search: `?handoff=${handoffId}` } });
    mocks.sendMessage.mockResolvedValue("selected input");

    await import("../entrypoints/options/main");
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  });

  afterAll(() => vi.unstubAllGlobals());

  it("claims the URL handoff once and renders it as UnquoteApp initial input", () => {
    expect(mocks.initializeThemePreference).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledWith(rootElement);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });

    const strictMode = mocks.render.mock.calls[0]![0] as ReactElement<{
      children: ReactElement<{ children: ReactElement<{ initialInput: string }> }>;
    }>;
    expect(strictMode.props.children.props.children.props.initialInput).toBe("selected input");
  });
});
