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
```

## 0.2.0 Budgets

| Metric | Budget |
|---|---:|
| First record visible p95 | 1000 ms |
| Complete UI parse p95 | 3000 ms |
| DOM nodes max | 10000 |
| JS heap used max | 256 MB |

## Baseline

Captured on 2026-05-05 with Node v25.9.0, macOS arm64, 10 CPU cores, 32 GB
memory, 3 samples and 1 warmup per fixture.

| Fixture | Records | Core p95 | First record p95 | Complete p95 | DOM max | Heap max |
|---|---:|---:|---:|---:|---:|---:|
| `benchmark/case1.jsonl` | 431 | 25.53 ms | 150.5 ms | 186.2 ms | 8952 | 63.62 MB |
| `benchmark/case2-1MB.jsonl` | 437 | 32.04 ms | 158.6 ms | 183.9 ms | 9225 | 124 MB |
| `benchmark/case2-5MB.jsonl` | 43 | 9.75 ms | 149.3 ms | 163.3 ms | 2617 | 64.57 MB |
| `benchmark/case2-10MB.jsonl` | 388 | 33.67 ms | 160.5 ms | 211.7 ms | 8392 | 70.86 MB |

`core p95` measures `@unquote/core` forced JSONL parsing. `first record p95`
measures the time from dropping a local JSONL file to `record-1` becoming
visible. `complete p95` measures the time until the UI stats show all expected
records.
