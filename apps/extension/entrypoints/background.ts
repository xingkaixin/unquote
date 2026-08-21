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
const handoffStorage = browser.storage.session as unknown as HandoffSessionStorage;
const handoffAlarms = browser.alarms as unknown as HandoffAlarms;
const handoffs = createSelectionHandoffStore(handoffStorage, handoffAlarms);

const openOptionsPage = async (handoffId?: string) => {
  const optionsUrl = new URL("/options.html", import.meta.url);
  if (handoffId) {
    optionsUrl.searchParams.set(handoffQueryParameter, handoffId);
  }
  await browser.tabs.create({
    url: optionsUrl.href,
  });
};

export default defineBackground(() => {
  void handoffs.sweep();

  browser.alarms.onAlarm.addListener((alarm) => {
    void handoffs.handleAlarm(alarm);
  });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: OPEN_MENU_ID,
      title: browser.i18n.getMessage("openInUnquote"),
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

  browser.contextMenus.onClicked.addListener(async (info, _tab) => {
    if (info.menuItemId !== OPEN_MENU_ID) {
      return;
    }

    const selection = info.selectionText?.trim();
    if (!selection) {
      return;
    }

    const handoffId = await handoffs.create(selection);
    await openOptionsPage(handoffId ?? undefined);
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== claimSelectionHandoffMessageType
    ) {
      return undefined;
    }

    void handoffs.claim(message).then(sendResponse, () => sendResponse(""));
    return true;
  });
});
