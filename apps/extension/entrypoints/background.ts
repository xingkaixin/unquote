import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

const OPEN_MENU_ID = "unquote-open-selection";
const SESSION_KEY = "pendingInput";

const storePendingInput = async (value: string) => {
  await browser.storage.session.set({ [SESSION_KEY]: value });
};

const openOptionsPage = async () => {
  await browser.tabs.create({
    url: new URL("/options.html", import.meta.url).href,
  });
};

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: OPEN_MENU_ID,
      title: "Open in Unquote",
      contexts: ["selection"],
    });
  });

  browser.action.onClicked.addListener(async () => {
    await openOptionsPage();
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command === "open_unquote") {
      await openOptionsPage();
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== OPEN_MENU_ID) {
      return;
    }

    const selection = info.selectionText?.trim();
    if (!selection) {
      return;
    }

    await storePendingInput(selection);
    await openOptionsPage();

    if (tab?.id) {
      await browser.tabs
        .sendMessage(tab.id, { type: "unquote:clear-selection" })
        .catch(() => undefined);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== "object") {
      return undefined;
    }

    const payload = message as { type?: string; payload?: unknown };

    if (payload.type === "unquote:open-with-input" && typeof payload.payload === "string") {
      return storePendingInput(payload.payload).then(openOptionsPage);
    }

    if (payload.type === "unquote:get-pending-input") {
      return browser.storage.session.get(SESSION_KEY).then(async (result) => {
        const pendingInput = result[SESSION_KEY];
        await browser.storage.session.remove(SESSION_KEY);
        return pendingInput ?? "";
      });
    }

    return undefined;
  });
});
