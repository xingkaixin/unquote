import React, { useEffect } from "react";
import { toast } from "sonner";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import { browser } from "wxt/browser";
import { claimOptionsInitialInput } from "../../src/options-initial-input";
import { handoffQueryParameter } from "../../src/selection-handoff";

initializeThemePreference();

const root = ReactDOM.createRoot(document.getElementById("root")!);

const OptionsApp = ({ initialInput }: { initialInput: string | null }) => {
  useEffect(() => {
    if (initialInput === null) {
      toast.error(browser.i18n.getMessage("selectionImportFailed"), {
        id: "selection-import-failed",
        duration: Infinity,
      });
    }
  }, [initialInput]);

  return <UnquoteApp initialInput={initialInput ?? ""} />;
};

const initialize = async () => {
  const url = new URL(window.location.href);
  const initialInput = await claimOptionsInitialInput(url.search, browser.runtime);
  if (url.searchParams.has(handoffQueryParameter)) {
    url.searchParams.delete(handoffQueryParameter);
    window.history.replaceState(window.history.state, "", url.href);
  }
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <OptionsApp initialInput={initialInput} />
      </I18nProvider>
    </React.StrictMode>,
  );
};

void initialize();
