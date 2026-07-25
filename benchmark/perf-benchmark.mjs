import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const readBudget = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
};

const chromePath = resolveChromePath();
const remoteDebuggingPort = Number(process.env.UNQUOTE_BENCH_PORT ?? 0);
const maxChromeDiagnosticLength = 8_192;
const chromeStartupTimeoutMs = 30_000;
const chromeStartupPollIntervalMs = 100;
// Deferred file records only grow an expandable row once they hydrate; give
// that a bounded wait rather than assuming it has already happened.
const expandableRowTimeoutMs = 10_000;
// Three samples: gating on the median already removes the worst-run
// sensitivity, and raising this to five pushed the CI job past its 20 minute
// timeout even though the same change costs only ~1.4x locally.
const sampleRuns = Number(process.env.UNQUOTE_BENCH_RUNS ?? 3);
const warmupRuns = Number(process.env.UNQUOTE_BENCH_WARMUPS ?? 1);
const outputPath = path.resolve(
  repoRoot,
  process.env.UNQUOTE_BENCH_OUTPUT ?? "benchmark/results/latest.json",
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
  firstRecordReadyMsP50: readBudget("UNQUOTE_BENCH_FIRST_RECORD_BUDGET_MS", 1000),
  completeReadyMsP50: readBudget("UNQUOTE_BENCH_COMPLETE_BUDGET_MS", 3000),
  expandPathReadyMsP50: readBudget("UNQUOTE_BENCH_EXPAND_PATH_BUDGET_MS", 400),
  expandAllReadyMsP50: readBudget("UNQUOTE_BENCH_EXPAND_ALL_BUDGET_MS", 800),
  domNodesMax: readBudget("UNQUOTE_BENCH_DOM_NODES_BUDGET", 10000),
  jsHeapUsedSizeMBMax: readBudget("UNQUOTE_BENCH_HEAP_BUDGET_MB", 256),
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

// Nearest-rank, so for small sample counts any high quantile collapses onto the
// slowest run: with the default sampleRuns this p95 is literally max. That is
// why the budgets below gate on p50 and keep p95 as reporting only.
const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
};

