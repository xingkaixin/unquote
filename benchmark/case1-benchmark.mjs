import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const inputPath = path.join(repoRoot, "benchmark", "case1.jsonl");
const webDist = path.join(repoRoot, "dist", "web");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const remoteDebuggingPort = 9222;
const sampleRuns = 8;

const input = fs.readFileSync(inputPath, "utf8");
const expectedRecords = input.trim().split(/\r?\n/).filter(Boolean).length;

const ensureFile = (target) => {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing file: ${target}`);
  }
};

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
};

const summarize = (values) => {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) {
    return {
      avg: null,
      min: null,
      p95: null,
      max: null,
    };
  }

  return {
    avg: Number(average(valid).toFixed(2)),
    min: Number(Math.min(...valid).toFixed(2)),
    p95: Number(percentile(valid, 0.95).toFixed(2)),
    max: Number(Math.max(...valid).toFixed(2)),
  };
};

const serveStatic = (rootDir) =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath =
        requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
      const filePath = path.join(rootDir, relativePath);

      if (
        !filePath.startsWith(rootDir) ||
        !fs.existsSync(filePath) ||
        fs.statSync(filePath).isDirectory()
      ) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const extension = path.extname(filePath);
      const contentType =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
        }[extension] ?? "application/octet-stream";

      response.setHeader("Content-Type", contentType);
      fs.createReadStream(filePath).pipe(response);
    });

    server.listen(4173, "127.0.0.1", () => resolve(server));
  });

const waitForDebugger = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
      if (response.ok) {
        return response.json();
      }
    } catch {}

    await delay(100);
  }

  throw new Error("Chrome remote debugger did not start");
};

const connectTarget = async () => {
  await waitForDebugger();
  const targetResponse = await fetch(
    `http://127.0.0.1:${remoteDebuggingPort}/json/new?about:blank`,
    {
      method: "PUT",
    },
  );
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let messageId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (payload.id) {
      const resolver = pending.get(payload.id);
      if (!resolver) {
        return;
      }

      pending.delete(payload.id);
      if (payload.error) {
        resolver.reject(new Error(payload.error.message));
        return;
      }

      resolver.resolve(payload.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const close = async () => {
    await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/close/${target.id}`, {
      method: "PUT",
    }).catch(() => null);
    socket.close();
  };

  return { invoke: send, close };
};

const benchmarkCore = async () => {
  const coreModuleUrl = pathToFileURL(
    path.join(repoRoot, "packages", "core", "dist", "index.js"),
  ).href;
  const { parseInput } = await import(coreModuleUrl);

  const run = (label, options) => {
    for (let index = 0; index < 5; index += 1) {
      parseInput(input, options);
    }

    const samples = [];
    for (let index = 0; index < sampleRuns; index += 1) {
      const start = performance.now();
      parseInput(input, options);
      samples.push(performance.now() - start);
    }

    return [label, summarize(samples)];
  };

  return Object.fromEntries([
    run("auto", undefined),
    run("forcedJsonl", { forcedFormat: "jsonl" }),
  ]);
};

const benchmarkRender = async () => {
  ensureFile(path.join(webDist, "index.html"));
  ensureFile(chromePath);

  const server = await serveStatic(webDist);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unquote-bench-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const client = await connectTarget();
    await client.invoke("Page.enable");
    await client.invoke("Runtime.enable");
    await client.invoke("Performance.enable");

    const runs = [];

    for (let index = 0; index < 5; index += 1) {
      await client.invoke("Page.navigate", { url: "http://127.0.0.1:4173/" });
      await delay(350);

      const expression = `(
        async () => {
          const source = ${JSON.stringify(input)}
          const expected = ${expectedRecords}
          const waitFor = (predicate, timeout = 30000) =>
            new Promise((resolve, reject) => {
              const startedAt = performance.now()
              const step = () => {
                const value = predicate()
                if (value) {
                  resolve(value)
                  return
                }

                if (performance.now() - startedAt > timeout) {
                  reject(new Error('timeout'))
                  return
                }

                requestAnimationFrame(step)
              }

              step()
            })

          const textarea = await waitFor(() => document.querySelector('textarea'))
          const start = performance.now()
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
          textarea.focus()
          valueSetter.call(textarea, source)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))

          await waitFor(() =>
            [...document.querySelectorAll('div')]
              .find((node) => node.textContent?.toLowerCase().includes(expected + ' total'))
          )
          const statsReady = performance.now()

          await waitFor(() => document.getElementById('record-1'))
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const firstRecordReady = performance.now()

          return {
            statsMs: statsReady - start,
            firstRecordMs: firstRecordReady - start,
            domNodes: document.getElementsByTagName('*').length,
            recordCards: document.querySelectorAll('[id^="record-"]').length,
          }
        }
      )()`;

      const result = await client.invoke("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });

      const metrics = await client.invoke("Performance.getMetrics");
      const metricMap = Object.fromEntries(
        metrics.metrics.map((metric) => [metric.name, metric.value]),
      );

      runs.push({
        ...result.result.value,
        layoutCount: metricMap.LayoutCount,
        recalcStyleCount: metricMap.RecalcStyleCount,
        taskDuration: metricMap.TaskDuration,
        jsHeapUsedSize: metricMap.JSHeapUsedSize,
      });
    }

    await client.close();

    return {
      statsReady: summarize(runs.map((run) => run.statsMs)),
      firstRecordReady: summarize(runs.map((run) => run.firstRecordMs)),
      domNodes: summarize(runs.map((run) => run.domNodes)),
      recordCards: summarize(runs.map((run) => run.recordCards)),
      layoutCount: summarize(runs.map((run) => run.layoutCount)),
      recalcStyleCount: summarize(runs.map((run) => run.recalcStyleCount)),
      taskDuration: summarize(runs.map((run) => run.taskDuration * 1000)),
      jsHeapUsedSizeMB: summarize(runs.map((run) => run.jsHeapUsedSize / 1024 / 1024)),
    };
  } finally {
    chrome.kill("SIGKILL");
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const startedAt = performance.now();
  const [core, render] = await Promise.all([benchmarkCore(), benchmarkRender()]);

  const summary = {
    fixture: {
      path: "benchmark/case1.jsonl",
      bytes: Buffer.byteLength(input),
      records: expectedRecords,
    },
    core,
    render,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
  };

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
