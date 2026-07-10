import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createTranslator, en } from "@unquote/ui";
import {
  claimSelectionHandoffMessageType,
  createSelectionHandoff,
  createSelectionHandoffClaimer,
  handoffQueryParameter,
  type HandoffSessionStorage,
} from "../src/selection-handoff";

const OPEN_MENU_ID = "unquote-open-selection";
const t = createTranslator(en);
const handoffStorage = browser.storage.session as unknown as HandoffSessionStorage;
const claimSelectionHandoff = createSelectionHandoffClaimer(handoffStorage);

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
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: OPEN_MENU_ID,
      title: t("extension.openInUnquote"),
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

    const handoffId = await createSelectionHandoff(handoffStorage, selection);
    await openOptionsPage(handoffId ?? undefined);
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== claimSelectionHandoffMessageType
    ) {
      return undefined;
    }

    return claimSelectionHandoff(message);
  });
});
