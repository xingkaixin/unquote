import { readFileSync } from "node:fs";

const artifact = "dist/extension/manifest.json";
const manifest = JSON.parse(readFileSync(artifact, "utf8"));
const options = manifest.options_ui;

if (options?.page !== "options.html" || options.open_in_tab !== true) {
  console.error(`${artifact}: expected options.html to open in a tab`);
  process.exit(1);
}

console.log(`${artifact}: options.html opens in a tab`);
