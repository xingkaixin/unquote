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
  { metric: "firstRecordReadyMs", statistic: "p50", budget: "firstRecordReadyMsP50" },
  { metric: "completeReadyMs", statistic: "p50", budget: "completeReadyMsP50" },
  { metric: "expandPathReadyMs", statistic: "p50", budget: "expandPathReadyMsP50" },
  { metric: "expandAllReadyMs", statistic: "p50", budget: "expandAllReadyMsP50" },
  { metric: "domNodes", statistic: "max", budget: "domNodesMax" },
  { metric: "jsHeapUsedSizeMB", statistic: "max", budget: "jsHeapUsedSizeMBMax" },
];

export const mergeMeasurementFailures = (runs) => {
  const merged = {};
  for (const run of runs) {
    for (const [metric, reason] of Object.entries(run.measurementFailures ?? {})) {
      merged[metric] ??= reason;
    }
  }

  return merged;
};

export const collectBudgetFailures = (render, budgets, expectedSamples) => {
  const failures = [];

  for (const [fixture, metrics] of Object.entries(render)) {
    for (const { metric, statistic, budget } of budgetedRenderMetrics) {
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

      if (value > budgets[budget]) {
        failures.push(`${fixture} ${metric}.${statistic} ${value} > ${budgets[budget]}`);
      }
    }
  }

  return failures;
};
