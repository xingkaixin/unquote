import { describe, expect, it } from "vitest";
import {
  agentSessionFixturePath,
  agentSessionStressFixturePath,
  benchmarkScenarioFor,
} from "../fixture-manifest.mjs";
import {
  agentTrajectoryBuildMetric,
  agentTrajectoryMetricForScenario,
  agentTrajectoryRenderBudgetContract,
  agentSessionBudgetedRenderMetrics,
  agentSessionRequiredRenderMetrics,
  budgetedRenderMetrics,
  collectBenchmarkGateFailures,
  collectBudgetFailures,
  mergeMeasurementFailures,
  parseBudgetSetting,
  parseIntegerSetting,
  resolvePerformanceMeasure,
  resolveBenchmarkOutputPath,
  resolveBudgetSetting,
  summarize,
} from "../metrics.mjs";

const expectedAgentTrajectoryRenderBudgetContract = [
  {
    metric: "agentTrajectoryReadyMs",
    statistic: "p50",
    budgetKey: "agentTrajectoryReadyMsP50",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_READY_BUDGET_MS",
    defaultBudget: 100,
  },
  {
    metric: "agentTrajectoryItemSelectionReadyMs",
    statistic: "p50",
    budgetKey: "agentTrajectoryItemSelectionReadyMsP50",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_ITEM_SELECTION_BUDGET_MS",
    defaultBudget: 60,
  },
  {
    metric: "agentTrajectoryDomNodes",
    statistic: "max",
    budgetKey: "agentTrajectoryDomNodesMax",
    envKey: "UNQUOTE_BENCH_AGENT_TRAJECTORY_DOM_NODES_BUDGET",
    defaultBudget: 1400,
  },
] as const;

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

const healthyAgentMetrics = (): Record<string, unknown> => ({
  ...healthyMetrics(),
  ...Object.fromEntries(
    [
      ...agentSessionBudgetedRenderMetrics,
      agentTrajectoryBuildMetric,
      ...expectedAgentTrajectoryRenderBudgetContract,
    ].map(({ metric }: { metric: string }) => [
      metric,
      { samples: 3, avg: 1, min: 1, p50: 1, p95: 1, max: 1 },
    ]),
  ),
});

const plainFixturePath = "benchmark/case2-1MB.jsonl";
const benchmarkGateFixtures = [
  agentSessionFixturePath,
  agentSessionStressFixturePath,
  plainFixturePath,
].map((path) => ({ path, scenario: benchmarkScenarioFor(path) }));
const trajectoryBudgetValues: Record<string, number> = Object.fromEntries(
  expectedAgentTrajectoryRenderBudgetContract.map(({ budgetKey, defaultBudget }) => [
    budgetKey,
    defaultBudget,
  ]),
);
const benchmarkGateBudgets = {
  ...budgets,
  agentSessionReadyMsP50: 600,
  agentToolReadyMsP50: 150,
  agentTrajectoryBuildMsP50: 50,
  ...trajectoryBudgetValues,
};
const healthyBenchmarkGateRender = (): Record<string, Record<string, unknown>> => ({
  [agentSessionFixturePath]: healthyAgentMetrics(),
  [agentSessionStressFixturePath]: healthyAgentMetrics(),
  [plainFixturePath]: healthyMetrics(),
});

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

  it("reads the Agent trajectory budget environment override", () => {
    expect(
      resolveBudgetSetting(
        "UNQUOTE_BENCH_AGENT_TRAJECTORY_BUDGET_MS",
        { UNQUOTE_BENCH_AGENT_TRAJECTORY_BUDGET_MS: "49.5" },
        50,
      ),
    ).toBe(49.5);
  });

  it.each(expectedAgentTrajectoryRenderBudgetContract)(
    "reads the new Agent trajectory override $envKey",
    ({ envKey, defaultBudget }) => {
      expect(resolveBudgetSetting(envKey, { [envKey]: String(defaultBudget) }, 1)).toBe(
        defaultBudget,
      );
    },
  );
});