const summarize = (values) => {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) {
    return { avg: null, min: null, p50: null, p95: null, max: null };
  }

  return {
    avg: Number(average(valid).toFixed(2)),
    min: Number(Math.min(...valid).toFixed(2)),
    p50: Number(percentile(valid, 0.5).toFixed(2)),
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

const runRenderFixture = async (client, fixture) => {
  debug(`Rendering ${fixture.path}`);
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

  const settleExpression = `(
    async () => {
      const expectedFile = ${JSON.stringify(path.basename(fixture.path))}
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
      if (shell.dataset.agentSession === 'true') {
        await waitFor('agent-view', () => {
          const agentShell = document.querySelector('.uq-agent-shell')
          const metrics = agentShell?.querySelector('[data-agent-metrics]')
          return shell.dataset.outputView === 'agent' &&
            Number(metrics?.dataset.agentMetrics) > 0
        })
      } else {
        await waitFor('json-view', () => shell.dataset.outputView === 'json')
      }
      await settleFrames()
      const completeReady = performance.now()

      return {
        firstRecordReadyMs: firstRecordReady - start,
        completeReadyMs: completeReady - start,
        domNodes: document.getElementsByTagName('*').length,
        recordCards: document.querySelectorAll('[id^="record-"]:not([id*=":"])').length,
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
      const shell = document.querySelector('.uq-shell')

      if (shell.dataset.agentSession === 'true') {
        const jsonTabs = document.querySelectorAll('[data-output-tab="json"]')
        const jsonTab = jsonTabs[jsonTabs.length - 1]
        jsonTab?.click()
        await waitFor('json-view', () => shell.dataset.outputView === 'json')
        await settleFrames()
      }

      // Expansion is measured before the search step and restored afterwards:
      // search populates its own expansion state, which flips the toolbar
      // control to Collapse All and makes anything measured after it depend on
      // whether the query happened to match inside stringified JSON.
      const expansionControl = (label) =>
        [...document.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === label
        )
      // The per-row toggle is an aria-hidden span; its row owns the click
      // handler and the aria-expanded state. It used to be matched by
      // [aria-label^="Toggle"], which stopped existing in #67 and left
      // expandPathReadyMs silently null on every fixture since.
      const firstToggleRow = await waitFor(
        'expandable-row',
        () => document.querySelector('[data-tree-toggle]')?.closest('[role="treeitem"]') ?? null,
        ${expandableRowTimeoutMs}
      ).catch(() => null)

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

      // Expand All applies one expansion write per visible record — a
      // different path from the single toggle above, and the one that
      // regressed to O(n^2) in UQ-113. The control carries no aria-label, but
      // its text doubles as its current state.
      let expandAllReadyMs = null
      if (expansionControl('Expand All')) {
        const expandAllStart = performance.now()
        expansionControl('Expand All').click()
        await waitFor('expand-all', () => expansionControl('Collapse All'))
        await settleFrames()
        expandAllReadyMs = performance.now() - expandAllStart

        expansionControl('Collapse All').click()
        await waitFor('collapse-all', () => expansionControl('Expand All'))
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

      // Large fixtures auto-collapse the source panel (see app.tsx sourceCollapsed),
      // which unmounts TocPane entirely. Re-expand it so the TOC's per-record DOM
      // cost (currently unvirtualized) is captured by domNodes/recordCards below.
      const sourceExpandButton = document.querySelector('button[aria-label="Expand source"]')
      let tocReadyMs = null
      if (sourceExpandButton) {
        const tocStart = performance.now()
        sourceExpandButton.click()
        await waitFor('toc-ready', () => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (node) => node.textContent === 'Records'
          )
          const tocContent = heading?.parentElement?.parentElement?.nextElementSibling
          return (tocContent?.querySelectorAll('button[aria-pressed]').length ?? 0) > 0
        })
        await settleFrames()
        tocReadyMs = performance.now() - tocStart
      }

      // domNodes is budgeted against the default mostly-collapsed view, which
      // is why the expansion steps above restore their state before returning.
      const domNodes = document.getElementsByTagName('*').length
      const recordCards = document.querySelectorAll('[id^="record-"]:not([id*=":"])').length

      return {
        searchReadyMs,
        expandPathReadyMs,
        expandAllReadyMs,
        tocReadyMs,
        domNodes,
        recordCards,
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
  const settled = settledResult.result.value;
  const interaction = interactionResult.result.value;
  debug(`Capturing heap snapshot for ${fixture.path}`);
  const heapSnapshot = await captureHeapSnapshot(client, fixture);

  return {
    ...settled,
    ...interaction,
    domNodes: Math.max(settled.domNodes, interaction.domNodes),
    recordCards: Math.max(settled.recordCards, interaction.recordCards),
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
    // TocPane only renders at the Tailwind `lg` breakpoint (>=1024px); force a
    // wide window so the source-panel expand + TOC render steps are reachable.
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

      entries.push([
        fixture.path,
        {
          firstRecordReadyMs: summarize(runs.map((run) => run.firstRecordReadyMs)),
          completeReadyMs: summarize(runs.map((run) => run.completeReadyMs)),
          searchReadyMs: summarize(runs.map((run) => run.searchReadyMs)),
          expandPathReadyMs: summarize(runs.map((run) => run.expandPathReadyMs)),
          expandAllReadyMs: summarize(runs.map((run) => run.expandAllReadyMs)),
          tocReadyMs: summarize(runs.map((run) => run.tocReadyMs)),
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
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGKILL");
    }
    await chromeExited;
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

const collectBudgetFailures = (render) => {
  const failures = [];
  for (const [fixture, metrics] of Object.entries(render)) {
    if ((metrics.firstRecordReadyMs.p50 ?? 0) > budgets.firstRecordReadyMsP50) {
      failures.push(
        `${fixture} firstRecordReadyMs.p50 ${metrics.firstRecordReadyMs.p50} > ${budgets.firstRecordReadyMsP50}`,
      );
    }
    if ((metrics.completeReadyMs.p50 ?? 0) > budgets.completeReadyMsP50) {
      failures.push(
        `${fixture} completeReadyMs.p50 ${metrics.completeReadyMs.p50} > ${budgets.completeReadyMsP50}`,
      );
    }
    if ((metrics.expandPathReadyMs.p50 ?? 0) > budgets.expandPathReadyMsP50) {
      failures.push(
        `${fixture} expandPathReadyMs.p50 ${metrics.expandPathReadyMs.p50} > ${budgets.expandPathReadyMsP50}`,
      );
    }
    if ((metrics.expandAllReadyMs.p50 ?? 0) > budgets.expandAllReadyMsP50) {
      failures.push(
        `${fixture} expandAllReadyMs.p50 ${metrics.expandAllReadyMs.p50} > ${budgets.expandAllReadyMsP50}`,
      );
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
  debug("Reading fixture metadata");
  const fixturesInfo = fixtures.map(fixtureInfo);
  debug(`Running ${fixturesInfo.length} fixture(s)${renderOnly ? " in render-only mode" : ""}`);
  const [core, render] = renderOnly
    ? [{}, await benchmarkRender(fixturesInfo)]
    : await Promise.all([benchmarkCore(fixturesInfo), benchmarkRender(fixturesInfo)]);
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
