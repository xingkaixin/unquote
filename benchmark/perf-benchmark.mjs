import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  agentTrajectoryMetricForScenario,
  agentTrajectoryRenderBudgetContract,
  collectBenchmarkGateFailures,
  mergeMeasurementFailures,
  parseIntegerSetting,
  resolveBenchmarkOutputPath,
  resolvePerformanceMeasure,
  resolveBudgetSetting,
  summarize,
} from "./metrics.mjs";
import { benchmarkFileInputSelector } from "./browser-scenario.mjs";
import { benchmarkScenarioFor, defaultBenchmarkFixturePaths } from "./fixture-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const webDist = path.join(repoRoot, "dist", "web");
const browserScenarioPath = path.join(repoRoot, "benchmark", "browser-scenario.mjs");
const chromePaths = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
};

const resolveChromePath = () => {
  const candidates = [
    process.env.UNQUOTE_BENCH_CHROME,
    ...(chromePaths[process.platform] ?? []),
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      `Chrome executable not found. Set UNQUOTE_BENCH_CHROME or install Chrome in one of: ${candidates.join(", ")}`,
    );
  }

  return executable;
};

const readBudget = (name, fallback) => resolveBudgetSetting(name, process.env, fallback);

const chromePath = resolveChromePath();
const remoteDebuggingPort = Number(process.env.UNQUOTE_BENCH_PORT ?? 0);
const maxChromeDiagnosticLength = 8_192;
const chromeStartupTimeoutMs = 30_000;
const chromeStartupPollIntervalMs = 100;
// Three samples: gating on the median already removes the worst-run
// sensitivity, and raising this to five pushed the CI job past its 20 minute
// timeout even though the same change costs only ~1.4x locally.
// A run that samples nothing cannot prove anything, so this is a precondition
// rather than a hint.
const sampleRuns = parseIntegerSetting(
  "UNQUOTE_BENCH_RUNS",
  process.env.UNQUOTE_BENCH_RUNS ?? 3,
  1,
);
const warmupRuns = parseIntegerSetting(
  "UNQUOTE_BENCH_WARMUPS",
  process.env.UNQUOTE_BENCH_WARMUPS ?? 1,
  0,
);
const fixtureArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const fixtures = fixtureArgs.length > 0 ? fixtureArgs : defaultBenchmarkFixturePaths;
const outputPath = path.resolve(
  repoRoot,
  resolveBenchmarkOutputPath(process.env, fixtureArgs.length > 0),
);
const heapSnapshotDirectory = process.env.UNQUOTE_BENCH_HEAP_SNAPSHOT_DIR
  ? path.resolve(repoRoot, process.env.UNQUOTE_BENCH_HEAP_SNAPSHOT_DIR)
  : null;
const renderOnly = process.env.UNQUOTE_BENCH_RENDER_ONLY === "1";
const skipSearch = process.env.UNQUOTE_BENCH_SKIP_SEARCH === "1";
const debug = (message) => {
  if (process.env.UNQUOTE_BENCH_DEBUG === "1") {
    console.error(`[benchmark] ${message}`);
  }
};

const readProcessTable = () => {
  if (process.platform !== "linux") {
    return null;
  }

  return spawnSync("ps", ["-eo", "pid,ppid,stat,etime,comm", "--forest"], {
    encoding: "utf8",
  }).stdout.trim();
};

