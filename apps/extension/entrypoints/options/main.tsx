import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import { browser } from "wxt/browser";
import { claimOptionsInitialInput } from "../../src/options-initial-input";

initializeThemePreference();

const root = ReactDOM.createRoot(document.getElementById("root")!);

void claimOptionsInitialInput(window.location.search, browser.runtime).then((initialInput) => {
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <UnquoteApp initialInput={initialInput} />
      </I18nProvider>
    </React.StrictMode>,
  );
});
