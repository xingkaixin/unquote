// @ts-check

const benchmarkTimeoutMs = 30_000;
const expandableRowTimeoutMs = 10_000;
const expandPathScrollSteps = 40;

const selectors = {
  shell: ".uq-shell",
  fileInput: '[data-benchmark-action="source-file-input"]',
  searchInput: '[data-benchmark-action="search-input"]',
  expandAll: '[data-benchmark-action="expand-all"]',
  collapseAll: '[data-benchmark-action="collapse-all"]',
  treeScroller: "[data-tree-scroller]",
  treeToggle: "[data-tree-toggle]",
  railRows: "[data-record-rail] [data-record-id]",
  agentToolCard: "[data-agent-tool-card]",
  trajectoryTab: '[data-output-tab="trajectory"]',
  jsonTab: '[data-output-tab="json"]',
  trajectoryRoot: "[data-trajectory-ready]",
  trajectoryItem: "[data-trajectory-item-token]",
  trajectoryDetail: "[data-trajectory-detail-item-token]",
};

/**
 * @typedef {{
 *   agentToolReadyMs: number | null;
 *   agentTrajectoryReadyMs: number | null;
 *   agentTrajectoryBuildEntries: Array<{ duration: number }> | null;
 *   agentTrajectoryItemSelectionReadyMs: number | null;
 *   agentTrajectoryDomNodes: number | null;
 *   trajectoryPageDomNodes: number | null;
 * }} AgentInteractionMetrics
 */

/**
 * @template T
 * @param {string} stage
 * @param {() => T | null | undefined | false} predicate
 * @param {number} [timeout]
 * @returns {Promise<T>}
 */
const waitFor = (stage, predicate, timeout = benchmarkTimeoutMs) =>
  new Promise((resolve, reject) => {
    let settled = false;
    /** @param {() => void} apply */
    const finish = (apply) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      apply();
    };
    const fail = () =>
      finish(() => {
        const shell = document.querySelector(selectors.shell);
        const diagnostics = shell instanceof HTMLElement ? shell.dataset : {};
        reject(new Error(`timeout ${stage} ${JSON.stringify(diagnostics)}`));
      });
    const timer = setTimeout(fail, timeout);
    const step = () => {
      if (settled) {
        return;
      }
      const value = predicate();
      if (value) {
        finish(() => resolve(value));
        return;
      }
      requestAnimationFrame(step);
    };
    step();
  });

const settleFrames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** @param {string} selector */
const htmlElement = (selector) => {
  const element = document.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
};

/** @param {Element | null | undefined} element @param {string} message */
const requireHtmlElement = (element, message) => {
  if (!(element instanceof HTMLElement)) {
    throw new Error(message);
  }
  return element;
};

const shellElement = () => requireHtmlElement(htmlElement(selectors.shell), "App shell not found");

const mountedRailRows = () => document.querySelectorAll(selectors.railRows);

/** @param {HTMLElement} trajectoryRoot */
const visibleTrajectoryLedgerItem = (trajectoryRoot) => {
  for (const candidate of trajectoryRoot.querySelectorAll(selectors.trajectoryItem)) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }
    const ledger = candidate.closest('[role="list"]');
    if (!(ledger instanceof HTMLElement)) {
      continue;
    }
    const itemRect = candidate.getBoundingClientRect();
    const ledgerRect = ledger.getBoundingClientRect();
    const isVisible =
      itemRect.width > 0 &&
      itemRect.height > 0 &&
      itemRect.left < ledgerRect.right &&
      itemRect.right > ledgerRect.left &&
      itemRect.top < ledgerRect.bottom &&
      itemRect.bottom > ledgerRect.top;
    if (isVisible) {
      return candidate;
    }
  }
  return null;
};

export const benchmarkFileInputSelector = selectors.fileInput;

export const waitForBenchmarkFileInput = () =>
  waitFor("file-input", () => Boolean(document.querySelector(selectors.fileInput)));

export const startBenchmark = () => {
  Reflect.set(globalThis, "__unquoteBenchmarkStart", performance.now());
};

