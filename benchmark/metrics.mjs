export const parseIntegerSetting = (name, raw, min) => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, received ${String(raw)}`);
  }

  return value;
};

export const parseBudgetSetting = (name, raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, received ${String(raw)}`);
  }

  return value;
};

export const resolveBudgetSetting = (name, environment, fallback) =>
  parseBudgetSetting(name, environment[name] ?? fallback);

export const resolveBenchmarkOutputPath = (environment, hasFixtureFilter) =>
  environment.UNQUOTE_BENCH_OUTPUT ??
  (hasFixtureFilter ? ".turbo/unquote-benchmark/selected.json" : "benchmark/results/latest.json");

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Nearest-rank, so for small sample counts any high quantile collapses onto the
// slowest run: with the default sample count this p95 is literally max. That is
// why budgets gate on p50 and keep p95 as reporting only.
const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
};

export const summarize = (values) => {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) {
    return { samples: 0, avg: null, min: null, p50: null, p95: null, max: null };
  }

  return {
    samples: valid.length,
    avg: Number(average(valid).toFixed(2)),
    min: Number(Math.min(...valid).toFixed(2)),
    p50: Number(percentile(valid, 0.5).toFixed(2)),
    p95: Number(percentile(valid, 0.95).toFixed(2)),
    max: Number(Math.max(...valid).toFixed(2)),
  };
};

/**
 * The metrics a budget gates on. Every one of these must carry a real number
 * from every sample: a missing value means the measured path never ran, and
 * treating it as zero would let the gate pass without proving anything.
 * Diagnostics outside this list stay optional and are reported only.
 */
export const budgetedRenderMetrics = [
  { metric: "firstRecordReadyMs", statistic: "p50", budgetKey: "firstRecordReadyMsP50" },
  { metric: "completeReadyMs", statistic: "p50", budgetKey: "completeReadyMsP50" },
  { metric: "searchReadyMs", statistic: "p50", budgetKey: "searchReadyMsP50" },
  { metric: "expandPathReadyMs", statistic: "p50", budgetKey: "expandPathReadyMsP50" },
  { metric: "expandAllReadyMs", statistic: "p50", budgetKey: "expandAllReadyMsP50" },
  { metric: "domNodes", statistic: "max", budgetKey: "domNodesMax" },
  { metric: "jsHeapUsedSizeMB", statistic: "max", budgetKey: "jsHeapUsedSizeMBMax" },
];

export const agentSessionBudgetedRenderMetrics = [
  { metric: "agentSessionReadyMs", statistic: "p50", budgetKey: "agentSessionReadyMsP50" },
  { metric: "agentToolReadyMs", statistic: "p50", budgetKey: "agentToolReadyMsP50" },
];

export const agentTrajectoryBuildMetric = {
  metric: "agentTrajectoryBuildMs",
  entryName: "unquote:agentTrajectory:build",
  statistic: "p50",
  budgetKey: "agentTrajectoryBuildMsP50",
};

export const agentTrajectoryRenderBudgetContract = Object.freeze([
  Object.freeze({
    metric: "agentTrajectoryReadyMs",
    statistic: "p50",
    budgetKey: "agentTrajectoryReadyMsP50",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_READY_BUDGET_MS",
    defaultBudget: 100,
  }),
  Object.freeze({
    metric: "agentTrajectoryItemSelectionReadyMs",
    statistic: "p50",
    budgetKey: "agentTrajectoryItemSelectionReadyMsP50",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_ITEM_SELECTION_BUDGET_MS",
    defaultBudget: 60,
  }),
  Object.freeze({
    metric: "agentTrajectoryDomNodes",
    statistic: "max",
    budgetKey: "agentTrajectoryDomNodesMax",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_DOM_NODES_BUDGET",
    defaultBudget: 1400,
  }),
]);

export const agentSessionRequiredRenderMetrics = [
  ...agentSessionBudgetedRenderMetrics,
  agentTrajectoryBuildMetric,
  ...agentTrajectoryRenderBudgetContract,
];

export const agentTrajectoryMetricForScenario = (scenario) =>
  scenario === "agent-session" ? agentTrajectoryBuildMetric : null;

export const resolvePerformanceMeasure = (descriptor, entries) => {
  if (!Array.isArray(entries) || entries.length !== 1) {
    const received = Array.isArray(entries) ? entries.length : "an invalid payload";
    return {
      value: null,
      failure: `expected exactly 1 PerformanceMeasure named ${descriptor.entryName}, received ${received}`,
    };
  }

  const duration = entries[0]?.duration;
  if (!Number.isFinite(duration) || duration < 0) {
    return {
      value: null,
      failure: `${descriptor.entryName} duration must be a finite non-negative number, received ${String(duration)}`,
    };
  }

  return { value: duration, failure: null };
};

export const mergeMeasurementFailures = (runs) => {
  const merged = {};
  for (const run of runs) {
    for (const [metric, reason] of Object.entries(run.measurementFailures ?? {})) {
      merged[metric] ??= reason;
    }
  }

  return merged;
};

export const collectBudgetFailures = (
  render,
  budgets,
  expectedSamples,
  additionalMetricsByFixture = {},
) => {
  const failures = [];

  for (const [fixture, metrics] of Object.entries(render)) {
    const requiredMetrics = [
      ...budgetedRenderMetrics,
      ...(additionalMetricsByFixture[fixture] ?? []),
    ];
    for (const { metric, statistic, budgetKey } of requiredMetrics) {
      const budget = budgets?.[budgetKey];
      if (!Number.isFinite(budget) || budget < 0) {
        failures.push(
          `${fixture} ${metric}.${statistic} requires a finite non-negative budget ${budgetKey}, received ${String(budget)}`,
        );
        continue;
      }

      const summary = metrics[metric];
      const samples = summary?.samples ?? 0;
      if (samples < expectedSamples) {
        const reason = metrics.measurementFailures?.[metric];
        failures.push(
          `${fixture} ${metric} produced ${samples} of ${expectedSamples} samples, so the measured path did not run${
            reason ? `: ${reason}` : ""
          }`,
        );
        continue;
      }

      const value = summary[statistic];
      if (!Number.isFinite(value) || value < 0) {
        failures.push(
          `${fixture} ${metric}.${statistic} is not a finite non-negative number: ${String(value)}`,
        );
        continue;
      }

      if (value > budget) {
        failures.push(`${fixture} ${metric}.${statistic} ${value} > ${budget}`);
      }
    }
  }

  return failures;
};

export const collectBenchmarkGateFailures = (fixturesInfo, render, budgets, expectedSamples) => {
  const requiredMetricsByFixture = Object.fromEntries(
    fixturesInfo
      .filter(({ scenario }) => scenario === "agent-session")
      .map(({ path }) => [path, agentSessionRequiredRenderMetrics]),
  );

  return collectBudgetFailures(render, budgets, expectedSamples, requiredMetricsByFixture);
};
