import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  outDir: "../../dist",
  outDirTemplate: "dev-extension",
  webExt: {
    disabled: true,
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "__MSG_appName__",
    description: "__MSG_appDescription__",
    default_locale: "en",
    permissions: ["contextMenus", "storage"],
    commands: {
      open_unquote: {
        suggested_key: {
          default: "Ctrl+Shift+U",
          mac: "Command+Shift+U",
        },
        description: "__MSG_openUnquote__",
      },
    },
    action: {},
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
});