/** @param {{ expectedFile: string; expectsAgentSession: boolean }} options */
export const waitForBenchmarkReady = async ({ expectedFile, expectsAgentSession }) => {
  const recordedStart = Reflect.get(globalThis, "__unquoteBenchmarkStart");
  const start = typeof recordedStart === "number" ? recordedStart : performance.now();

  await waitFor(
    "source-file",
    () => htmlElement(selectors.shell)?.dataset.sourceFile === expectedFile,
  );
  await waitFor("first-record", () => document.getElementById("record-1"));
  await settleFrames();
  const firstRecordReady = performance.now();

  const shell = await waitFor("parse-complete", () => {
    const candidate = htmlElement(selectors.shell);
    return candidate?.dataset.sourceFile === expectedFile &&
      candidate.dataset.parseState === "complete"
      ? candidate
      : null;
  });
  let agentSessionReadyMs = null;
  if (expectsAgentSession && shell.dataset.agentSession !== "true") {
    throw new Error(`expected Agent Session, received ${JSON.stringify(shell.dataset)}`);
  }
  if (shell.dataset.agentSession === "true") {
    await waitFor("agent-view", () => {
      const agentShell = document.querySelector(".uq-agent-shell");
      const metrics = agentShell?.querySelector("[data-agent-metrics]");
      return (
        shell.dataset.outputView === "agent" &&
        metrics instanceof HTMLElement &&
        Number(metrics.dataset.agentMetrics) > 0
      );
    });
    await settleFrames();
    agentSessionReadyMs = performance.now() - start;
  } else {
    await waitFor("json-view", () => shell.dataset.outputView === "json");
  }
  await settleFrames();
  const completeReady = performance.now();

  return {
    firstRecordReadyMs: firstRecordReady - start,
    completeReadyMs: completeReady - start,
    agentSessionReadyMs,
    domNodes: document.getElementsByTagName("*").length,
    railRows: mountedRailRows().length,
  };
};

/**
 * @param {HTMLElement} shell
 * @param {string | null} trajectoryMeasureName
 * @returns {Promise<AgentInteractionMetrics>}
 */
const measureAgentInteractions = async (shell, trajectoryMeasureName) => {
  const toolCard = await waitFor("agent-tool-card", () => htmlElement(selectors.agentToolCard));
  const agentToolStart = performance.now();
  toolCard.click();
  await waitFor("agent-tool-expand", () => toolCard.getAttribute("aria-pressed") === "true");
  await settleFrames();
  const agentToolReadyMs = performance.now() - agentToolStart;

  const trajectoryTab = await waitFor("trajectory-tab", () => htmlElement(selectors.trajectoryTab));
  const trajectoryReadyStart = performance.now();
  trajectoryTab.click();
  const trajectoryState = await waitFor("trajectory-ready", () => {
    const trajectoryRoot = htmlElement(selectors.trajectoryRoot);
    if (!trajectoryRoot || shell.dataset.outputView !== "trajectory") {
      return null;
    }
    const overview = trajectoryRoot.querySelector("[data-trajectory-overview]");
    if (Number(overview?.getAttribute("data-bucket-count")) <= 0) {
      return null;
    }
    const ledgerItem = visibleTrajectoryLedgerItem(trajectoryRoot);
    return ledgerItem ? { trajectoryRoot, ledgerItem } : null;
  });
  await settleFrames();

  const { trajectoryRoot } = trajectoryState;
  const ledgerItem = visibleTrajectoryLedgerItem(trajectoryRoot);
  if (!ledgerItem) {
    throw new Error("No geometrically visible trajectory ledger item after settling");
  }
  const agentTrajectoryReadyMs = performance.now() - trajectoryReadyStart;
  const agentTrajectoryBuildEntries = trajectoryMeasureName
    ? performance
        .getEntriesByName(trajectoryMeasureName, "measure")
        .map((entry) => ({ duration: entry.duration }))
    : null;
  const agentTrajectoryDomNodes = 1 + trajectoryRoot.querySelectorAll("*").length;
  const trajectoryPageDomNodes = document.getElementsByTagName("*").length;

  const selectedItemToken = ledgerItem.getAttribute("data-trajectory-item-token");
  if (!selectedItemToken) {
    throw new Error("Visible trajectory ledger item is missing its identity");
  }
  const itemSelectionStart = performance.now();
  ledgerItem.click();
  await waitFor("trajectory-item-selection", () => {
    const selectedToken = trajectoryRoot
      .querySelector(selectors.trajectoryDetail)
      ?.getAttribute("data-trajectory-detail-item-token");
    return (
      ledgerItem.getAttribute("aria-current") === "true" && selectedToken === selectedItemToken
    );
  });
  await settleFrames();

  return {
    agentToolReadyMs,
    agentTrajectoryReadyMs,
    agentTrajectoryBuildEntries,
    agentTrajectoryItemSelectionReadyMs: performance.now() - itemSelectionStart,
    agentTrajectoryDomNodes,
    trajectoryPageDomNodes,
  };
};

/** @param {HTMLElement} shell */
const switchToJsonView = async (shell) => {
  if (shell.dataset.agentSession !== "true") {
    return;
  }
  const jsonTabs = document.querySelectorAll(selectors.jsonTab);
  requireHtmlElement(jsonTabs[jsonTabs.length - 1], "JSON tab not found").click();
  await waitFor("json-view", () => shell.dataset.outputView === "json");
  await settleFrames();
};

const findToggleRow = () =>
  document.querySelector(selectors.treeToggle)?.closest('[role="treeitem"]') ?? null;

const treeScroller = () =>
  requireHtmlElement(htmlElement(selectors.treeScroller), "Tree scroller not found");

