import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners: {
    onActionClick?: () => Promise<void>;
    onCommand?: (command: string) => Promise<void>;
    onContextMenuClick?: (
      info: { menuItemId: string | number; selectionText?: string },
      tab?: unknown,
    ) => Promise<void>;
    onInstalled?: () => void;
    onMessage?: (message: unknown) => unknown;
  } = {};
  const storageValues = new Map<string, unknown>();
  const browser = {
    action: {
      onClicked: {
        addListener: vi.fn((listener: () => Promise<void>) => {
          listeners.onActionClick = listener;
        }),
      },
    },
    commands: {
      onCommand: {
        addListener: vi.fn((listener: (command: string) => Promise<void>) => {
          listeners.onCommand = listener;
        }),
      },
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn(
          (
            listener: (
              info: { menuItemId: string | number; selectionText?: string },
              tab?: unknown,
            ) => Promise<void>,
          ) => {
            listeners.onContextMenuClick = listener;
          },
        ),
      },
    },
    runtime: {
      onInstalled: {
        addListener: vi.fn((listener: () => void) => {
          listeners.onInstalled = listener;
        }),
      },
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => unknown) => {
          listeners.onMessage = listener;
        }),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storageValues.get(key) })),
        remove: vi.fn(async (key: string) => {
          storageValues.delete(key);
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([key, value]) => storageValues.set(key, value));
        }),
      },
    },
    tabs: {
      create: vi.fn(async (_options: { url: string }) => undefined),
    },
  };

  return { browser, listeners, storageValues };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));
vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (setup: () => void) => setup(),
}));

await import("../entrypoints/background");

const menuId = "unquote-open-selection";
const getOpenedUrl = () => {
  const call = mocks.browser.tabs.create.mock.calls.at(0);
  if (!call) {
    throw new Error("Expected the options page to open");
  }
  return new URL(call[0].url);
};

describe("extension background", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageValues.clear();
  });

  it("creates the localized selection context menu after installation", () => {
    mocks.listeners.onInstalled?.();

    expect(mocks.browser.contextMenus.create).toHaveBeenCalledWith({
      id: menuId,
      title: "Open in Unquote",
      contexts: ["selection"],
    });
  });

  it("opens the options page from the action and supported command", async () => {
    await mocks.listeners.onActionClick?.();
    await mocks.listeners.onCommand?.("unsupported");
    await mocks.listeners.onCommand?.("open_unquote");

    expect(mocks.browser.tabs.create).toHaveBeenCalledTimes(2);
    for (const [options] of mocks.browser.tabs.create.mock.calls) {
      expect(new URL(options.url).pathname).toBe("/options.html");
    }
  });

  it("ignores unrelated or empty context-menu selections", async () => {
    await mocks.listeners.onContextMenuClick?.({
      menuItemId: "other-menu",
      selectionText: "payload",
    });
    await mocks.listeners.onContextMenuClick?.({ menuItemId: menuId, selectionText: "   " });

    expect(mocks.browser.storage.session.set).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.create).not.toHaveBeenCalled();
  });

  it("stores, opens, and claims a selected payload", async () => {
    await mocks.listeners.onContextMenuClick?.({
      menuItemId: menuId,
      selectionText: "  payload  ",
    });

    const handoffId = getOpenedUrl().searchParams.get("handoff");
    expect(handoffId).toMatch(/^[0-9a-f-]{36}$/i);

    expect(mocks.listeners.onMessage?.(null)).toBeUndefined();
    expect(mocks.listeners.onMessage?.({ type: "unsupported" })).toBeUndefined();
    await expect(
      mocks.listeners.onMessage?.({
        type: "unquote:claim-selection-handoff",
        handoffId,
      }),
    ).resolves.toBe("payload");
    expect(mocks.storageValues).toHaveLength(0);
  });

  it("still opens options when session storage rejects the handoff", async () => {
    mocks.browser.storage.session.set.mockRejectedValueOnce(new Error("unavailable"));

    await mocks.listeners.onContextMenuClick?.({ menuItemId: menuId, selectionText: "payload" });

    expect(getOpenedUrl().searchParams.has("handoff")).toBe(false);
  });
});