describe("benchmark output selection", () => {
  it("writes an unfiltered run to the tracked baseline by default", () => {
    expect(resolveBenchmarkOutputPath({}, false)).toBe("benchmark/results/latest.json");
  });

  it("writes a filtered run to an ignored report by default", () => {
    expect(resolveBenchmarkOutputPath({}, true)).toBe(".turbo/unquote-benchmark/selected.json");
  });

  it("always honors an explicit output path", () => {
    expect(
      resolveBenchmarkOutputPath({ UNQUOTE_BENCH_OUTPUT: "benchmark/results/custom.json" }, true),
    ).toBe("benchmark/results/custom.json");
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

describe("Agent trajectory performance measure", () => {
  it("accepts exactly one finite non-negative duration", () => {
    expect(resolvePerformanceMeasure(agentTrajectoryBuildMetric, [{ duration: 12.5 }])).toEqual({
      value: 12.5,
      failure: null,
    });
    expect(resolvePerformanceMeasure(agentTrajectoryBuildMetric, [{ duration: 0 }])).toEqual({
      value: 0,
      failure: null,
    });
  });

  it("rejects a missing measure instead of treating it as zero", () => {
    expect(resolvePerformanceMeasure(agentTrajectoryBuildMetric, [])).toMatchObject({
      value: null,
      failure: expect.stringMatching(/expected exactly 1.*received 0/),
    });
  });

  it("rejects duplicate measures", () => {
    expect(
      resolvePerformanceMeasure(agentTrajectoryBuildMetric, [{ duration: 1 }, { duration: 2 }]),
    ).toMatchObject({
      value: null,
      failure: expect.stringMatching(/expected exactly 1.*received 2/),
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, null])(
    "rejects an invalid duration %p",
    (duration) => {
      expect(resolvePerformanceMeasure(agentTrajectoryBuildMetric, [{ duration }])).toMatchObject({
        value: null,
        failure: expect.stringMatching(/finite non-negative number/),
      });
    },
  );

  it("collects the metric for both Agent fixtures but not a plain fixture", () => {
    expect(
      [agentSessionFixturePath, agentSessionStressFixturePath].map((fixturePath) =>
        agentTrajectoryMetricForScenario(benchmarkScenarioFor(fixturePath)),
      ),
    ).toEqual([agentTrajectoryBuildMetric, agentTrajectoryBuildMetric]);
    expect(
      agentTrajectoryMetricForScenario(benchmarkScenarioFor("benchmark/case2-1MB.jsonl")),
    ).toBe(null);
  });

  it("keeps the three trajectory render budgets as a closed contract", () => {
    expect(agentTrajectoryRenderBudgetContract).toEqual(
      expectedAgentTrajectoryRenderBudgetContract,
    );
  });

  it("assigns trajectory budgets only to Agent fixtures", () => {
    expect(agentSessionBudgetedRenderMetrics).not.toContainEqual(
      expect.objectContaining({ metric: agentTrajectoryBuildMetric.metric }),
    );
    expect(agentTrajectoryBuildMetric).toMatchObject({
      statistic: "p50",
      budgetKey: "agentTrajectoryBuildMsP50",
    });
    expect(agentSessionRequiredRenderMetrics).toEqual([
      ...agentSessionBudgetedRenderMetrics,
      agentTrajectoryBuildMetric,
      ...expectedAgentTrajectoryRenderBudgetContract,
    ]);
    expect(budgetedRenderMetrics).not.toEqual(
      expect.arrayContaining([...expectedAgentTrajectoryRenderBudgetContract]),
    );
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
    const agentMetrics = healthyAgentMetrics();
    agentMetrics["agentSessionReadyMs"] = { samples: 3, p50: 100 };
    agentMetrics["agentToolReadyMs"] = { samples: 3, p50: 801 };

    expect(
      collectBudgetFailures(
        { "agent.jsonl": agentMetrics, "plain.jsonl": healthyMetrics() },
        {
          ...budgets,
          ...trajectoryBudgetValues,
          agentSessionReadyMsP50: 2000,
          agentToolReadyMsP50: 800,
          agentTrajectoryBuildMsP50: 50,
        },
        3,
        { "agent.jsonl": agentSessionRequiredRenderMetrics },
      ),
    ).toEqual(["agent.jsonl agentToolReadyMs.p50 801 > 800"]);
  });

  it("fails when the required trajectory summary is missing", () => {
    const agentMetrics = healthyAgentMetrics();
    delete agentMetrics["agentTrajectoryBuildMs"];

    expect(
      collectBudgetFailures(
        { "agent.jsonl": agentMetrics },
        {
          ...budgets,
          ...trajectoryBudgetValues,
          agentSessionReadyMsP50: 600,
          agentToolReadyMsP50: 150,
          agentTrajectoryBuildMsP50: 50,
        },
        3,
        { "agent.jsonl": agentSessionRequiredRenderMetrics },
      ),
    ).toEqual([
      "agent.jsonl agentTrajectoryBuildMs produced 0 of 3 samples, so the measured path did not run",
    ]);
  });

  it("fails when the required trajectory summary has only partial samples", () => {
    const agentMetrics = healthyAgentMetrics();
    agentMetrics["agentTrajectoryBuildMs"] = { samples: 2, p50: 1 };

    expect(
      collectBudgetFailures(
        { "agent.jsonl": agentMetrics },
        {
          ...budgets,
          ...trajectoryBudgetValues,
          agentSessionReadyMsP50: 600,
          agentToolReadyMsP50: 150,
          agentTrajectoryBuildMsP50: 50,
        },
        3,
        { "agent.jsonl": agentSessionRequiredRenderMetrics },
      ),
    ).toEqual([
      "agent.jsonl agentTrajectoryBuildMs produced 2 of 3 samples, so the measured path did not run",
    ]);
  });

  it("fails when the required trajectory statistic is invalid", () => {
    const agentMetrics = healthyAgentMetrics();
    agentMetrics["agentTrajectoryBuildMs"] = {
      samples: 3,
      p50: Number.POSITIVE_INFINITY,
    };

    expect(
      collectBudgetFailures(
        { "agent.jsonl": agentMetrics },
        {
          ...budgets,
          ...trajectoryBudgetValues,
          agentSessionReadyMsP50: 600,
          agentToolReadyMsP50: 150,
          agentTrajectoryBuildMsP50: 50,
        },
        3,
        { "agent.jsonl": agentSessionRequiredRenderMetrics },
      )[0],
    ).toContain("agentTrajectoryBuildMs.p50 is not a finite non-negative number");
  });

  it("fails every missing Agent trajectory render metric instead of accepting a skipped path", () => {
    const agentMetrics = healthyAgentMetrics();
    for (const { metric } of expectedAgentTrajectoryRenderBudgetContract) {
      delete agentMetrics[metric];
    }

    expect(
      collectBudgetFailures({ "agent.jsonl": agentMetrics }, benchmarkGateBudgets, 3, {
        "agent.jsonl": agentSessionRequiredRenderMetrics,
      }),
    ).toEqual(
      expectedAgentTrajectoryRenderBudgetContract.map(
        ({ metric }) =>
          `agent.jsonl ${metric} produced 0 of 3 samples, so the measured path did not run`,
      ),
    );
  });

  it.each(expectedAgentTrajectoryRenderBudgetContract)(
    "fails a partial $metric sample set instead of accepting it",
    ({ metric, statistic }) => {
      const agentMetrics = healthyAgentMetrics();
      agentMetrics[metric] = { samples: 2, [statistic]: 1 };

      expect(
        collectBudgetFailures({ "agent.jsonl": agentMetrics }, benchmarkGateBudgets, 3, {
          "agent.jsonl": agentSessionRequiredRenderMetrics,
        }),
      ).toContain(
        `agent.jsonl ${metric} produced 2 of 3 samples, so the measured path did not run`,
      );
    },
  );

  it.each(expectedAgentTrajectoryRenderBudgetContract)(
    "fails an invalid $metric $statistic value",
    ({ metric, statistic }) => {
      const agentMetrics = healthyAgentMetrics();
      agentMetrics[metric] = { samples: 3, [statistic]: Number.NaN };

      expect(
        collectBudgetFailures({ "agent.jsonl": agentMetrics }, benchmarkGateBudgets, 3, {
          "agent.jsonl": agentSessionRequiredRenderMetrics,
        }),
      ).toContain(`agent.jsonl ${metric}.${statistic} is not a finite non-negative number: NaN`);
    },
  );
});

describe("collectBenchmarkGateFailures", () => {
  it.each(expectedAgentTrajectoryRenderBudgetContract)(
    "fails when required trajectory budget $budgetKey is missing",
    ({ metric, statistic, budgetKey }) => {
      const caseBudgets: Record<string, number> = { ...benchmarkGateBudgets };
      delete caseBudgets[budgetKey];

      expect(
        collectBenchmarkGateFailures(
          [{ path: agentSessionFixturePath, scenario: "agent-session" }],
          { [agentSessionFixturePath]: healthyAgentMetrics() },
          caseBudgets,
          3,
        ),
      ).toContain(
        `${agentSessionFixturePath} ${metric}.${statistic} requires a finite non-negative budget ${budgetKey}, received undefined`,
      );
    },
  );

  it.each(
    expectedAgentTrajectoryRenderBudgetContract.flatMap((contract) =>
      [Number.NaN, Number.POSITIVE_INFINITY, -1].map((budgetValue) => ({
        ...contract,
        budgetValue,
      })),
    ),
  )(
    "fails when required trajectory budget $budgetKey is invalid",
    ({ metric, statistic, budgetKey, budgetValue }) => {
      const caseBudgets = { ...benchmarkGateBudgets, [budgetKey]: budgetValue };

      expect(
        collectBenchmarkGateFailures(
          [{ path: agentSessionFixturePath, scenario: "agent-session" }],
          { [agentSessionFixturePath]: healthyAgentMetrics() },
          caseBudgets,
          3,
        ),
      ).toContain(
        `${agentSessionFixturePath} ${metric}.${statistic} requires a finite non-negative budget ${budgetKey}, received ${String(budgetValue)}`,
      );
    },
  );

  it.each([agentSessionFixturePath, agentSessionStressFixturePath])(
    "requires a trajectory summary for %s",
    (fixturePath) => {
      const render = healthyBenchmarkGateRender();
      delete render[fixturePath]?.["agentTrajectoryBuildMs"];

      expect(
        collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
      ).toContain(
        `${fixturePath} agentTrajectoryBuildMs produced 0 of 3 samples, so the measured path did not run`,
      );
    },
  );

  it("rejects a partial trajectory summary through the production gate mapping", () => {
    const render = healthyBenchmarkGateRender();
    render[agentSessionFixturePath]!["agentTrajectoryBuildMs"] = { samples: 2, p50: 1 };

    expect(
      collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
    ).toContain(
      `${agentSessionFixturePath} agentTrajectoryBuildMs produced 2 of 3 samples, so the measured path did not run`,
    );
  });

  it("rejects an invalid trajectory summary through the production gate mapping", () => {
    const render = healthyBenchmarkGateRender();
    render[agentSessionStressFixturePath]!["agentTrajectoryBuildMs"] = {
      samples: 3,
      p50: Number.NaN,
    };

    expect(
      collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
    ).toContain(
      `${agentSessionStressFixturePath} agentTrajectoryBuildMs.p50 is not a finite non-negative number: NaN`,
    );
  });

  it.each([agentSessionFixturePath, agentSessionStressFixturePath])(
    "accepts a trajectory p50 at or below 50ms for %s",
    (fixturePath) => {
      for (const p50 of [49, 50]) {
        const render = healthyBenchmarkGateRender();
        render[fixturePath]!["agentTrajectoryBuildMs"] = { samples: 3, p50 };

        expect(
          collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
        ).toEqual([]);
      }
    },
  );

  it.each([agentSessionFixturePath, agentSessionStressFixturePath])(
    "rejects a trajectory p50 above 50ms for %s",
    (fixturePath) => {
      for (const p50 of [50.1, 51]) {
        const render = healthyBenchmarkGateRender();
        render[fixturePath]!["agentTrajectoryBuildMs"] = { samples: 3, p50 };

        expect(
          collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
        ).toEqual([`${fixturePath} agentTrajectoryBuildMs.p50 ${p50} > 50`]);
      }
    },
  );

  it.each(
    expectedAgentTrajectoryRenderBudgetContract.flatMap(({ metric, statistic, budgetKey }) =>
      [agentSessionFixturePath, agentSessionStressFixturePath].map((fixturePath) => ({
        fixturePath,
        metric,
        statistic,
        budgetKey,
      })),
    ),
  )(
    "accepts $metric at its $budgetKey boundary for $fixturePath",
    ({ fixturePath, metric, statistic, budgetKey }) => {
      const value = trajectoryBudgetValues[budgetKey];
      if (value === undefined) {
        throw new Error(`Missing test budget for ${budgetKey}`);
      }
      const render = healthyBenchmarkGateRender();
      render[fixturePath]![metric] = { samples: 3, [statistic]: value };

      expect(
        collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
      ).toEqual([]);
    },
  );

  it.each(
    expectedAgentTrajectoryRenderBudgetContract.flatMap(({ metric, statistic, budgetKey }) =>
      [agentSessionFixturePath, agentSessionStressFixturePath].map((fixturePath) => ({
        fixturePath,
        metric,
        statistic,
        budgetKey,
      })),
    ),
  )(
    "rejects $metric just above its $budgetKey boundary for $fixturePath",
    ({ fixturePath, metric, statistic, budgetKey }) => {
      const budgetValue = trajectoryBudgetValues[budgetKey];
      if (budgetValue === undefined) {
        throw new Error(`Missing test budget for ${budgetKey}`);
      }
      const value = budgetValue + 0.1;
      const render = healthyBenchmarkGateRender();
      render[fixturePath]![metric] = { samples: 3, [statistic]: value };

      expect(
        collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
      ).toEqual([`${fixturePath} ${metric}.${statistic} ${value} > ${budgetValue}`]);
    },
  );

  it("does not require a trajectory summary for a plain fixture", () => {
    const render = healthyBenchmarkGateRender();
    delete render[plainFixturePath]?.["agentTrajectoryBuildMs"];

    expect(
      collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
    ).toEqual([]);
    expect(render[plainFixturePath]).not.toHaveProperty("agentTrajectoryBuildMs");
  });

  it("does not require Agent trajectory render metrics for a plain fixture", () => {
    const render = healthyBenchmarkGateRender();
    for (const { metric } of expectedAgentTrajectoryRenderBudgetContract) {
      delete render[plainFixturePath]?.[metric];
    }

    expect(
      collectBenchmarkGateFailures(benchmarkGateFixtures, render, benchmarkGateBudgets, 3),
    ).toEqual([]);
    for (const { metric } of expectedAgentTrajectoryRenderBudgetContract) {
      expect(render[plainFixturePath]).not.toHaveProperty(metric);
    }
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

  it("merges Agent readiness, tool, and trajectory failures", () => {
    expect(
      mergeMeasurementFailures([
        {
          measurementFailures: {
            agentSessionReadyMs: "Agent view did not become ready",
            agentTrajectoryBuildMs: "first trajectory reason",
          },
        },
        {
          measurementFailures: {
            agentToolReadyMs: "tool card did not expand",
            agentTrajectoryBuildMs: "later trajectory reason",
          },
        },
      ]),
    ).toEqual({
      agentSessionReadyMs: "Agent view did not become ready",
      agentTrajectoryBuildMs: "first trajectory reason",
      agentToolReadyMs: "tool card did not expand",
    });
  });
});