const scanForToggleRow = async () => {
  const scroller = treeScroller();
  scroller.scrollTop = 0;
  await settleFrames();
  let row = findToggleRow();
  let scrolledViewports = 0;
  while (!row && scrolledViewports < expandPathScrollSteps) {
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
      break;
    }
    scroller.scrollTop += scroller.clientHeight;
    scrolledViewports += 1;
    await settleFrames();
    row = findToggleRow();
  }
  return row;
};

/** @param {HTMLElement} shell */
const measureTreeExpansion = async (shell) => {
  const measurementFailures = {};
  let firstToggleRow = await waitFor("expandable-row", findToggleRow, expandableRowTimeoutMs).catch(
    () => null,
  );
  firstToggleRow ??= await scanForToggleRow();

  let scannedRecords = 1;
  while (!firstToggleRow && mountedRailRows()[scannedRecords]) {
    requireHtmlElement(mountedRailRows()[scannedRecords], "Record rail row not found").click();
    scannedRecords += 1;
    await settleFrames();
    firstToggleRow = await scanForToggleRow();
  }
  if (!firstToggleRow) {
    measurementFailures.expandPathReadyMs = `no ${selectors.treeToggle} row in ${scannedRecords} rail records`;
  }

  let expandPathReadyMs = null;
  if (firstToggleRow instanceof HTMLElement) {
    const toggle = requireHtmlElement(
      firstToggleRow.querySelector(selectors.treeToggle),
      "Tree toggle not found",
    );
    const expandPathStart = performance.now();
    toggle.click();
    await waitFor("expand-path", () => firstToggleRow.getAttribute("aria-expanded") === "true");
    await settleFrames();
    expandPathReadyMs = performance.now() - expandPathStart;

    toggle.click();
    await waitFor("collapse-path", () => firstToggleRow.getAttribute("aria-expanded") !== "true");
    await settleFrames();
  }

  treeScroller().scrollTop = 0;
  await settleFrames();

  const expandAll = htmlElement(selectors.expandAll);
  const collapseAll = htmlElement(selectors.collapseAll);
  let expandAllReadyMs = null;
  if (!expandAll || !collapseAll) {
    measurementFailures.expandAllReadyMs = "expansion controls were not rendered";
  } else {
    const expandAllStart = performance.now();
    expandAll.click();
    await waitFor("expand-all", () => Number(shell.dataset.expandedNested) > 0);
    await settleFrames();
    expandAllReadyMs = performance.now() - expandAllStart;

    collapseAll.click();
    await waitFor("collapse-all", () => Number(shell.dataset.expandedNested) === 0);
    await settleFrames();
  }

  return { expandPathReadyMs, expandAllReadyMs, measurementFailures };
};

/** @param {HTMLElement} shell @param {boolean} skipSearch */
const measureSearch = async (shell, skipSearch) => {
  if (skipSearch) {
    return null;
  }
  const searchInput = document.querySelector(selectors.searchInput);
  if (!(searchInput instanceof HTMLInputElement) || !searchInput.form) {
    throw new Error("Search form not found");
  }
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("Search input setter not found");
  }

  const searchStart = performance.now();
  valueSetter.call(searchInput, "nested");
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  searchInput.form.requestSubmit();
  const searchResult = await waitFor("search-complete", () =>
    shell.dataset.searchQuery === "nested" &&
    ["complete", "error"].includes(shell.dataset.searchState ?? "")
      ? shell
      : null,
  );
  if (searchResult.dataset.searchState === "error") {
    throw new Error(`search failed: ${searchInput.form.querySelector("span")?.textContent}`);
  }
  await settleFrames();
  return performance.now() - searchStart;
};

/**
 * @param {{ expectsAgentSession: boolean; skipSearch: boolean; trajectoryMeasureName: string | null }} options
 */
export const runBenchmarkInteractions = async ({
  expectsAgentSession,
  skipSearch,
  trajectoryMeasureName,
}) => {
  const shell = shellElement();
  /** @type {AgentInteractionMetrics} */
  let agentMetrics = {
    agentToolReadyMs: null,
    agentTrajectoryReadyMs: null,
    agentTrajectoryBuildEntries: null,
    agentTrajectoryItemSelectionReadyMs: null,
    agentTrajectoryDomNodes: null,
    trajectoryPageDomNodes: null,
  };
  if (expectsAgentSession) {
    if (shell.dataset.agentSession !== "true" || shell.dataset.outputView !== "agent") {
      throw new Error("Agent interaction started outside the Agent view");
    }
    agentMetrics = await measureAgentInteractions(shell, trajectoryMeasureName);
  }

  await switchToJsonView(shell);
  const expansion = await measureTreeExpansion(shell);
  const searchReadyMs = await measureSearch(shell, skipSearch);
  const railStart = performance.now();
  await waitFor("rail-ready", () => mountedRailRows().length > 0);
  await settleFrames();

  return {
    searchReadyMs,
    ...agentMetrics,
    ...expansion,
    railReadyMs: performance.now() - railStart,
    domNodes: document.getElementsByTagName("*").length,
    railRows: mountedRailRows().length,
  };
};
