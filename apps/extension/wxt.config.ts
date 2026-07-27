import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const icons = {
  "16": "icon16.png",
  "48": "icon48.png",
  "128": "icon128.png",
};

export default defineConfig({
  outDir: "../../dist",
  outDirTemplate: "extension",
  // Safari targets MV2 by default in WXT, but Safari 16.4+ is the floor anyway
  // because the selection handoff relies on storage.session.
  manifestVersion: 3,
  webExt: {
    disabled: true,
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: "__MSG_appName__",
    description: "__MSG_appDescription__",
    default_locale: "en",
    // Safari has no clipboardRead permission. Clipboard file paste already
    // feature-detects navigator.clipboard.read, so it degrades on its own.
    permissions:
      browser === "safari"
        ? ["contextMenus", "storage"]
        : ["contextMenus", "storage", "clipboardRead"],
    commands: {
      open_unquote: {
        suggested_key: {
          default: "Ctrl+Shift+U",
          mac: "Command+Shift+U",
        },
        description: "__MSG_openUnquote__",
      },
    },
    action: {
      default_icon: icons,
    },
    icons,
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  }),
});
