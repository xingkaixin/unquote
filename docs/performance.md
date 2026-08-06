# Performance Benchmarks

Run the release gate with:

```sh
pnpm benchmark
```

The command force-builds the app, runs the benchmark in headless Chrome, writes
`benchmark/results/latest.json`, and exits with a non-zero status when a budget is
exceeded.

Set `UNQUOTE_BENCH_CHROME` to use a Chrome executable outside the default macOS
and Linux locations. Runner-specific budgets can be supplied with
`UNQUOTE_BENCH_FIRST_RECORD_BUDGET_MS`, `UNQUOTE_BENCH_COMPLETE_BUDGET_MS`,
`UNQUOTE_BENCH_EXPAND_PATH_BUDGET_MS`, `UNQUOTE_BENCH_EXPAND_ALL_BUDGET_MS`,
`UNQUOTE_BENCH_DOM_NODES_BUDGET`, and `UNQUOTE_BENCH_HEAP_BUDGET_MB`.

## CI Gate

Pull requests that can affect parser or rendering performance run the Benchmark
workflow on GitHub's Ubuntu runner. Budget overruns fail the job. The JSON
report is retained as the `benchmark-results` artifact for 14 days.

The workflow generates deterministic case 2 and case 4 fixtures on the runner
and writes the report outside the checkout. This keeps workstation-only inputs
out of CI and prevents a tracked local baseline from being uploaded as a new run.

Latency budgets gate on the median (p50) of three samples so a single slow run
on a shared runner does not trip the check. p95 remains in the report for
diagnostics. Override a pathological runner with the `UNQUOTE_BENCH_*_BUDGET_*`
environment variables above.

Generate ignored local JSONL fixtures with:

```sh
pnpm benchmark:fixtures
pnpm benchmark:fixtures -- --force
pnpm benchmark:case4-fixture
pnpm benchmark:case4-fixture -- --rows=100000 --out=case4-100K-rows.jsonl --force
```

## Release Budgets

| Metric | Budget |
|---|---:|
| First record visible p50 | 1500 ms |
| Complete UI parse p50 | 3000 ms |
| Expand Path ready p50 | 400 ms |
| Expand All ready p50 | 800 ms |
| DOM nodes max | 3000 |
| JS heap used max | 256 MB |

## Baseline

Captured on 2026-08-06 with Node v24.19.0, macOS arm64, 10 CPU cores, 32 GB
memory, 3 samples and 1 warmup per fixture.

| Fixture | Records | Core p95 | First record p95 | Complete p95 | DOM max | Heap max |
|---|---:|---:|---:|---:|---:|---:|
| `benchmark/case1.jsonl` | 431 | 26.27 ms | 196 ms | 202.7 ms | 1217 | 6.19 MB |
| `benchmark/case2-1MB.jsonl` | 1610 | 192.93 ms | 159.4 ms | 178.8 ms | 818 | 6.42 MB |
| `benchmark/case2-5MB.jsonl` | 7956 | 938.76 ms | 155.7 ms | 242.5 ms | 818 | 13.38 MB |
| `benchmark/case2-10MB.jsonl` | 15765 | 2012.53 ms | 157 ms | 345.7 ms | 818 | 22.34 MB |
| `benchmark/case4-5K-rows.jsonl` | 5260 | 339.06 ms | 169.8 ms | 459.8 ms | 1375 | 16.74 MB |

`core p95` measures `@unquote/core` forced JSONL parsing. `first record p95`
measures the time from dropping a local JSONL file to `record-1` becoming
visible. `complete p95` measures the time until the UI stats show all expected
records. `searchReadyMs` measures the header search interaction for the
benchmark query `nested`. `expandPathReadyMs` measures one visible stringified
JSON toggle in the first record that exposes one. `expandAllReadyMs` covers the
displayed record only, so values recorded before the three-column redesign are
not comparable.

Chrome Performance recordings include `unquote:*` user timing entries for the
main hot paths: `parse:first-batch`, `parse:complete`, `search:request`,
`search:memory`, `search:file`, `recordRows:build`, `expand:all:collect`, and
`expand:path`. `search:request` spans dispatch to a terminal worker response,
while `search:memory` and `search:file` isolate the two execution paths. Use
these entries with the React Profiler to confirm whether search, tree row
construction, or expanded-path state is the active bottleneck before optimizing.

`case4-5K-rows` is the high-record-count release fixture. It uses the same
release budgets as the smaller fixtures: first record p50 under 1500 ms,
complete p50 under 3000 ms, Expand Path p50 under 400 ms, Expand All p50 under
800 ms, DOM nodes under 3000, and JS heap under 256 MB. Use
`benchmark:case4-fixture -- --rows=100000` for local 100k-row stress runs; the
100k fixture is intentionally generated locally instead of committed.