const budgets = {
  // 1500 rather than 1000: first-record latency covers worker startup and first
  // paint, the noisiest thing measured here (2.4x run-to-run on the median
  // across nine CI runs, worst observed median 549ms). completeReadyMs is the
  // steady metric for parse throughput; this one only guards gross startup
  // regressions, so it is sized to stay off CI's back.
  firstRecordReadyMsP50: readBudget("UNQUOTE_BENCH_FIRST_RECORD_BUDGET_MS", 1500),
  completeReadyMsP50: readBudget("UNQUOTE_BENCH_COMPLETE_BUDGET_MS", 3000),
  // Eight recent Ubuntu runs put the slowest fixture at 2169ms p50; 3000ms
  // preserves 38% shared-runner headroom while catching a material regression.
  searchReadyMsP50: readBudget("UNQUOTE_BENCH_SEARCH_BUDGET_MS", 3000),
  expandPathReadyMsP50: readBudget("UNQUOTE_BENCH_EXPAND_PATH_BUDGET_MS", 400),
  expandAllReadyMsP50: readBudget("UNQUOTE_BENCH_EXPAND_ALL_BUDGET_MS", 800),
  // Re-derived after the three-column redesign: the N record cards became one
  // record's tree plus a virtualized rail and a permanently mounted inspector,
  // which took the observed max across the default fixtures from 5000 to 1375.
  // Kept at the same ~2x headroom the old 10000 gave, so the gate stays as
  // sensitive as it was.
  domNodesMax: readBudget("UNQUOTE_BENCH_DOM_NODES_BUDGET", 3000),
  jsHeapUsedSizeMBMax: readBudget("UNQUOTE_BENCH_HEAP_BUDGET_MB", 256),
  // Three Ubuntu runs put Agent readiness at 217-250ms p50 and tool expansion
  // at 42-46ms p50. These limits leave shared-runner headroom while still
  // detecting a roughly 2.4x and 3.2x regression respectively.
  agentSessionReadyMsP50: readBudget("UNQUOTE_BENCH_AGENT_READY_BUDGET_MS", 600),
  agentToolReadyMsP50: readBudget("UNQUOTE_BENCH_AGENT_TOOL_BUDGET_MS", 150),
  agentTrajectoryBuildMsP50: readBudget("UNQUOTE_BENCH_AGENT_TRAJECTORY_BUDGET_MS", 50),
  // The trajectory contract owns its thresholds and runner overrides; see
  // docs/performance.md for the retained baseline rationale.
  ...Object.fromEntries(
    agentTrajectoryRenderBudgetContract.map(({ budgetKey, envKey, defaultBudget }) => [
      budgetKey,
      readBudget(envKey, defaultBudget),
    ]),
  ),
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
    scenario: benchmarkScenarioFor(relativePath),
    bytes: Buffer.byteLength(input),
    records: input.trim().split(/\r?\n/).filter(Boolean).length,
  };
};

const serveStatic = (rootDir) =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (requestUrl.pathname === "/__benchmark__/browser-scenario.js") {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        fs.createReadStream(browserScenarioPath).pipe(response);
        return;
      }

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

const waitForDebugger = async (getDebuggerPort, getDiagnostics) => {
  const deadline = performance.now() + chromeStartupTimeoutMs;
  while (performance.now() < deadline) {
    const debuggerPort = getDebuggerPort();
    try {
      if (debuggerPort !== null) {
        const response = await fetch(`http://127.0.0.1:${debuggerPort}/json/version`);
        if (response.ok) {
          return debuggerPort;
        }
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, chromeStartupPollIntervalMs));
  }

  throw new Error(`Chrome remote debugger did not start\n${getDiagnostics()}`);
};

const connectTarget = async (getDebuggerPort, getDiagnostics) => {
  const debuggerPort = await waitForDebugger(getDebuggerPort, getDiagnostics);
  const targetResponse = await fetch(`http://127.0.0.1:${debuggerPort}/json/new?about:blank`, {
    method: "PUT",
  });
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let messageId = 0;
  const pending = new Map();
  const notifications = new Map();

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (!payload.id) {
      for (const listener of notifications.get(payload.method) ?? []) {
        listener(payload.params);
      }
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

  const subscribe = (method, listener) => {
    const listeners = notifications.get(method) ?? new Set();
    listeners.add(listener);
    notifications.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        notifications.delete(method);
      }
    };
  };

  return { invoke, close, subscribe };
};

const captureHeapSnapshot = async (client, fixture) => {
  if (!heapSnapshotDirectory) {
    return null;
  }

  fs.mkdirSync(heapSnapshotDirectory, { recursive: true });
  const name = path.basename(fixture.path, path.extname(fixture.path));
  const snapshotPath = path.join(heapSnapshotDirectory, `${name}.heapsnapshot`);
  const snapshot = fs.createWriteStream(snapshotPath);
  const unsubscribe = client.subscribe("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
    snapshot.write(chunk);
  });
  const snapshotFinished = new Promise((resolve, reject) => {
    snapshot.once("finish", resolve);
    snapshot.once("error", reject);
  });

  try {
    await client.invoke("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    unsubscribe();
    snapshot.end();
    await snapshotFinished;
  }

  console.log(`Heap snapshot: ${snapshotPath}`);
  return snapshotPath;
};

