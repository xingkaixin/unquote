import { defineConfig } from "wxt";
import baseConfig from "./wxt.config";

// The only Safari-specific build concern is the output directory: it feeds the
// Xcode project in apps/safari and must not overwrite the Chrome build.
export default defineConfig({
  ...baseConfig,
  outDirTemplate: "extension-safari",
});
