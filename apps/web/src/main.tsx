import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import "@unquote/ui/styles.css";
import { clearLegacySourceHash } from "./legacy-source-hash";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg";

initializeThemePreference();
clearLegacySourceHash(window.location, window.history);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <UnquoteApp chromeWebStoreUrl={CHROME_WEB_STORE_URL} />
    </I18nProvider>
  </React.StrictMode>,
);
