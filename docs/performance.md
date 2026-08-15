# Performance Benchmarks

Run the release gate with:

```sh
pnpm benchmark
```

The command deterministically regenerates every default fixture, force-builds
the app, runs the benchmark in headless Chrome, writes
`benchmark/results/latest.json`, and exits with a non-zero status when a budget
is exceeded or a required measurement path fails. It does not depend on
workstation-only input.

Runs with fixture path arguments are partial reports and default to the ignored
`.turbo/unquote-benchmark/selected.json` instead of replacing the tracked full
baseline. This includes `pnpm benchmark:agent`. `UNQUOTE_BENCH_OUTPUT` always
overrides either default when a specific report path is required.

Set `UNQUOTE_BENCH_CHROME` to use a Chrome executable outside the default macOS
and Linux locations. Runner-specific budgets can be supplied with
`UNQUOTE_BENCH_FIRST_RECORD_BUDGET_MS`, `UNQUOTE_BENCH_COMPLETE_BUDGET_MS`,
`UNQUOTE_BENCH_SEARCH_BUDGET_MS`,
`UNQUOTE_BENCH_EXPAND_PATH_BUDGET_MS`, `UNQUOTE_BENCH_EXPAND_ALL_BUDGET_MS`,
`UNQUOTE_BENCH_DOM_NODES_BUDGET`, `UNQUOTE_BENCH_HEAP_BUDGET_MB`,
`UNQUOTE_BENCH_AGENT_READY_BUDGET_MS`, and
`UNQUOTE_BENCH_AGENT_TOOL_BUDGET_MS`.

## CI Gate

Pull requests that can affect parser or rendering performance run the Benchmark
workflow on GitHub's Ubuntu runner. Budget overruns fail the job. The JSON
report is retained as the `benchmark-results` artifact for 14 days.

The workflow runs the same `pnpm benchmark` command as a clean local checkout.
That command regenerates the synthetic Agent session and the case 2/case 4
fixtures before each run. CI writes its report outside the checkout so it cannot
replace the tracked local baseline.

Latency budgets gate on the median (p50) of three samples so a single slow run
on a shared runner does not trip the check. p95 remains in the report for
diagnostics. Override a pathological runner with the `UNQUOTE_BENCH_*_BUDGET_*`
environment variables above.

Generate ignored local JSONL fixtures with:

```sh
pnpm benchmark:fixtures
pnpm benchmark:case4-fixture
pnpm benchmark:case4-fixture -- --rows=100000 --out=case4-100K-rows.jsonl --force
```

`benchmark:fixtures` always replaces the default ignored files from fixed
inputs. The Agent fixture uses a fixed seed and synthetic identifiers, paths,
messages, tool calls, results, and token counts; it contains no captured user or
rollout data.

## Release Budgets

| Metric | Budget |
|---|---:|
| First record visible p50 | 1500 ms |
| Complete UI parse p50 | 3000 ms |
| Search ready p50 | 3000 ms |
| Expand Path ready p50 | 400 ms |
| Expand All ready p50 | 800 ms |
| Agent session ready p50 | 600 ms |
| Agent tool expand ready p50 | 150 ms |
| DOM nodes max | 3000 |
| JS heap used max | 256 MB |

## Baseline

Captured at `2026-08-15T17:32:08.764Z` with Node v24.19.0, macOS arm64, 10 CPU
cores, 32 GB memory, 3 samples, and 1 warmup per fixture.

