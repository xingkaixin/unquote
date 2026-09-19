import { ImportWelcome, welcomeExample } from "./import-welcome";
import { welcomeCopy } from "./welcome-copy";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp, useTranslation } from "@unquote/ui";
import { initializeThemePreference } from "@unquote/ui/theme-preference";
import "@unquote/ui/styles.css";
import { changelogPaths } from "./changelog-routes";
import { clearLegacySourceHash } from "./legacy-source-hash";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg";

const EDGE_ADDONS_URL =
  "https://microsoftedge.microsoft.com/addons/detail/amdbhljchamjbhknbamkcemccmelegdp";

initializeThemePreference();

clearLegacySourceHash(window.location, window.history);

const WebApp = () => {
  const { t, locale } = useTranslation();
  return (
    <UnquoteApp
      changelogUrls={changelogPaths}
      chromeWebStoreUrl={CHROME_WEB_STORE_URL}
      edgeAddonsUrl={EDGE_ADDONS_URL}
      renderWelcome={(controls, onSelectSample) => (
        <ImportWelcome
          t={t}
          copy={welcomeCopy[locale]}
          onTryExample={() =>
            onSelectSample({
              id: "welcome",
              label: welcomeCopy[locale].tryExample,
              value: welcomeExample.input,
              expandedPathsByRecord: [{ recordId: "record-1", paths: ["$.body"] }],
            })
          }
        >
          {controls}
        </ImportWelcome>
      )}
    />
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <WebApp />
    </I18nProvider>
  </React.StrictMode>,
);
