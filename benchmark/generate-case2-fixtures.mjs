import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targets = [
  { path: "case2-1MB.jsonl", bytes: 1 * 1024 * 1024 },
  { path: "case2-5MB.jsonl", bytes: 5 * 1024 * 1024 },
  { path: "case2-10MB.jsonl", bytes: 10 * 1024 * 1024 },
];

const force = process.argv.includes("--force");

const makeRecord = (index) =>
  JSON.stringify({
    timestamp: new Date(Date.UTC(2026, 4, 3, 10, 0, index % 60)).toISOString(),
    type: "benchmark",
    message: `fixture record ${index}`,
    payload: JSON.stringify({
      id: index,
      tags: ["jsonl", "nested", "performance"],
      values: Array.from({ length: 12 }, (_, valueIndex) => ({
        key: `metric_${valueIndex}`,
        value: index * 100 + valueIndex,
      })),
    }),
  });

for (const target of targets) {
  const outputPath = path.join(__dirname, target.path);
  if (fs.existsSync(outputPath) && !force) {
    continue;
  }

  let size = 0;
  let index = 0;
  const lines = [];
  while (size < target.bytes) {
    const line = makeRecord(index);
    lines.push(line);
    size += Buffer.byteLength(`${line}\n`);
    index += 1;
  }

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
  console.log(`${target.path}: ${index} records, ${size} bytes`);
}
