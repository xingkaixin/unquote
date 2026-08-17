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
`UNQUOTE_BENCH_AGENT_TOOL_BUDGET_MS`, and
`UNQUOTE_BENCH_AGENT_TRAJECTORY_BUDGET_MS`,
`UNQUOTE_BENCH_AGENT_TRAJECTORY_READY_BUDGET_MS`,
`UNQUOTE_BENCH_AGENT_TRAJECTORY_ITEM_SELECTION_BUDGET_MS`, and
`UNQUOTE_BENCH_AGENT_TRAJECTORY_DOM_NODES_BUDGET`.

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
| Agent trajectory build p50 | 50 ms |
| Agent trajectory ready p50 | 100 ms |
| Agent trajectory item selection ready p50 | 60 ms |
| Agent trajectory DOM nodes max | 1400 |
| DOM nodes max | 3000 |
| JS heap used max | 256 MB |

## UI bundle budgets

`pnpm check` builds the Web and Chrome-extension surfaces, then runs
`pnpm check:ui-bundle-budget`. The gate measures four independent costs for
each surface:

- initial JavaScript is the entry and every static module preload referenced by
  the built HTML;
- total UI JavaScript includes every synchronous and on-demand UI chunk, but
  excludes parser/search workers and the separately budgeted extension
  background;
- the largest JavaScript chunk prevents the original oversized entry from
  returning even when the aggregate remains under budget;
- CSS includes all emitted stylesheets.

The current Web build measures about 562 KiB / 181 KiB gzip for initial JS and
698 KiB / 226 KiB gzip for all UI JS. The extension carries a small options-page
wrapper and measures about 573 KiB / 185 KiB gzip initially and 709 KiB / 229
KiB gzip in total. The ceilings allow roughly 7–10% growth without permitting
the previous single 706 KiB entry to return.

| Metric per surface | Budget |
|---|---:|
| Initial JavaScript | 620,000 bytes |
| Initial JavaScript gzip | 205,000 bytes |
| Total UI JavaScript | 760,000 bytes |
| Total UI JavaScript gzip | 250,000 bytes |
| Largest JavaScript chunk | 450,000 bytes |
| CSS | 38,000 bytes |
| CSS gzip | 9,000 bytes |

## Baseline

Captured at `2026-08-15T22:26:15.670Z` with Node v24.19.0, macOS arm64, 10 CPU
cores, 32 GB memory, 3 samples, and 1 warmup per fixture.

| Fixture | Records | Core p95 | First record p95 | Complete p95 | Search p50 | Build p50 | Trajectory ready p50 | Item selection p50 | Trajectory DOM max | DOM max | Heap max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `benchmark/case1-agent-session.jsonl` | 433 | 116.4 ms | 187.5 ms | 213.1 ms | 349.8 ms | 1.3 ms | 25.5 ms | 24.9 ms | 198 | 679 | 6.24 MB |
| `benchmark/case1-agent-session-5K.jsonl` | 5005 | 230.87 ms | 166.8 ms | 252 ms | 350 ms | 7.5 ms | 33.4 ms | 23.5 ms | 190 | 679 | 12.13 MB |
| `benchmark/case2-1MB.jsonl` | 1610 | 212.95 ms | 161.2 ms | 176.4 ms | 399.2 ms | — | — | — | — | 829 | 5.87 MB |
| `benchmark/case2-5MB.jsonl` | 7956 | 1014.07 ms | 168.6 ms | 221.9 ms | 809.5 ms | — | — | — | — | 829 | 10.87 MB |
| `benchmark/case2-10MB.jsonl` | 15765 | 2036.06 ms | 163.8 ms | 265 ms | 1301.6 ms | — | — | — | — | 829 | 15.62 MB |
| `benchmark/case4-5K-rows.jsonl` | 5000 | 672.14 ms | 172.2 ms | 203 ms | 609 ms | — | — | — | — | 763 | 8.5 MB |

Both `pnpm benchmark` and `pnpm benchmark:agent` require the two synthetic
Agent fixtures. The first contains 48 turns and 433 records in 1.13 MB; the
second contains 556 turns and 5,005 records in 1.12 MB. Together they exercise
streamed parsing and both virtualized Agent panes at ordinary and high session
volume. This capture measured Agent session readiness at 184.6 ms and 228.7 ms
p50, tool expansion at 18 ms and 24.1 ms p50, and trajectory projection at
1.3 ms and 7.5 ms p50, respectively.

The three Agent-only trajectory metrics have the following sorted samples
`[min, p50, max]`; with three samples, p50 is the middle sample and p95 is the
same as max. Times are milliseconds.

