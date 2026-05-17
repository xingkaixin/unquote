import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getArgValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};

const rows = Number(getArgValue("rows", "5000"));
const outputName = getArgValue("out", `case4-${Math.round(rows / 1000)}K-rows.jsonl`);
const force = process.argv.includes("--force");

if (!Number.isSafeInteger(rows) || rows <= 0) {
  throw new Error("--rows must be a positive integer");
}

const outputPath = path.resolve(__dirname, outputName);
if (!outputPath.startsWith(__dirname)) {
  throw new Error("--out must stay inside the benchmark directory");
}

if (fs.existsSync(outputPath) && !force) {
  console.log(`${path.relative(__dirname, outputPath)} already exists; pass --force to overwrite`);
  process.exit(0);
}

const makeRecord = (index) => {
  const eventType = index % 5 === 0 ? "tool_result" : index % 3 === 0 ? "tool_call" : "message";
  const nestedPayload = {
    id: index,
    eventType,
    request: {
      traceId: `trace-${Math.floor(index / 10)}`,
      spanId: `span-${index}`,
      tags: ["jsonl", "nested", "high-record-count"],
    },
    values: Array.from({ length: 8 }, (_, valueIndex) => ({
      key: `metric_${valueIndex}`,
      value: index * 10 + valueIndex,
    })),
  };

  return JSON.stringify({
    timestamp: new Date(Date.UTC(2026, 4, 17, 8, 0, index % 60)).toISOString(),
    level: index % 17 === 0 ? "warn" : "info",
    type: eventType,
    message: `high record fixture ${index}`,
    payload: JSON.stringify(nestedPayload),
  });
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const stream = fs.createWriteStream(outputPath, { encoding: "utf8" });

for (let index = 0; index < rows; index += 1) {
  stream.write(`${makeRecord(index)}\n`);
}

stream.end();
await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

const size = fs.statSync(outputPath).size;
console.log(`${path.relative(__dirname, outputPath)}: ${rows} records, ${size} bytes`);
