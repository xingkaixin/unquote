import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const webDist = path.join(repoRoot, "dist", "web");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const remoteDebuggingPort = Number(process.env.UNQUOTE_BENCH_PORT ?? 9222);
const sampleRuns = Number(process.env.UNQUOTE_BENCH_RUNS ?? 3);
const warmupRuns = Number(process.env.UNQUOTE_BENCH_WARMUPS ?? 1);
const outputPath = path.resolve(
  repoRoot,
  process.env.UNQUOTE_BENCH_OUTPUT ?? "benchmark/results/latest.json",
);

const defaultFixtures = [
  "benchmark/case1.jsonl",
  "benchmark/case2-1MB.jsonl",
  "benchmark/case2-5MB.jsonl",
  "benchmark/case2-10MB.jsonl",
  "benchmark/case4-5K-rows.jsonl",
];
const fixtureArgs = process.argv.slice(2);
const fixtures = fixtureArgs.length > 0 ? fixtureArgs : defaultFixtures;

const budgets = {
  firstRecordReadyMsP95: 1000,
  completeReadyMsP95: 3000,
  domNodesMax: 10000,
  jsHeapUsedSizeMBMax: 256,
};

const ensureFile = (target) => {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing file: ${target}`);
  }
};

const fixtureInfo = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  const input = fs.readFileSync(absolutePath, "utf8");
  return {
    path: relativePath,
    bytes: Buffer.byteLength(input),
    records: input.trim().split(/\r?\n/).filter(Boolean).length,
  };
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
    return { avg: null, min: null, p95: null, max: null };
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

      if (requestUrl.pathname === "/__benchmark__") {
        const requested = requestUrl.searchParams.get("file") ?? "";
        const filePath = path.resolve(repoRoot, requested);
        const benchmarkRoot = path.join(repoRoot, "benchmark");
        if (!filePath.startsWith(benchmarkRoot) || !fs.existsSync(filePath)) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        response.setHeader("Content-Type", "application/jsonl; charset=utf-8");
        fs.createReadStream(filePath).pipe(response);
        return;
      }

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

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Chrome remote debugger did not start");
};

const connectTarget = async () => {
  await waitForDebugger();
  const targetResponse = await fetch(
    `http://127.0.0.1:${remoteDebuggingPort}/json/new?about:blank`,
    { method: "PUT" },
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
    if (!payload.id) {
      return;
    }

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
  });

  const invoke = (method, params = {}) =>
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

  return { invoke, close };
};

const benchmarkCore = async (fixturesInfo) => {
  const coreModuleUrl = pathToFileURL(
    path.join(repoRoot, "packages", "core", "dist", "index.js"),
  ).href;
  const { parseInput } = await import(coreModuleUrl);

  return Object.fromEntries(
    fixturesInfo.map((fixture) => {
      const input = fs.readFileSync(path.join(repoRoot, fixture.path), "utf8");
      for (let index = 0; index < warmupRuns; index += 1) {
        parseInput(input, { forcedFormat: "jsonl" });
      }

      const samples = [];
      for (let index = 0; index < sampleRuns; index += 1) {
        const start = performance.now();
        parseInput(input, { forcedFormat: "jsonl" });
        samples.push(performance.now() - start);
      }

      return [
        fixture.path,
        {
          forcedJsonlMs: summarize(samples),
        },
      ];
    }),
  );
};

