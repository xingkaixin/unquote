import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import { browser } from "wxt/browser";
import {
  claimSelectionHandoffMessageType,
  getHandoffIdFromSearch,
} from "../../src/selection-handoff";

initializeThemePreference();

const getPendingInput = async () => {
  const handoffId = getHandoffIdFromSearch(window.location.search);
  if (!handoffId) {
    return "";
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: claimSelectionHandoffMessageType,
      handoffId,
    });
    return typeof response === "string" ? response : "";
  } catch {
    return "";
  }
};

const root = ReactDOM.createRoot(document.getElementById("root")!);

void getPendingInput().then((initialInput) => {
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <UnquoteApp initialInput={initialInput} />
      </I18nProvider>
    </React.StrictMode>,
  );
});
