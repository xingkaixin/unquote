import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { createExtensionManifest } from "./src/distribution";

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
  manifest: ({ browser }) => createExtensionManifest(browser),
});