const benchmarkCore = async (fixturesInfo) => {
  const coreModuleUrl = pathToFileURL(
    path.join(repoRoot, "packages", "core", "dist", "index.js"),
  ).href;
  const { parseInput } = await import(coreModuleUrl);

  return Object.fromEntries(
    fixturesInfo.map((fixture) => {
      debug(`Parsing ${fixture.path} in the core benchmark`);
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

const clearPerformanceMeasure = (client, entryName) =>
  client.invoke("Runtime.evaluate", {
    expression: `performance.clearMeasures(${JSON.stringify(entryName)})`,
    returnByValue: true,
  });

const evaluateBrowserScenario = async (client, operation, input) => {
  const result = await client.invoke("Runtime.evaluate", {
    expression: `import("/__benchmark__/browser-scenario.js").then((scenario) => scenario[${JSON.stringify(operation)}](${JSON.stringify(input)}))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? `Browser scenario ${operation} failed`);
  }
  return result.result.value;
};

const runRenderFixture = async (client, fixture) => {
  debug(`Rendering ${fixture.path}`);
  const agentTrajectoryMetric = agentTrajectoryMetricForScenario(fixture.scenario);
  if (agentTrajectoryMetric) {
    await clearPerformanceMeasure(client, agentTrajectoryMetric.entryName);
  }
  await client.invoke("Page.navigate", { url: "http://127.0.0.1:4173/" });
  await evaluateBrowserScenario(client, "waitForBenchmarkFileInput");
  const documentNode = await client.invoke("DOM.getDocument");
  const fileInput = await client.invoke("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: benchmarkFileInputSelector,
  });
  if (!fileInput.nodeId) {
    throw new Error("File input not found");
  }
  if (agentTrajectoryMetric) {
    await clearPerformanceMeasure(client, agentTrajectoryMetric.entryName);
  }
  await evaluateBrowserScenario(client, "startBenchmark");
  await client.invoke("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [path.join(repoRoot, fixture.path)],
  });

  const settled = await evaluateBrowserScenario(client, "waitForBenchmarkReady", {
    expectedFile: path.basename(fixture.path),
    expectsAgentSession: fixture.scenario === "agent-session",
  });

  const readMetrics = async () => {
    await client.invoke("HeapProfiler.collectGarbage").catch(() => null);
    const metrics = await client.invoke("Performance.getMetrics");
    return Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
  };
  const settledMetrics = await readMetrics();
  debug(`Running interactions for ${fixture.path}`);

  const interactionResult = await evaluateBrowserScenario(client, "runBenchmarkInteractions", {
    expectsAgentSession: fixture.scenario === "agent-session",
    skipSearch,
    trajectoryMeasureName: agentTrajectoryMetric?.entryName ?? null,
  });
  const interactionMetrics = await readMetrics();
  const { agentTrajectoryBuildEntries, ...interactionValues } = interactionResult;
  let interaction = interactionValues;
  if (agentTrajectoryMetric) {
    const trajectorySample = resolvePerformanceMeasure(
      agentTrajectoryMetric,
      agentTrajectoryBuildEntries,
    );
    const trajectoryFailure = trajectorySample.failure
      ? {
          measurementFailures: {
            [agentTrajectoryMetric.metric]: trajectorySample.failure,
          },
        }
      : {};
    interaction = {
      ...interactionValues,
      [agentTrajectoryMetric.metric]: trajectorySample.value,
      measurementFailures: mergeMeasurementFailures([interactionValues, trajectoryFailure]),
    };
  }
  debug(`Capturing heap snapshot for ${fixture.path}`);
  const heapSnapshot = await captureHeapSnapshot(client, fixture);

  return {
    ...settled,
    ...interaction,
    domNodes: Math.max(
      settled.domNodes,
      interaction.domNodes,
      interaction.trajectoryPageDomNodes ?? 0,
    ),
    railRows: Math.max(settled.railRows, interaction.railRows),
    measurementFailures: mergeMeasurementFailures([settled, interaction]),
    layoutCount: interactionMetrics.LayoutCount,
    recalcStyleCount: interactionMetrics.RecalcStyleCount,
    taskDurationMs: interactionMetrics.TaskDuration * 1000,
    jsHeapUsedSizeMB:
      Math.max(settledMetrics.JSHeapUsedSize, interactionMetrics.JSHeapUsedSize) / 1024 / 1024,
    heapSnapshot,
  };
};

const benchmarkRender = async (fixturesInfo) => {
  ensureFile(path.join(webDist, "index.html"));
  ensureFile(chromePath);

  const server = await serveStatic(webDist);
  debug("Starting Chrome for the render benchmark");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unquote-bench-"));
  const chromeArguments = [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    "--lang=en-US",
    "--no-first-run",
    "--no-default-browser-check",
    // The workspace only lays out as three columns at the Tailwind `lg`
    // breakpoint (>=1024px); force a wide window so the rail and the node
    // inspector are measured alongside the tree.
    "--window-size=1440,900",
    "about:blank",
  ];
  const chrome = spawn(chromePath, chromeArguments, { stdio: ["ignore", "ignore", "pipe"] });
  let chromeStderr = "";
  let chromeExit = null;
  chrome.stderr.on("data", (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-maxChromeDiagnosticLength);
  });
  const chromeExited = new Promise((resolve) => {
    chrome.once("exit", (code, signal) => {
      chromeExit = { code, signal };
      resolve();
    });
  });
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const getDebuggerPort = () => {
    if (remoteDebuggingPort !== 0) {
      return remoteDebuggingPort;
    }
    if (!fs.existsSync(activePortPath)) {
      return null;
    }

    const port = Number(fs.readFileSync(activePortPath, "utf8").split(/\r?\n/, 1)[0]);
    return Number.isInteger(port) && port > 0 ? port : null;
  };
  const getChromeDiagnostics = () =>
    JSON.stringify({
      executable: chromePath,
      arguments: chromeArguments,
      debuggerPort: getDebuggerPort(),
      exit: chromeExit,
      stderr: chromeStderr.trim(),
      processTable: readProcessTable(),
    });

  try {
    const client = await connectTarget(getDebuggerPort, getChromeDiagnostics);
    await client.invoke("Page.enable");
    await client.invoke("DOM.enable");
    await client.invoke("Runtime.enable");
    await client.invoke("Performance.enable");
    await client.invoke("Page.addScriptToEvaluateOnNewDocument", {
      source: "localStorage.setItem('unquote-locale', 'en')",
    });

    const entries = [];

    for (const fixture of fixturesInfo) {
      debug(`Benchmarking render fixture ${fixture.path}`);
      for (let index = 0; index < warmupRuns; index += 1) {
        await runRenderFixture(client, fixture);
      }

      const runs = [];
      for (let index = 0; index < sampleRuns; index += 1) {
        runs.push(await runRenderFixture(client, fixture));
      }

      const agentTrajectoryMetric = agentTrajectoryMetricForScenario(fixture.scenario);

      entries.push([
        fixture.path,
        {
          firstRecordReadyMs: summarize(runs.map((run) => run.firstRecordReadyMs)),
          completeReadyMs: summarize(runs.map((run) => run.completeReadyMs)),
          agentSessionReadyMs: summarize(runs.map((run) => run.agentSessionReadyMs)),
          ...(agentTrajectoryMetric
            ? {
                [agentTrajectoryMetric.metric]: summarize(
                  runs.map((run) => run[agentTrajectoryMetric.metric]),
                ),
              }
            : {}),
          ...(fixture.scenario === "agent-session"
            ? Object.fromEntries(
                agentTrajectoryRenderBudgetContract.map(({ metric }) => [
                  metric,
                  summarize(runs.map((run) => run[metric])),
                ]),
              )
            : {}),
          searchReadyMs: summarize(runs.map((run) => run.searchReadyMs)),
          agentToolReadyMs: summarize(runs.map((run) => run.agentToolReadyMs)),
          expandPathReadyMs: summarize(runs.map((run) => run.expandPathReadyMs)),
          expandAllReadyMs: summarize(runs.map((run) => run.expandAllReadyMs)),
          railReadyMs: summarize(runs.map((run) => run.railReadyMs)),
          domNodes: summarize(runs.map((run) => run.domNodes)),
          railRows: summarize(runs.map((run) => run.railRows)),
          layoutCount: summarize(runs.map((run) => run.layoutCount)),
          recalcStyleCount: summarize(runs.map((run) => run.recalcStyleCount)),
          taskDurationMs: summarize(runs.map((run) => run.taskDurationMs)),
          measurementFailures: mergeMeasurementFailures(runs),
          jsHeapUsedSizeMB: summarize(runs.map((run) => run.jsHeapUsedSizeMB)),
        },
      ]);
    }

    await client.close();
    return Object.fromEntries(entries);
  } finally {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGKILL");
    }
    await chromeExited;
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const startedAt = performance.now();
  debug("Reading fixture metadata");
  const fixturesInfo = fixtures.map(fixtureInfo);
  debug(`Running ${fixturesInfo.length} fixture(s)${renderOnly ? " in render-only mode" : ""}`);
  const [core, render] = renderOnly
    ? [{}, await benchmarkRender(fixturesInfo)]
    : await Promise.all([benchmarkCore(fixturesInfo), benchmarkRender(fixturesInfo)]);
  const budgetFailures = collectBenchmarkGateFailures(fixturesInfo, render, budgets, sampleRuns);

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
