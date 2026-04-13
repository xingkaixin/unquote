import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const payload = message as { type?: string };
      if (payload.type === "unquote:clear-selection") {
        const selection = window.getSelection();
        selection?.removeAllRanges();
      }
    });
  },
});
