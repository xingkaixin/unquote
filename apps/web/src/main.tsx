import React from "react";
import ReactDOM from "react-dom/client";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { I18nProvider, UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";

const HASH_PREFIX = "#data=";
const HASH_LIMIT = 4 * 1024;

const getInitialInput = () => {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) {
    return "";
  }

  const encoded = hash.slice(HASH_PREFIX.length);
  return decompressFromEncodedURIComponent(encoded) ?? "";
};

const syncHash = (value: string) => {
  if (!value.trim()) {
    history.replaceState(null, "", window.location.pathname);
    return;
  }

  const compressed = compressToEncodedURIComponent(value);
  if (!compressed || compressed.length > HASH_LIMIT) {
    history.replaceState(null, "", window.location.pathname);
    return;
  }

  history.replaceState(null, "", `${window.location.pathname}${HASH_PREFIX}${compressed}`);
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
        onSourceChange={syncHash}
        onOpenFile={async () => {
          const file = await openFile();
          if (!file) {
            return null;
          }

          const text = await file.text();
          return text;
        }}
      />
    </I18nProvider>
  </React.StrictMode>,
);
