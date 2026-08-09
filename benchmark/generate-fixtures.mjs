import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generators = [
  "generate-agent-fixture.mjs",
  "generate-case2-fixtures.mjs",
  "generate-case4-fixture.mjs",
];

for (const generator of generators) {
  const result = spawnSync(process.execPath, [path.join(__dirname, generator), "--force"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
