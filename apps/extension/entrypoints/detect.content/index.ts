import { browser } from "wxt/browser";
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated";
import { defineContentScript } from "wxt/utils/define-content-script";

const isJsonLike = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return trimmed.split(/\r?\n/).every((line) => {
      if (!line.trim()) {
        return true;
      }

      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });
  }
};

export default defineContentScript({
  matches: ["<all_urls>"],
  main(ctx) {
    document.querySelectorAll("pre, code").forEach((element) => {
      const text = element.textContent?.trim();
      if (!text || !isJsonLike(text) || element.getAttribute("data-unquote-bound")) {
        return;
      }

      element.setAttribute("data-unquote-bound", "true");

      const ui = createIntegratedUi(ctx, {
        position: "inline",
        anchor: element as HTMLElement,
        onMount: (container: HTMLElement) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "mb-2 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 shadow-sm";
          button.textContent = "Unquote";
          button.addEventListener("click", () => {
            void browser.runtime.sendMessage({ type: "unquote:open-with-input", payload: text });
          });
          container.append(button);
          return button;
        },
        onRemove: (button?: HTMLButtonElement) => button?.remove(),
      });

      ui.mount();
    });
  },
});
