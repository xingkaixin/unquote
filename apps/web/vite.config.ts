import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderChangelogPage } from "./src/changelog-page.ts";
import { isChangelogLocale } from "./src/changelog-routes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const changelogLocalePattern = /\sdata-changelog-locale="([^"]+)"/;

const changelogPagesPlugin = {
  name: "unquote-changelog-pages",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      const locale = html.match(changelogLocalePattern)?.[1];
      if (!locale) return html;
      if (!isChangelogLocale(locale)) {
        throw new Error(`Unsupported changelog locale: ${locale}`);
      }
      return renderChangelogPage(locale);
    },
  },
} satisfies Plugin;

export default defineConfig({
  plugins: [changelogPagesPlugin, react(), tailwindcss()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "./index.html"),
        changelog: path.resolve(__dirname, "./changelog/index.html"),
        changelogZhCN: path.resolve(__dirname, "./zh-CN/changelog/index.html"),
        changelogJa: path.resolve(__dirname, "./ja/changelog/index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
