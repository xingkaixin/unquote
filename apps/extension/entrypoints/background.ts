import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  claimSelectionHandoffMessageType,
  createSelectionHandoffStore,
  handoffQueryParameter,
  type HandoffAlarms,
  type HandoffSessionStorage,
} from "../src/selection-handoff";

const OPEN_MENU_ID = "unquote-open-selection";

const handoffStorage: HandoffSessionStorage = browser.storage.session;

const handoffAlarms: HandoffAlarms = browser.alarms;

const handoffs = createSelectionHandoffStore(handoffStorage, handoffAlarms);

const registerContextMenu = async () => {
  try {
    await browser.contextMenus.removeAll();
  } catch {
    // Recreate the menu even if clearing fails on a host runtime.
  }
  browser.contextMenus.create({
    id: OPEN_MENU_ID,
    title: browser.i18n.getMessage("openInUnquote"),
    contexts: ["selection"],
  });
};

export default defineBackground(() => {
  void handoffs.sweep();

  browser.alarms.onAlarm.addListener((alarm) => {
    void handoffs.handleAlarm(alarm);
  });

  browser.runtime.onInstalled.addListener(async () => {
    await registerContextMenu();
  });

  browser.action.onClicked.addListener(async () => {
    await browser.runtime.openOptionsPage();
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command === "open_unquote") {
      await browser.runtime.openOptionsPage();
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, _tab) => {
    if (info.menuItemId !== OPEN_MENU_ID) {
      return;
    }

    const selection = info.selectionText?.trim();
    if (!selection) {
      return;
    }

    const handoffId = await handoffs.create(selection);
    const url = new URL(browser.runtime.getURL("/options.html"));
    url.searchParams.set(handoffQueryParameter, handoffId ?? "failed");
    await browser.tabs.create({ url: url.href });
  });

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Runtime messages are untrusted until the message type and handoff id are validated.
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== claimSelectionHandoffMessageType
    ) {
      return undefined;
    }

    void handoffs.claim(message).then(sendResponse, () => sendResponse(""));
    return true;
  });
});
