import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const workflowDirectory = ".github/workflows";
const workflowFiles = readdirSync(workflowDirectory)
  .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
  .sort();
const immutableActionPattern = /^[^@\s]+@[0-9a-f]{40}$/;
const failures = [];
let externalActionCount = 0;

for (const fileName of workflowFiles) {
  const filePath = path.join(workflowDirectory, fileName);
  const lines = readFileSync(filePath, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(.+?)\s*$/);
    if (!match) {
      return;
    }
    const reference = match[1]?.replace(/\s+#.*$/, "").trim() ?? "";
    if (reference.startsWith("./")) {
      return;
    }
    externalActionCount += 1;
    if (!immutableActionPattern.test(reference)) {
      failures.push(`${filePath}:${index + 1} uses mutable action reference ${reference}`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`${externalActionCount} external action references use full commit SHAs`);
