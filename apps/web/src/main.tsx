import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";
import { createSourceHash, getInitialInputFromHash } from "./hash";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg";

const getInitialInput = () => getInitialInputFromHash(window.location.hash);

const syncHash = (value: string) => {
  const hash = createSourceHash(value);
  history.replaceState(
    null,
    "",
    hash ? `${window.location.pathname}${hash}` : window.location.pathname,
  );
};

const openFile = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.jsonl,application/json,text/plain";
  return new Promise<File | null>((resolve) => {
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <UnquoteApp
        initialInput={getInitialInput()}
        chromeWebStoreUrl={CHROME_WEB_STORE_URL}
        onSourceChange={syncHash}
        onOpenFile={async () => {
          const file = await openFile();
          return file;
        }}
      />
    </I18nProvider>
  </React.StrictMode>,
);