const runRenderFixture = async (client, fixture) => {
  await client.invoke("Page.navigate", { url: "http://127.0.0.1:4173/" });
  await client.invoke("Runtime.evaluate", {
    expression: `new Promise((resolve, reject) => {
      const startedAt = performance.now()
      const step = () => {
        if (document.querySelector('input[type="file"]')) {
          resolve(true)
          return
        }
        if (performance.now() - startedAt > 30000) {
          reject(new Error('timeout'))
          return
        }
        requestAnimationFrame(step)
      }
      step()
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  const documentNode = await client.invoke("DOM.getDocument");
  const fileInput = await client.invoke("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"]',
  });
  if (!fileInput.nodeId) {
    throw new Error("File input not found");
  }
  await client.invoke("Runtime.evaluate", {
    expression: "window.__unquoteBenchmarkStart = performance.now()",
  });
  await client.invoke("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [path.join(repoRoot, fixture.path)],
  });

  const expression = `(
    async () => {
      const expected = ${fixture.records}
      const start = window.__unquoteBenchmarkStart ?? performance.now()
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

      await waitFor(() => document.getElementById('record-1'))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const firstRecordReady = performance.now()

      await waitFor(() =>
        [...document.querySelectorAll('div')]
          .find((node) => node.textContent?.includes(expected + ' total'))
      )
      const completeReady = performance.now()

      return {
        firstRecordReadyMs: firstRecordReady - start,
        completeReadyMs: completeReady - start,
        domNodes: document.getElementsByTagName('*').length,
        recordCards: document.querySelectorAll('[id^="record-"]:not([id*=":"])').length,
      }
    }
  )()`;

  const result = await client.invoke("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  await client.invoke("HeapProfiler.collectGarbage").catch(() => null);
  const metrics = await client.invoke("Performance.getMetrics");
  const metricMap = Object.fromEntries(
    metrics.metrics.map((metric) => [metric.name, metric.value]),
  );

  return {
    ...result.result.value,
    layoutCount: metricMap.LayoutCount,
    recalcStyleCount: metricMap.RecalcStyleCount,
    taskDurationMs: metricMap.TaskDuration * 1000,
    jsHeapUsedSizeMB: metricMap.JSHeapUsedSize / 1024 / 1024,
  };
};

const benchmarkRender = async (fixturesInfo) => {
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
      "--lang=en-US",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const client = await connectTarget();
    await client.invoke("Page.enable");
    await client.invoke("DOM.enable");
    await client.invoke("Runtime.enable");
    await client.invoke("Performance.enable");
    await client.invoke("Page.addScriptToEvaluateOnNewDocument", {
      source: "localStorage.setItem('unquote-locale', 'en')",
    });

    const entries = [];

    for (const fixture of fixturesInfo) {
      for (let index = 0; index < warmupRuns; index += 1) {
        await runRenderFixture(client, fixture);
      }

      const runs = [];
      for (let index = 0; index < sampleRuns; index += 1) {
        runs.push(await runRenderFixture(client, fixture));
      }

      entries.push([
        fixture.path,
        {
          firstRecordReadyMs: summarize(runs.map((run) => run.firstRecordReadyMs)),
          completeReadyMs: summarize(runs.map((run) => run.completeReadyMs)),
          domNodes: summarize(runs.map((run) => run.domNodes)),
          recordCards: summarize(runs.map((run) => run.recordCards)),
          layoutCount: summarize(runs.map((run) => run.layoutCount)),
          recalcStyleCount: summarize(runs.map((run) => run.recalcStyleCount)),
          taskDurationMs: summarize(runs.map((run) => run.taskDurationMs)),
          jsHeapUsedSizeMB: summarize(runs.map((run) => run.jsHeapUsedSizeMB)),
        },
      ]);
    }

    await client.close();
    return Object.fromEntries(entries);
  } finally {
    chrome.kill("SIGKILL");
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

const collectBudgetFailures = (render) => {
  const failures = [];
  for (const [fixture, metrics] of Object.entries(render)) {
    if ((metrics.firstRecordReadyMs.p95 ?? 0) > budgets.firstRecordReadyMsP95) {
      failures.push(`${fixture} firstRecordReadyMs.p95 ${metrics.firstRecordReadyMs.p95}`);
    }
    if ((metrics.completeReadyMs.p95 ?? 0) > budgets.completeReadyMsP95) {
      failures.push(`${fixture} completeReadyMs.p95 ${metrics.completeReadyMs.p95}`);
    }
    if ((metrics.domNodes.max ?? 0) > budgets.domNodesMax) {
      failures.push(`${fixture} domNodes.max ${metrics.domNodes.max}`);
    }
    if ((metrics.jsHeapUsedSizeMB.max ?? 0) > budgets.jsHeapUsedSizeMBMax) {
      failures.push(`${fixture} jsHeapUsedSizeMB.max ${metrics.jsHeapUsedSizeMB.max}`);
    }
  }
  return failures;
};

const main = async () => {
  const startedAt = performance.now();
  const fixturesInfo = fixtures.map(fixtureInfo);
  const [core, render] = await Promise.all([
    benchmarkCore(fixturesInfo),
    benchmarkRender(fixturesInfo),
  ]);
  const budgetFailures = collectBudgetFailures(render);

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      sampleRuns,
      warmupRuns,
    },
    budgets,
    fixtures: fixturesInfo,
    core,
    render,
    budgetFailures,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (budgetFailures.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