| Fixture | Metric | Sorted samples | Average | p50 | Max |
|---|---|---:|---:|---:|---:|
| `case1-agent-session` | Trajectory ready | [25, 25.5, 34.3] | 28.27 | 25.5 | 34.3 |
| `case1-agent-session` | Item selection ready | [24.9, 24.9, 25] | 24.93 | 24.9 | 25 |
| `case1-agent-session` | Trajectory DOM nodes | [198, 198, 198] | 198 | 198 | 198 |
| `case1-agent-session-5K` | Trajectory ready | [33.2, 33.4, 33.4] | 33.33 | 33.4 | 33.4 |
| `case1-agent-session-5K` | Item selection ready | [23.3, 23.5, 24.9] | 23.9 | 23.5 | 24.9 |
| `case1-agent-session-5K` | Trajectory DOM nodes | [190, 190, 190] | 190 | 190 | 190 |

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

`agentTrajectoryReadyMs` starts immediately before clicking the Trajectory tab,
after the tool measurement. It waits for the shell's `trajectory` output view,
`data-trajectory-ready`, an overview bucket count above zero, and an item whose
rectangle has positive size and intersects its ledger list rectangle, then waits
two animation frames. It reads the overview's aggregate bucket-count attribute;
it does not inspect individual chart buckets. `agentTrajectoryItemSelectionReadyMs`
starts immediately before clicking that mounted item. It completes only when the
same button has `aria-current="true"` and the detail root's
`data-trajectory-detail-item-token` equals that button's
`data-trajectory-item-token`, followed by two animation frames. Both attributes
carry the presentation item's safe ordinal token, not an original item id.

At Trajectory mount, `agentTrajectoryDomNodes` is exactly
`1 + trajectoryRoot.querySelectorAll('*').length`. The runner samples the full
page DOM at the same point and includes that sample in the existing global
`domNodes` maximum. A missing visible item, timeout, or identity mismatch fails
the measurement path rather than producing zero or silently skipping it. These
three values are required and budgeted only for `agent-session` fixtures; plain
JSON and JSONL fixtures neither require nor report them.

The millisecond defaults preserve the existing approximately 2.18× regression
headroom, rounding up to the next 10: the slowest values in this full report
yield `ceil10(34.3 × 2.18) = 80 ms` for Trajectory ready and
`ceil10(25 × 2.18) = 60 ms` for item selection. The ready budget remains at its
established 100 ms rather than tightening after one successful capture. The DOM
node budget is structural rather than statistical: the overview renders at most
`trajectoryOverviewSpanLimit` (1,000) per-event spans before falling back to
aggregated buckets, and the non-chart shell measures about 250 nodes, so the
budget is `ceil50((1000 + 250) × 1.1) = 1400` nodes. The defaults are therefore
100 ms, 60 ms, and 1400 nodes. The corresponding environment overrides are
`UNQUOTE_BENCH_AGENT_TRAJECTORY_READY_BUDGET_MS`,
`UNQUOTE_BENCH_AGENT_TRAJECTORY_ITEM_SELECTION_BUDGET_MS`, and
`UNQUOTE_BENCH_AGENT_TRAJECTORY_DOM_NODES_BUDGET`.

Agent fixtures also report `agentTrajectoryBuildMs` from exactly one
`unquote:agentTrajectory:build` PerformanceMeasure. The entry covers only the
pure trajectory projection held by the memoized Agent session model; parsing,
React rendering, and DOM readiness are outside its duration. Missing,
duplicate, or invalid entries are recorded under
`measurementFailures.agentTrajectoryBuildMs` instead of being treated as zero.
The benchmark requires one valid sample per run and gates each Agent fixture's
p50 at 50 ms; `UNQUOTE_BENCH_AGENT_TRAJECTORY_BUDGET_MS` provides the usual
runner-specific override.

The 50 ms limit comes from three successful `ubuntu-latest` reports for the
same head SHA `b324219837d20e2358d9db9ba91051b96c8cbbb0`, each with three
samples and no measurement or budget failures:

| Workflow run | 5K p50 | 5K max |
|---|---:|---:|
| `31899249716` | 21.8 ms | 26.5 ms |
| `31899354974` | 19.1 ms | 19.3 ms |
| `31899454700` | 18.8 ms | 37.1 ms |

The slowest p50 was 21.8 ms, the cross-run p50 spread was 3.0 ms, and the
slowest individual sample was 37.1 ms. `37.1 + 3.0 = 40.1 ms`; the next 10 ms
boundary is 50 ms. That leaves 28.2 ms above the slowest p50 and 12.9 ms above
the slowest individual sample, while remaining below the 600 ms stop limit.

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
add session-ready p50 under 600 ms, tool-expand p50 under 150 ms, and trajectory
projection p50 under 50 ms, Trajectory ready p50 under 100 ms, item selection
ready p50 under 60 ms, and Trajectory DOM nodes under 1400. Use
`benchmark:case4-fixture -- --rows=100000` for local 100k-row stress runs; the
100k fixture is intentionally generated locally instead of committed.
