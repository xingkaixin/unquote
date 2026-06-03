# Performance Benchmarks

Run the release gate with:

```sh
pnpm benchmark
```

The command force-builds the app, runs the benchmark in headless Chrome, writes
`benchmark/results/latest.json`, and exits with a non-zero status when a budget is
exceeded.

Generate ignored local JSONL fixtures with:

```sh
pnpm benchmark:fixtures
pnpm benchmark:fixtures -- --force
pnpm benchmark:case4-fixture
pnpm benchmark:case4-fixture -- --rows=100000 --out=case4-100K-rows.jsonl --force
```

## 0.2.0 Budgets

| Metric | Budget |
|---|---:|
| First record visible p95 | 1000 ms |
| Complete UI parse p95 | 3000 ms |
| DOM nodes max | 10000 |
| JS heap used max | 256 MB |

## Baseline

Captured on 2026-05-17 with Node v24.15.0, macOS arm64, 10 CPU cores, 32 GB
memory, 3 samples and 1 warmup per fixture.

| Fixture | Records | Core p95 | First record p95 | Complete p95 | DOM max | Heap max |
|---|---:|---:|---:|---:|---:|---:|
| `benchmark/case1.jsonl` | 431 | 29.77 ms | 251.8 ms | 252.2 ms | 4408 | 11.39 MB |
| `benchmark/case2-1MB.jsonl` | 437 | 29.21 ms | 240.8 ms | 241.3 ms | 4580 | 11.62 MB |
| `benchmark/case2-5MB.jsonl` | 43 | 9.25 ms | 168.3 ms | 168.8 ms | 4516 | 11.92 MB |
| `benchmark/case2-10MB.jsonl` | 388 | 36.01 ms | 228.3 ms | 228.7 ms | 4594 | 20.31 MB |
| `benchmark/case4-5K-rows.jsonl` | 5260 | 411.74 ms | 254 ms | 626.9 ms | 4557 | 130.49 MB |

`core p95` measures `@unquote/core` forced JSONL parsing. `first record p95`
measures the time from dropping a local JSONL file to `record-1` becoming
visible. `complete p95` measures the time until the UI stats show all expected
records. `searchReadyMs` measures the toolbar search interaction for the
benchmark query `nested`. `expandPathReadyMs` measures one visible stringified
JSON toggle when the fixture exposes one.

Chrome Performance recordings include `unquote:*` user timing entries for the
main hot paths: `parse:first-batch`, `parse:complete`, `search:memory`,
`recordRows:build`, `expand:all:collect`, and `expand:path`. Use these marks
with the React Profiler to confirm whether search, tree row construction, or
expanded-path state is the active bottleneck before optimizing.

`case4-5K-rows` is the high-record-count release fixture. It uses the same
release budgets as the smaller fixtures: first record p95 under 1000 ms,
complete p95 under 3000 ms, DOM nodes under 10000, and JS heap under 256 MB.
Use `benchmark:case4-fixture -- --rows=100000` for local 100k-row stress runs;
the 100k fixture is intentionally generated locally instead of committed.
