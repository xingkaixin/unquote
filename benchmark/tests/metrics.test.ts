import { describe, expect, it } from "vitest";
import {
  agentSessionBudgetedRenderMetrics,
  budgetedRenderMetrics,
  collectBudgetFailures,
  mergeMeasurementFailures,
  parseBudgetSetting,
  parseIntegerSetting,
  resolveBudgetSetting,
  summarize,
} from "../metrics.mjs";

const budgets = {
  firstRecordReadyMsP50: 1500,
  completeReadyMsP50: 3000,
  searchReadyMsP50: 3000,
  expandPathReadyMsP50: 400,
  expandAllReadyMsP50: 800,
  domNodesMax: 3_000,
  jsHeapUsedSizeMBMax: 256,
};

// Deliberately loose: the tests replace individual summaries with partial and
// malformed shapes, which is exactly what the collector has to survive.
const healthyMetrics = (): Record<string, unknown> =>
  Object.fromEntries(
    budgetedRenderMetrics.map(({ metric }: { metric: string }) => [
      metric,
      { samples: 3, avg: 1, min: 1, p50: 1, p95: 1, max: 1 },
    ]),
  );

describe("benchmark sample count settings", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "abc"])(
    "rejects %p as a run count",
    (raw) => {
      expect(() => parseIntegerSetting("UNQUOTE_BENCH_RUNS", raw, 1)).toThrow(
        /must be an integer >= 1/,
      );
    },
  );

  it("accepts a positive integer run count", () => {
    expect(parseIntegerSetting("UNQUOTE_BENCH_RUNS", "3", 1)).toBe(3);
  });

  it("allows zero warmups but not fewer", () => {
    expect(parseIntegerSetting("UNQUOTE_BENCH_WARMUPS", 0, 0)).toBe(0);
    expect(() => parseIntegerSetting("UNQUOTE_BENCH_WARMUPS", -1, 0)).toThrow();
  });

  it.each([-1, Number.NaN, "abc"])("rejects %p as a budget", (raw) => {
    expect(() => parseBudgetSetting("UNQUOTE_BENCH_HEAP_BUDGET_MB", raw)).toThrow(
      /must be a non-negative number/,
    );
  });

  it("uses the versioned fallback when a budget environment variable is absent", () => {
    expect(resolveBudgetSetting("UNQUOTE_BENCH_SEARCH_BUDGET_MS", {}, 3000)).toBe(3000);
  });

  it("validates a budget environment override", () => {
    expect(
      resolveBudgetSetting(
        "UNQUOTE_BENCH_SEARCH_BUDGET_MS",
        { UNQUOTE_BENCH_SEARCH_BUDGET_MS: "2500" },
        3000,
      ),
    ).toBe(2500);
  });
});

describe("summarize", () => {
  it("reports zero samples for an empty series", () => {
    expect(summarize([])).toEqual({
      samples: 0,
      avg: null,
      min: null,
      p50: null,
      p95: null,
      max: null,
    });
  });

  it("counts only finite samples", () => {
    expect(summarize([null, Number.NaN, Number.POSITIVE_INFINITY, 10, 20])).toMatchObject({
      samples: 2,
      min: 10,
      max: 20,
    });
  });
});

describe("collectBudgetFailures", () => {
  it("passes when every budgeted metric has a full sample set within budget", () => {
    expect(collectBudgetFailures({ "case.jsonl": healthyMetrics() }, budgets, 3)).toEqual([]);
  });

  it("fails a metric that produced no samples instead of comparing it as zero", () => {
    const metrics = healthyMetrics();
    metrics["searchReadyMs"] = { samples: 0, avg: null, min: null, p50: null, p95: null };

    const failures = collectBudgetFailures({ "case.jsonl": metrics }, budgets, 3);

    expect(failures).toEqual([
      "case.jsonl searchReadyMs produced 0 of 3 samples, so the measured path did not run",
    ]);
  });

  it("names the reason a measurement path reported", () => {
    const metrics = healthyMetrics();
    metrics["expandPathReadyMs"] = { samples: 0, p50: null };
    metrics["measurementFailures"] = { expandPathReadyMs: "no [data-tree-toggle] row" };

    expect(collectBudgetFailures({ "case.jsonl": metrics }, budgets, 3)[0]).toContain(
      "no [data-tree-toggle] row",
    );
  });

  it("fails a metric with fewer samples than runs", () => {
    const metrics = healthyMetrics();
    metrics["completeReadyMs"] = { samples: 2, p50: 5 };

    expect(collectBudgetFailures({ "case.jsonl": metrics }, budgets, 3)).toEqual([
      "case.jsonl completeReadyMs produced 2 of 3 samples, so the measured path did not run",
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, null])(
    "fails a metric whose statistic is %p",
    (value) => {
      const metrics = healthyMetrics();
      metrics["searchReadyMs"] = { samples: 3, p50: value };

      expect(collectBudgetFailures({ "case.jsonl": metrics }, budgets, 3)[0]).toContain(
        "is not a finite non-negative number",
      );
    },
  );

  it("reports a metric over budget", () => {
    const metrics = healthyMetrics();
    metrics["searchReadyMs"] = { samples: 3, p50: 3001 };

    expect(collectBudgetFailures({ "case.jsonl": metrics }, budgets, 3)).toEqual([
      "case.jsonl searchReadyMs.p50 3001 > 3000",
    ]);
  });

  it("requires Agent-only metrics only for the declared fixture", () => {
    const agentMetrics = healthyMetrics();
    agentMetrics["agentSessionReadyMs"] = { samples: 3, p50: 100 };
    agentMetrics["agentToolReadyMs"] = { samples: 3, p50: 801 };

    expect(
      collectBudgetFailures(
        { "agent.jsonl": agentMetrics, "plain.jsonl": healthyMetrics() },
        { ...budgets, agentSessionReadyMsP50: 2000, agentToolReadyMsP50: 800 },
        3,
        { "agent.jsonl": agentSessionBudgetedRenderMetrics },
      ),
    ).toEqual(["agent.jsonl agentToolReadyMs.p50 801 > 800"]);
  });
});

describe("mergeMeasurementFailures", () => {
  it("keeps the first reason reported for each metric", () => {
    expect(
      mergeMeasurementFailures([
        {},
        { measurementFailures: { expandPathReadyMs: "first" } },
        { measurementFailures: { expandPathReadyMs: "second", expandAllReadyMs: "other" } },
      ]),
    ).toEqual({ expandPathReadyMs: "first", expandAllReadyMs: "other" });
  });
});
