import React from "react";
import ReactDOM from "react-dom/client";
import { UnquoteApp } from "@unquote/ui";
import "@unquote/ui/styles.css";
import { browser } from "wxt/browser";

const getPendingInput = async () => {
  const response = await browser.runtime.sendMessage({ type: "unquote:get-pending-input" });
  return typeof response === "string" ? response : "";
};

const root = ReactDOM.createRoot(document.getElementById("root")!);

void getPendingInput().then((initialInput) => {
  root.render(
    <React.StrictMode>
      <UnquoteApp initialInput={initialInput} />
    </React.StrictMode>,
  );
});
