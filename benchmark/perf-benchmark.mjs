import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  agentTrajectoryBuildMetric,
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
import { benchmarkScenarioFor, defaultBenchmarkFixturePaths } from "./fixture-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const webDist = path.join(repoRoot, "dist", "web");
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
// Deferred file records only grow an expandable row once they hydrate; give
// that a bounded wait rather than assuming it has already happened.
const expandableRowTimeoutMs = 10_000;
// Tree rows mount lazily as they enter the viewport, so the nearest stringified
// node can sit below the fold on a wide record. Bounded so a fixture that truly
// has none fails instead of scrolling to the end of a huge file.
const expandPathScrollSteps = 40;
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

const runRenderFixture = async (client, fixture) => {
  debug(`Rendering ${fixture.path}`);
  const agentTrajectoryMetric = agentTrajectoryMetricForScenario(fixture.scenario);
  if (agentTrajectoryMetric) {
    await clearPerformanceMeasure(client, agentTrajectoryMetric.entryName);
  }
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
  if (agentTrajectoryMetric) {
    await clearPerformanceMeasure(client, agentTrajectoryMetric.entryName);
  }
  await client.invoke("Runtime.evaluate", {
    expression: "window.__unquoteBenchmarkStart = performance.now()",
  });
  await client.invoke("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [path.join(repoRoot, fixture.path)],
  });

  const settleExpression = `(
    async () => {
      const expectedFile = ${JSON.stringify(path.basename(fixture.path))}
      const expectsAgentSession = ${JSON.stringify(fixture.scenario === "agent-session")}
      const start = window.__unquoteBenchmarkStart ?? performance.now()
      const waitFor = (stage, predicate, timeout = 30000) =>
        new Promise((resolve, reject) => {
          let settled = false
          const finish = (apply) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            apply()
          }
          const fail = () =>
            finish(() => {
              const shell = document.querySelector('.uq-shell')
              reject(new Error('timeout ' + stage + ' ' + JSON.stringify(shell?.dataset ?? {})))
            })
          // The deadline needs its own timer: requestAnimationFrame stalls
          // under a long main-thread block, and a rAF-only check would then
          // never run, leaving the run hanging with no diagnostic at all.
          const timer = setTimeout(fail, timeout)
          const step = () => {
            if (settled) return
            const value = predicate()
            if (value) {
              finish(() => resolve(value))
              return
            }
            requestAnimationFrame(step)
          }
          step()
        })
      const settleFrames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      await waitFor('source-file', () =>
        document.querySelector('.uq-shell')?.dataset.sourceFile === expectedFile
      )
      await waitFor('first-record', () => document.getElementById('record-1'))
      await settleFrames()
      const firstRecordReady = performance.now()

      const shell = await waitFor('parse-complete', () => {
        const candidate = document.querySelector('.uq-shell')
        return candidate?.dataset.sourceFile === expectedFile &&
          candidate.dataset.parseState === 'complete'
          ? candidate
          : null
      })
      let agentSessionReadyMs = null
      let agentTrajectoryBuildEntries = null
      if (expectsAgentSession && shell.dataset.agentSession !== 'true') {
        throw new Error('expected Agent Session, received ' + JSON.stringify(shell.dataset))
      }
      if (shell.dataset.agentSession === 'true') {
        await waitFor('agent-view', () => {
          const agentShell = document.querySelector('.uq-agent-shell')
          const metrics = agentShell?.querySelector('[data-agent-metrics]')
          return shell.dataset.outputView === 'agent' &&
            Number(metrics?.dataset.agentMetrics) > 0
        })
        await settleFrames()
        agentSessionReadyMs = performance.now() - start
        if (expectsAgentSession) {
          agentTrajectoryBuildEntries = performance
            .getEntriesByName(${JSON.stringify(agentTrajectoryBuildMetric.entryName)}, 'measure')
            .map((entry) => ({ duration: entry.duration }))
        }
      } else {
        await waitFor('json-view', () => shell.dataset.outputView === 'json')
      }
      await settleFrames()
      const completeReady = performance.now()

      return {
        firstRecordReadyMs: firstRecordReady - start,
        completeReadyMs: completeReady - start,
        agentSessionReadyMs,
        agentTrajectoryBuildEntries,
        domNodes: document.getElementsByTagName('*').length,
        railRows: document.querySelectorAll('[data-record-rail] [data-record-id]').length,
      }
    }
  )()`;

  const settledResult = await client.invoke("Runtime.evaluate", {
    expression: settleExpression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (settledResult.exceptionDetails) {
    throw new Error(settledResult.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  const { agentTrajectoryBuildEntries, ...settledValues } = settledResult.result.value;
  let settled = settledValues;
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
    settled = {
      ...settledValues,
      [agentTrajectoryMetric.metric]: trajectorySample.value,
      measurementFailures: mergeMeasurementFailures([settledValues, trajectoryFailure]),
    };
  }

  const readMetrics = async () => {
    await client.invoke("HeapProfiler.collectGarbage").catch(() => null);
    const metrics = await client.invoke("Performance.getMetrics");
    return Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
  };
  const settledMetrics = await readMetrics();
  debug(`Running interactions for ${fixture.path}`);

  const interactionExpression = `(
    async () => {
      const waitFor = (stage, predicate, timeout = 30000) =>
        new Promise((resolve, reject) => {
          let settled = false
          const finish = (apply) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            apply()
          }
          const fail = () =>
            finish(() => {
              const shell = document.querySelector('.uq-shell')
              reject(new Error('timeout ' + stage + ' ' + JSON.stringify(shell?.dataset ?? {})))
            })
          // The deadline needs its own timer: requestAnimationFrame stalls
          // under a long main-thread block, and a rAF-only check would then
          // never run, leaving the run hanging with no diagnostic at all.
          const timer = setTimeout(fail, timeout)
          const step = () => {
            if (settled) return
            const value = predicate()
            if (value) {
              finish(() => resolve(value))
              return
            }
            requestAnimationFrame(step)
          }
          step()
        })
      const settleFrames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const visibleTrajectoryLedgerItem = (trajectoryRoot) => {
        for (const candidate of trajectoryRoot.querySelectorAll('[data-trajectory-item-token]')) {
          if (!(candidate instanceof HTMLElement)) continue
          const ledger = candidate.closest('[role="list"]')
          if (!(ledger instanceof HTMLElement)) continue
          const itemRect = candidate.getBoundingClientRect()
          const ledgerRect = ledger.getBoundingClientRect()
          const isVisible = itemRect.width > 0 &&
            itemRect.height > 0 &&
            itemRect.left < ledgerRect.right &&
            itemRect.right > ledgerRect.left &&
            itemRect.top < ledgerRect.bottom &&
            itemRect.bottom > ledgerRect.top
          if (isVisible) return candidate
        }
        return null
      }
      const shell = document.querySelector('.uq-shell')
      const expectsAgentSession = ${JSON.stringify(fixture.scenario === "agent-session")}

      let agentToolReadyMs = null
      let agentTrajectoryReadyMs = null
      let agentTrajectoryItemSelectionReadyMs = null
      let agentTrajectoryDomNodes = null
      let trajectoryPageDomNodes = null
      if (expectsAgentSession) {
        if (shell.dataset.agentSession !== 'true' || shell.dataset.outputView !== 'agent') {
          throw new Error('Agent interaction started outside the Agent view')
        }
        const toolCard = await waitFor(
          'agent-tool-card',
          () => document.querySelector('[data-agent-tool-card]')
        )
        const agentToolStart = performance.now()
        toolCard.click()
        await waitFor('agent-tool-expand', () => toolCard.getAttribute('aria-pressed') === 'true')
        await settleFrames()
        agentToolReadyMs = performance.now() - agentToolStart

        const trajectoryTab = await waitFor(
          'trajectory-tab',
          () => document.querySelector('[data-output-tab="trajectory"]')
        )
        if (!(trajectoryTab instanceof HTMLElement)) {
          throw new Error('Trajectory tab is not an HTML element')
        }
        const trajectoryReadyStart = performance.now()
        trajectoryTab.click()
        const trajectoryState = await waitFor('trajectory-ready', () => {
          const trajectoryRoot = document.querySelector('[data-trajectory-ready]')
          if (!(trajectoryRoot instanceof HTMLElement) || shell.dataset.outputView !== 'trajectory') {
            return null
          }
          const overview = trajectoryRoot.querySelector('[data-trajectory-overview]')
          if (Number(overview?.getAttribute('data-bucket-count')) <= 0) {
            return null
          }
          const ledgerItem = visibleTrajectoryLedgerItem(trajectoryRoot)
          return ledgerItem ? { trajectoryRoot, ledgerItem } : null
        })
        await settleFrames()
        const trajectoryRoot = trajectoryState.trajectoryRoot
        const ledgerItem = visibleTrajectoryLedgerItem(trajectoryRoot)
        if (!ledgerItem) {
          throw new Error('No geometrically visible trajectory ledger item after settling')
        }
        agentTrajectoryReadyMs = performance.now() - trajectoryReadyStart
        agentTrajectoryDomNodes = 1 + trajectoryRoot.querySelectorAll('*').length
        trajectoryPageDomNodes = document.getElementsByTagName('*').length

        const selectedItemToken = ledgerItem.getAttribute('data-trajectory-item-token')
        if (!selectedItemToken) {
          throw new Error('Visible trajectory ledger item is missing its identity')
        }
        const itemSelectionStart = performance.now()
        ledgerItem.click()
        await waitFor(
          'trajectory-item-selection',
          () =>
            ledgerItem.getAttribute('aria-current') === 'true' &&
            trajectoryRoot
              .querySelector('[data-trajectory-detail-item-token]')
              ?.getAttribute('data-trajectory-detail-item-token') === selectedItemToken,
        )
        await settleFrames()
        agentTrajectoryItemSelectionReadyMs = performance.now() - itemSelectionStart
      }

      if (shell.dataset.agentSession === 'true') {
        const jsonTabs = document.querySelectorAll('[data-output-tab="json"]')
        const jsonTab = jsonTabs[jsonTabs.length - 1]
        jsonTab?.click()
        await waitFor('json-view', () => shell.dataset.outputView === 'json')
        await settleFrames()
      }

      // Expansion is measured before the search step and restored afterwards:
      // search populates its own expansion state, which makes anything measured
      // after it depend on whether the query happened to match inside
      // stringified JSON.
      const expansionControl = (label) =>
        [...document.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === label
        )
      // The per-row toggle is an aria-hidden span; its row owns the click
      // handler and the aria-expanded state. It used to be matched by
      // [aria-label^="Toggle"], which stopped existing in #67 and left
      // expandPathReadyMs silently null on every fixture since.
      // A missing selector or an unhydrated row is a benchmark failure, not a
      // silently absent metric: the reason travels back so the budget layer can
      // name what did not run.
      const measurementFailures = {}
      const findToggleRow = () =>
        document.querySelector('[data-tree-toggle]')?.closest('[role="treeitem"]') ?? null
      // The tree pane owns the scroller the toggle scan walks. The fallback
      // heuristic picks the largest overflowing div, which on a large fixture
      // is the record rail (one row per record) rather than one record's tree.
      const treeScroller = () =>
        document.querySelector('[data-tree-scroller]') ??
        (() => {
          let best = document.scrollingElement ?? document.documentElement
          let bestOverflow = best.scrollHeight - best.clientHeight
          for (const node of document.querySelectorAll('div')) {
            const overflow = node.scrollHeight - node.clientHeight
            if (overflow <= bestOverflow) continue
            const overflowY = getComputedStyle(node).overflowY
            if (overflowY === 'auto' || overflowY === 'scroll') {
              best = node
              bestOverflow = overflow
            }
          }
          return best
        })()
      const mountedRailRows = () =>
        document.querySelectorAll('[data-record-rail] [data-record-id]')
      const railRow = (index) => mountedRailRows()[index] ?? null
      const scanForToggleRow = async () => {
        const scroller = treeScroller()
        scroller.scrollTop = 0
        await settleFrames()
        let row = findToggleRow()
        let scrolledViewports = 0
        while (!row && scrolledViewports < ${expandPathScrollSteps}) {
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
            break
          }
          scroller.scrollTop += scroller.clientHeight
          scrolledViewports += 1
          await settleFrames()
          row = findToggleRow()
        }
        return row
      }

      let firstToggleRow = await waitFor(
        'expandable-row',
        findToggleRow,
        ${expandableRowTimeoutMs}
      ).catch(() => null)
      firstToggleRow ??= await scanForToggleRow()
      // Only the selected record renders a tree now, and only stringified JSON
      // grows a toggle — which record 1 need not carry (a Codex session_meta
      // line does not). Walk the mounted rail rows until a record that does
      // shows up, which is the record the old whole-page scan would have found.
      let scannedRecords = 1
      while (!firstToggleRow && railRow(scannedRecords)) {
        railRow(scannedRecords).click()
        scannedRecords += 1
        await settleFrames()
        firstToggleRow = await scanForToggleRow()
      }
      if (!firstToggleRow) {
        measurementFailures.expandPathReadyMs =
          'no [data-tree-toggle] row in ' + scannedRecords + ' rail records'
      }

      let expandPathReadyMs = null
      if (firstToggleRow) {
        const expandPathStart = performance.now()
        firstToggleRow.querySelector('[data-tree-toggle]').click()
        await waitFor('expand-path', () => firstToggleRow.getAttribute('aria-expanded') === 'true')
        await settleFrames()
        expandPathReadyMs = performance.now() - expandPathStart

        // Restore the collapsed baseline so Expand All starts from a known state.
        firstToggleRow.querySelector('[data-tree-toggle]').click()
        await waitFor('collapse-path', () => firstToggleRow.getAttribute('aria-expanded') !== 'true')
        await settleFrames()
      }

      // domNodes is sampled from the default view, so the scan above gives back
      // the scroll position it borrowed.
      treeScroller().scrollTop = 0
      await settleFrames()

      // Expand All applies one expansion write per stringified node — a
      // different path from the single toggle above, and the one that
      // regressed to O(n^2) in UQ-113. Its scope narrowed with the redesign
      // from every visible record to the displayed one, so values recorded
      // before that are not comparable with the ones recorded after.
      // Expand All and Collapse All now render side by side, so their presence
      // no longer reports the expansion state; data-expanded-nested does.
      let expandAllReadyMs = null
      if (!expansionControl('Expand All')) {
        measurementFailures.expandAllReadyMs = 'no "Expand All" control was rendered'
      } else {
        const expandAllStart = performance.now()
        expansionControl('Expand All').click()
        await waitFor('expand-all', () => Number(shell.dataset.expandedNested) > 0)
        await settleFrames()
        expandAllReadyMs = performance.now() - expandAllStart

        expansionControl('Collapse All').click()
        await waitFor('collapse-all', () => Number(shell.dataset.expandedNested) === 0)
        await settleFrames()
      }

      let searchReadyMs = null
      if (!${JSON.stringify(skipSearch)}) {
        const searchInput = await waitFor('search-input', () =>
          [...document.querySelectorAll('form input[type="text"]')].at(-1)
        )
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (!valueSetter || !searchInput.form) {
          throw new Error('Search form not found')
        }

        const searchStart = performance.now()
        valueSetter.call(searchInput, 'nested')
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        searchInput.form.requestSubmit()
        const searchResult = await waitFor('search-complete', () =>
          shell.dataset.searchQuery === 'nested' &&
          ['complete', 'error'].includes(shell.dataset.searchState)
            ? shell
            : null
        )
        if (searchResult.dataset.searchState === 'error') {
          throw new Error('search failed: ' + searchInput.form.querySelector('span')?.textContent)
        }
        await settleFrames()
        searchReadyMs = performance.now() - searchStart
      }

      // The rail replaced the TOC as the per-record navigation surface. It is
      // already mounted by this point, so this reports the settle time after
      // the search step rather than a cold mount.
      const railStart = performance.now()
      await waitFor(
        'rail-ready',
        () => mountedRailRows().length > 0
      )
      await settleFrames()
      const railReadyMs = performance.now() - railStart

      // domNodes is budgeted against the default mostly-collapsed view, which
      // is why the expansion steps above restore their state before returning.
      const domNodes = document.getElementsByTagName('*').length
      const railRows = mountedRailRows().length

      return {
        searchReadyMs,
        agentToolReadyMs,
        agentTrajectoryReadyMs,
        agentTrajectoryItemSelectionReadyMs,
        agentTrajectoryDomNodes,
        trajectoryPageDomNodes,
        expandPathReadyMs,
        expandAllReadyMs,
        railReadyMs,
        domNodes,
        railRows,
        measurementFailures,
      }
    }
  )()`;
  const interactionResult = await client.invoke("Runtime.evaluate", {
    expression: interactionExpression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (interactionResult.exceptionDetails) {
    throw new Error(interactionResult.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  const interactionMetrics = await readMetrics();
  const interaction = interactionResult.result.value;
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
