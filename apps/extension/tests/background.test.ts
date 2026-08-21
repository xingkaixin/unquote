import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners: {
    onActionClick?: () => Promise<void>;
    onAlarm?: (alarm: { name: string }) => void;
    onCommand?: (command: string) => Promise<void>;
    onContextMenuClick?: (
      info: { menuItemId: string | number; selectionText?: string },
      tab?: unknown,
    ) => Promise<void>;
    onInstalled?: () => void;
    onMessage?: (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => unknown;
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
    alarms: {
      clear: vi.fn(async (_name: string) => true),
      create: vi.fn(async (_name: string, _alarmInfo: { when: number }) => undefined),
      onAlarm: {
        addListener: vi.fn((listener: (alarm: { name: string }) => void) => {
          listeners.onAlarm = listener;
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
    i18n: {
      getMessage: vi.fn((name: string) => (name === "openInUnquote" ? "Unquote で開く" : "")),
    },
    runtime: {
      onInstalled: {
        addListener: vi.fn((listener: () => void) => {
          listeners.onInstalled = listener;
        }),
      },
      onMessage: {
        addListener: vi.fn(
          (
            listener: (
              message: unknown,
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => unknown,
          ) => {
            listeners.onMessage = listener;
          },
        ),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string | null) =>
          key === null ? Object.fromEntries(storageValues) : { [key]: storageValues.get(key) },
        ),
        remove: vi.fn(async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key]) {
            storageValues.delete(item);
          }
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
await vi.waitFor(() => expect(mocks.browser.storage.session.get).toHaveBeenCalledWith(null));
const startupSweepRan = mocks.browser.storage.session.get.mock.calls.length > 0;

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

  it("creates the selection context menu from the browser locale", () => {
    mocks.listeners.onInstalled?.();

    expect(mocks.browser.i18n.getMessage).toHaveBeenCalledWith("openInUnquote");
    expect(mocks.browser.contextMenus.create).toHaveBeenCalledWith({
      id: menuId,
      title: "Unquote で開く",
      contexts: ["selection"],
    });
  });

  it("sweeps retained handoffs when the background starts", () => {
    expect(startupSweepRan).toBe(true);
    expect(mocks.listeners.onAlarm).toBeTypeOf("function");
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
    expect(JSON.stringify(mocks.browser.alarms.create.mock.calls)).not.toContain("payload");

    const sendResponse = vi.fn();
    expect(mocks.listeners.onMessage?.(null, {}, sendResponse)).toBeUndefined();
    expect(mocks.listeners.onMessage?.({ type: "unsupported" }, {}, sendResponse)).toBeUndefined();
    expect(
      mocks.listeners.onMessage?.(
        {
          type: "unquote:claim-selection-handoff",
          handoffId,
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith("payload"));
    expect(mocks.storageValues).toHaveLength(0);
  });

  it("removes expired handoffs when the cleanup alarm fires", async () => {
    const key = "unquote:selection-handoff:00000000-0000-4000-8000-000000000001";
    mocks.storageValues.set(key, { input: "expired", expiresAt: 0 });

    mocks.listeners.onAlarm?.({ name: "unquote:selection-handoff-cleanup" });

    await vi.waitFor(() => expect(mocks.storageValues.has(key)).toBe(false));
  });

  it("still opens options when session storage rejects the handoff", async () => {
    mocks.browser.storage.session.set.mockRejectedValueOnce(new Error("unavailable"));

    await mocks.listeners.onContextMenuClick?.({ menuItemId: menuId, selectionText: "payload" });

    expect(getOpenedUrl().searchParams.has("handoff")).toBe(false);
  });
});
