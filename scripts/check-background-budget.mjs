import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// The background only formats a few strings and shuttles a selection through
// session storage. Importing a translator from the `@unquote/ui` root barrel
// used to pull the whole React app in with it — 281.45 kB minified. These
// ceilings sit just above the isolated cost so the regression is caught by
// size, not by review.
const maxBytes = 32_000;
const maxGzipBytes = 11_000;

// Minifiers rename identifiers but keep string literals, so a framework that
// re-enters the graph leaves these behind.
const forbiddenMarkers = [
  "react.transitional",
  "react.element",
  "data-sonner",
  "base-ui",
  "createElement",
];

const artifact = "dist/extension/background.js";
const code = readFileSync(artifact);
const gzipBytes = gzipSync(code).byteLength;
const failures = [];

console.log(`${artifact}: ${code.byteLength} bytes, ${gzipBytes} bytes gzipped`);

if (code.byteLength > maxBytes) {
  failures.push(`minified size ${code.byteLength} exceeds the ${maxBytes} byte budget`);
}
if (gzipBytes > maxGzipBytes) {
  failures.push(`gzip size ${gzipBytes} exceeds the ${maxGzipBytes} byte budget`);
}

const text = code.toString("utf8");
for (const marker of forbiddenMarkers) {
  if (text.includes(marker)) {
    failures.push(`found "${marker}", so a UI dependency re-entered the background graph`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}