| Fixture | Records | Core p95 | First record p95 | Complete p95 | Search p50 | agentTrajectoryBuildMs p50 | DOM max | Heap max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `benchmark/case1-agent-session.jsonl` | 433 | 121.75 ms | 189.6 ms | 214.8 ms | 341.7 ms | 1.3 ms | 678 | 5.69 MB |
| `benchmark/case1-agent-session-5K.jsonl` | 5005 | 233.75 ms | 159.8 ms | 242.2 ms | 350.1 ms | 7.3 ms | 678 | 11.26 MB |
| `benchmark/case2-1MB.jsonl` | 1610 | 212.69 ms | 160.4 ms | 178 ms | 392.4 ms | — | 829 | 5.76 MB |
| `benchmark/case2-5MB.jsonl` | 7956 | 1038.78 ms | 179.7 ms | 232.6 ms | 817.2 ms | — | 829 | 10.77 MB |
| `benchmark/case2-10MB.jsonl` | 15765 | 2066.44 ms | 172.9 ms | 270.7 ms | 1301.2 ms | — | 829 | 16.79 MB |
| `benchmark/case4-5K-rows.jsonl` | 5000 | 794.05 ms | 163.6 ms | 199.7 ms | 617.2 ms | — | 763 | 8.68 MB |

Both `pnpm benchmark` and `pnpm benchmark:agent` require the two synthetic
Agent fixtures. The first contains 48 turns and 433 records in 1.13 MB; the
second contains 556 turns and 5,005 records in 1.12 MB. Together they exercise
streamed parsing and both virtualized Agent panes at ordinary and high session
volume. This capture measured Agent session readiness at 184.1 ms and 223 ms
p50, tool expansion at 18 ms and 17.2 ms p50, and trajectory projection at
1.3 ms and 7.3 ms p50, respectively.

`core p95` measures `@unquote/core` forced JSONL parsing. `first record p95`
measures the time from dropping a local JSONL file to `record-1` becoming
visible. `complete p95` measures the time until the UI stats show all expected
records. `searchReadyMs` measures the header search interaction for the
benchmark query `nested`; generated case 2 and case 4 fixtures contain that term
in every Record, so the gate exercises the high-result-count path rather than a
no-result fast path. `expandPathReadyMs` measures one visible stringified
JSON toggle in the first record that exposes one. `expandAllReadyMs` covers the
displayed record only, so values recorded before the three-column redesign are
not comparable. `agentSessionReadyMs` waits for the Agent shell and session
metrics to become usable. `agentToolReadyMs` expands a tool card and waits for
its details. The benchmark requires both metrics for fixtures declared as
`agent-session`; a schema drift that falls back to the JSON view fails the run
instead of recording a misleading fast sample.

Agent fixtures also report `agentTrajectoryBuildMs` from exactly one
`unquote:agentTrajectory:build` PerformanceMeasure. The entry covers only the
pure trajectory projection held by the memoized Agent session model; parsing,
React rendering, and DOM readiness are outside its duration. Missing,
duplicate, or invalid entries are recorded under
`measurementFailures.agentTrajectoryBuildMs` instead of being treated as zero.
The benchmark requires one valid sample per run, so breaking this measurement
contract fails the gate. Its numeric value remains observational and has no
release budget or environment override until local and Ubuntu CI samples
establish a baseline.

Chrome Performance recordings include `unquote:*` user timing entries for the
main hot paths: `parse:first-batch`, `parse:complete`, `search:request`,
`search:memory`, `search:file`, `recordRows:build`, `expand:all:collect`, and
`expand:path`, plus `agentTrajectory:build` for Agent fixtures. `search:request`
spans dispatch to a terminal worker response,
while `search:memory` and `search:file` isolate the two execution paths. Use
these entries with the React Profiler to confirm whether search, tree row
construction, or expanded-path state is the active bottleneck before optimizing.

`case4-5K-rows` is the high-record-count release fixture. It uses the same
release budgets as the smaller fixtures: first record p50 under 1500 ms,
complete and search p50 under 3000 ms, Expand Path p50 under 400 ms, Expand All
p50 under 800 ms, DOM nodes under 3000, and JS heap under 256 MB. Agent fixtures
add session-ready p50 under 600 ms and tool-expand p50 under 150 ms. Use
`benchmark:case4-fixture -- --rows=100000` for local 100k-row stress runs; the
100k fixture is intentionally generated locally instead of committed.
