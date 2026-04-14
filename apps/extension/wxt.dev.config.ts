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
    name: "Unquote",
    description: "Expand stringified JSON and browse JSONL locally.",
    permissions: ["contextMenus", "storage"],
    commands: {
      open_unquote: {
        suggested_key: {
          default: "Ctrl+Shift+U",
          mac: "Command+Shift+U",
        },
        description: "Open Unquote",
      },
    },
    action: {},
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
});
