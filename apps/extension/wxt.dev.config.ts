import { defineConfig } from "wxt";
import baseConfig from "./wxt.config";

// Dev only needs its own output directory; sharing the base config is what
// keeps the development manifest from drifting away from what ships.
export default defineConfig({
  ...baseConfig,
  outDirTemplate: "dev-extension",
});
