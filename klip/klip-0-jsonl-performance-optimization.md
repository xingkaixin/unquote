---
Author: "Codex"
Updated: 2026-05-17
Status: Complete
---

# klip-0-jsonl-performance-optimization

## 现状结论（代码校准）

- `@unquote/core` 的 forced JSONL 解析在现有基准下表现稳定。证据：`docs/performance.md` 记录 43-5260 records 的 `Core p95` 为 9.25-411.74 ms，`benchmark/perf-benchmark.mjs` 的 `benchmarkCore()` 使用 `parseInput(input, { forcedFormat: "jsonl" })`。
- 当前 release gate 已覆盖高记录数 JSONL。证据：`docs/performance.md` 记录 `benchmark/case4-5K-rows.jsonl` 的 5260 records baseline，`benchmark/perf-benchmark.mjs` 默认 fixture 已包含 `case4-5K-rows.jsonl`。
- 流式 JSONL 解析采用 worker batch 推送，主线程用 append-only records backing array 接收。证据：`packages/ui/src/worker/parser-worker.ts` 中 `batchSize = 64`，`packages/ui/src/hooks/use-parser.ts` 用 `streamedRecords.push(...message.records)` 和 `recordsVersion` 发布更新。
- 大 JSONL 文件会走 `sourceFile` 流式路径，主输入区不再持有完整文本。证据：`packages/ui/src/app.tsx` 中 `largeSourceCollapseBytes = 1_000_000`，`handleFileDrop()` 对大 `.jsonl` 设置 `sourceFile` 并清空 `sourceText`。
- 文件搜索为了覆盖 worker transfer 截断后的长字符串，会重新读取原始 `sourceFile`。证据：`packages/ui/src/app.tsx` 的 `searchJsonlFile()` 逐行 `parseJsonlRecordLine()`；`packages/ui/tests/app.test.tsx` 中 `searches full string content in streamed JSONL files` 覆盖了超过 `maxTransferStringLength` 后的全文搜索。

## 背景

- Unquote 的核心使用场景是本地调试 AI/Agent 日志中的 JSONL 和 stringified JSON。
- 性能门禁现在覆盖 1-10MB、低到中等记录数文件，以及 5K+ records 的高记录数 JSONL。
- 本次复杂度审计发现，主要风险不是单次解析算法本身，而是流式 batch 到达后主线程反复复制、反复派生、反复扫描 DOM。
- 100k records 作为本地压力测试 fixture 生成参数保留，不进入默认 release gate，避免默认 benchmark 过重。

## 目标

- 增加能暴露高记录数扩展问题的 benchmark 和测试场景。
- 让流式 JSONL 的主线程处理从随 batch 数重复全量工作，收敛为增量或按稳定输入 memoized 的工作。
- 保留现有用户行为：本地解析、全文搜索、stringified JSON 展开、path jump、overview、TOC、复制/导出。
- 给后续优化留下可持续跟踪的 task checklist。

## 非目标

- 不改变 `@unquote/core` 的公开数据结构和解析语义。
- 不引入后端、IndexedDB、云同步或文件索引服务。
- 不实现完整 jq 执行器，也不改变当前 jq/path 搜索的范围。
- 不以缓存隐藏数据变化；所有缓存必须以明确输入为边界。

## 发现与方案

### P1（性能）1. Worker batch 合并导致高记录数近似 O(n²) ✅ 已完成

- 位置：`packages/ui/src/hooks/use-parser.ts`（`onMessage()` 中 batch 分支）
- 现象/风险：每个 batch 到达时使用 `[...current.records, ...message.records]` 复制已有全部 records。64 条一批时，10k/100k 行文件会反复复制旧数组。
- 当前复杂度：约 O(n² / batchSize) 的数组复制。
- 建议方案：先通过 benchmark 确认瓶颈；随后考虑降低 React state 写入频率、批量合并多个 worker batch，或将 records 存储从 repeated spread 调整为更低复制成本的结构。
- 目标复杂度：O(n) 级别的累计合并。
- 风险：中。需要确认 `result.records` 的引用变化仍能正确触发 UI、overview、filter 和 copy/export。
- 验收标准：10k/100k records fixture 下，batch 合并不再成为主线程长任务来源。
- 实施状态：`useParser` 改为 append-only `streamedRecords` backing array，并用 `recordsVersion` 显式驱动 UI 派生数据更新；worker batch 不再复制历史 records。
- 验证：`packages/ui/tests/use-parser.test.tsx` 保持通过；`pnpm check` 通过；`benchmark/results/latest.json` 已包含 `benchmark/case4-5K-rows.jsonl`。

### P1（性能）2. 每个 batch 后重复派生全量 `recordInsights` / `fileOverview` / `visibleRecords` ✅ 已完成

- 位置：`packages/ui/src/app.tsx`（`recordInsights`、`visibleRecords`、`fileOverview`、`visibleStats`）
- 现象/风险：`createRecordInsightMap()` 和 `createFileOverview()` 已有 per-record cache，但每次 result 增长后仍要遍历当前所有 records；`filterRecords()` 与 `getRecordStats()` 也在每次 batch 后全量执行。
- 当前复杂度：流式场景约 O(n² / batchSize) 的顶层遍历，深遍历部分由 cache 降低常数。
- 建议方案：把 streaming session 的 overview/insight/stats 改为增量累积，或延迟到 worker complete 后生成非首屏数据；过滤结果按用户交互触发而非每个 batch 强制全量重算。
- 目标复杂度：O(n) 累计派生，交互时按需要 O(n)。
- 风险：中。overview 的 top counts、错误列表、filter 结果必须保持一致。
- 验收标准：同一文件完整解析后，overview 和 filter 结果与当前实现一致。
- 实施状态：新增 `RecordInsightMapState` / `FileOverviewState`，streaming append 场景只处理新增 records；`recordFilter === "all"` 时 `visibleStats` 直接复用 parser stats。
- 验证：新增 insight / overview 增量等价测试；`pnpm check` 通过。

### P1（性能）3. Active record observer 与虚拟列表目标冲突 ✅ 已完成

- 位置：`packages/ui/src/app.tsx`（`IntersectionObserver` effect）、`packages/ui/src/components/record-list.tsx`
- 现象/风险：`visibleRecords` 变化后 effect 遍历所有 visible records，并对每条记录 `document.getElementById(record.id)` 后 observe。高记录数下这会在主线程做全量 DOM 查询；虚拟列表中大量 record 本来并不在 DOM 中。
- 当前复杂度：每次 `visibleRecords` 变化 O(visibleRecords)。
- 建议方案：虚拟列表场景直接使用 `RecordList` 已有 `virtualRecords[0]` 推导 active record；非虚拟小列表保留 observer 或降低触发频率。
- 目标复杂度：虚拟场景 O(visibleItems)，非虚拟场景保持 O(n) 但只用于小列表。
- 风险：低到中。需要确认 TOC active 状态和滚动跳转行为。
- 验收标准：虚拟列表下 active record 跟随滚动，且没有全量 DOM 查询。
- 实施状态：导出 `recordVirtualizationThreshold`，`app.tsx` 的 active-record observer 在虚拟列表场景直接跳过；active record 由 `RecordList` 的虚拟项推导。
- 验证：新增 161 条记录的回归测试，确认虚拟列表不创建 app 级 active-record observer；case4-5K `taskDurationMs.p95` 下降到约 553 ms。

### P1（性能）4. 文件搜索每次 query 变化都全文件重读和重解析 ✅ 已完成

- 位置：`packages/ui/src/components/search-bar.tsx`（输入变更）、`packages/ui/src/app.tsx`（`searchJsonlFile()`）
- 现象/风险：用户连续输入时，每个 query 都可能触发一轮原始文件流式读取和逐行 parse。Abort 可以停止旧请求，但已经消耗的 IO/parse 无法回收。
- 当前复杂度：O(k * fileSize)，k 为输入过程中的 query 次数。
- 建议方案：对 `sourceFile` 搜索增加 debounce；或把搜索放入 worker 中合并请求，保证只有稳定 query 执行完整扫描。
- 目标复杂度：O(fileSize) per settled query。
- 风险：中。必须保留对被 worker transfer 截断长字符串的全文搜索。
- 验收标准：`packages/ui/tests/app.test.tsx` 的长字符串全文搜索仍通过。
- 实施状态：`sourceFile` 搜索增加 250ms debounce；query/sourceFile 变化会立即 abort 正在进行的文件扫描；内存搜索保持即时。
- 验证：长字符串全文搜索测试扩展为断言连续输入期间不会打开文件流，稳定 query 后只扫描一次；`pnpm check` 通过。

### P2（性能）5. 树行构建和搜索重复构造 path 字符串 ✅ 已完成

- 位置：`packages/ui/src/lib/tree.ts`（`pushRows()`、`searchNode()`、`collectPaths()`）
- 现象/风险：每个节点都从 `pathSegments` 重新 `formatJsonPath()` / `formatJqSelector()`，递归时还复制 `pathSegments`。深树或大树搜索时，成本会随 path depth 放大。
- 当前复杂度：约 O(nodes * depth)。
- 建议方案：递归时携带父级 `jsonPath` / `jqPath`，对子节点增量拼接；非 jq 搜索时延迟计算 path ranges。
- 目标复杂度：接近 O(nodes + outputPathChars)。
- 风险：低到中。需要覆盖 quoted key、数字 object key、array index、stringified path chain。
- 验收标准：`packages/ui/tests/tree.test.tsx` 中 path 相关测试保持通过，并补充深层路径基准。
- 实施状态：`tree.ts` 抽出单 segment path append 逻辑，`pushRows()` / `collectPaths()` / `searchNode()` 改为递归携带已格式化 path；`buildFocusedRecordRows()` 直接复用已解析的 resolved path。
- 验证：新增深层 quoted key + array index 搜索用例和 stringified path 收集用例；`pnpm check` 通过。

### P2（性能）6. JSONL chunk 行处理存在 per-chunk 字符串切片放大 ✅ 已完成

- 位置：`packages/ui/src/worker/parser-worker.ts`（`processJsonlChunk()`）、`packages/ui/src/app.tsx`（`readJsonlFileLines()`）
- 现象/风险：每处理一行都 `buffer = buffer.slice(newlineIndex + 1)`，同一 chunk 内行数很高时会重复复制剩余字符串。
- 当前复杂度：单 chunk 最坏 O(chunk²)，实际受 chunk size 限制。
- 建议方案：用 cursor 扫描 chunk，只在循环结束后保留 tail。
- 目标复杂度：O(chunk)。
- 风险：低。需要覆盖 CRLF、最后一行无换行、空行、abort。
- 验收标准：现有 parser/streaming tests 通过，新增 chunk 边界测试通过。
- 实施状态：新增 `drainJsonlLines()` 统一 worker streaming 和 app 文件搜索的 chunk 行扫描；扫描时只移动 cursor，循环结束后一次性保留 tail，不再每行切掉剩余 buffer。
- 验证：新增 `packages/ui/tests/jsonl-lines.test.tsx` 覆盖 CRLF、跨 chunk tail、空行、无尾换行和提前停止；现有 streamed JSONL 文件搜索测试保持通过；`pnpm check` 通过。

### P2（性能）7. Web hash sync 对大输入做无效压缩 ✅ 已完成

- 位置：`apps/web/src/main.tsx`（`syncHash()`）、`packages/ui/src/app.tsx`（`onSourceChange` effect）
- 现象/风险：每次 source 变化都先压缩完整文本，再判断压缩后是否超过 4KB。大输入最终不会写入 hash，但压缩成本已经发生。
- 当前复杂度：O(inputBytes) per change。
- 建议方案：压缩前先用原始长度设置硬阈值，或 debounce hash sync。
- 目标复杂度：大输入 O(1) 跳过，小输入 O(inputBytes)。
- 风险：低。需要确认小样本 hash 分享仍可用。
- 验收标准：小输入 URL hash 同步不回退，大输入不触发明显主线程压缩开销。
- 实施状态：新增 `apps/web/src/hash.ts`，把 hash 读写逻辑拆为可测 helper；`createSourceHash()` 在调用 lz-string 压缩前先跳过空输入和超过 `HASH_LIMIT * 16` 的原始输入。
- 验证：新增 `apps/web/tests/hash.test.ts` 覆盖小输入 hash、空输入、大原始输入压缩前跳过、压缩后超预算和 hash 恢复；`pnpm check` 通过。

## 建议落地顺序

1. 先补高记录数 benchmark，明确真实瓶颈和基线数字。
2. 优先处理 `useParser` batch 合并与 app 派生数据的重复全量工作。
3. 处理虚拟列表 active record 的全量 observer。
4. 处理文件搜索 debounce / worker 合并，保留全文搜索语义。
5. 做 tree path 增量构造和 chunk cursor 扫描这类局部优化。
6. 最后处理 hash sync 的常数级优化。

## 任务跟踪 Checklist

- [x] 增加高记录数 JSONL fixture 和 benchmark 输出（当前使用 `benchmark/case4-5K-rows.jsonl`）。
- [x] 增加 100k records JSONL fixture 或可生成 fixture 的脚本参数。
- [x] 在 `docs/performance.md` 记录高记录数 baseline 和预算。
- [x] 用 benchmark 或 profiler 确认 batch spread、derived data、observer 的占比。
- [x] 优化 `useParser` batch 合并，避免每个 batch 复制全部旧 records。
- [x] 将 `recordInsights`、`fileOverview`、`visibleRecords`、`visibleStats` 的 streaming 更新策略收敛为增量或低频重算。
- [x] 虚拟列表场景移除 `IntersectionObserver` 对全量 records 的 DOM 查询。
- [x] 为 `sourceFile` 搜索增加 debounce 或 worker request coalescing。
- [x] 保留并扩展长字符串全文搜索测试。
- [x] 优化 `tree.ts` path 构造，避免每个节点从 segments 重新格式化完整路径。
- [x] 优化 worker/app chunk 行处理，使用 cursor 而不是循环切片剩余 buffer。
- [x] 优化 `apps/web/src/main.tsx` 的大输入 hash sync 跳过逻辑。
- [x] 跑 `pnpm check`。
- [x] 跑 benchmark 并更新 `benchmark/results/latest.json`。

## 测试矩阵

| 场景 | 测试类型 | 覆盖要求 | 优先级 |
|---|---|---|---|
| 10k/100k records JSONL 打开 | benchmark | first record、complete ready、heap、DOM、task duration | P1 |
| 流式 batch 合并 | unit / integration | batch 顺序、stale response、progress、stats | P1 |
| Overview / Insight 增量更新 | unit | top nested paths、top field values、errors、maxDepth 与旧实现一致 | P1 |
| 虚拟列表 active record | integration / browser | 滚动时 TOC active record 正确，path jump 正确 | P1 |
| 大文件全文搜索 | integration | 超过 transfer 截断长度的字符串仍可搜索 | P1 |
| Path 构造优化 | unit | quoted key、数字 key、array index、jq selector、stringified chain | P2 |
| Chunk cursor 扫描 | unit | CRLF、空行、无尾换行、跨 chunk 行、abort | P2 |
| URL hash sync | unit / browser | 小输入可分享，大输入跳过压缩和 hash 写入 | P2 |

## 验收标准

- 高记录数 benchmark 被纳入性能文档，且能在本地稳定复现。
- 10k records JSONL 不出现由 batch 合并或全量派生造成的明显主线程长任务。
- 100k records JSONL 至少能完成解析、搜索和过滤，不发生不可恢复的 UI 卡死。
- 现有 `pnpm check` 通过。
- `pnpm benchmark` 在既有 fixture 上不退化，并新增高记录数 fixture 的基线结果。
- 用户可见行为保持一致：展开、搜索、path jump、overview、TOC、复制和导出不改变语义。

## 实施后检查清单

- [x] 对比优化前后的 `benchmark/results/latest.json`。
- [x] 用 Chrome Performance 或 benchmark 中 `taskDurationMs` 确认主线程长任务下降。
- [x] 检查 `jsHeapUsedSizeMB` 是否因缓存或增量结构上升。
- [ ] 手动验证大 `.jsonl` 文件导入、搜索、过滤、复制、导出。
- [ ] 手动验证 Chrome extension options 页面没有因 web-only 优化回归。

## 待讨论事项

- 100k records fixture 通过 `pnpm benchmark:case4-fixture -- --rows=100000` 本地生成，用作压力测试；正式 release gate 先使用 5K case4 fixture，避免默认 benchmark 过重。

## 关键参考位置

- `docs/performance.md`
- `benchmark/perf-benchmark.mjs`
- `benchmark/results/latest.json`
- `packages/core/src/parser.ts`
- `packages/ui/src/hooks/use-parser.ts`
- `packages/ui/src/worker/parser-worker.ts`
- `packages/ui/src/app.tsx`
- `packages/ui/src/lib/tree.ts`
- `packages/ui/src/lib/file-overview.ts`
- `packages/ui/src/lib/record-insight.ts`
- `packages/ui/src/components/record-list.tsx`
- `packages/ui/src/components/json-tree.tsx`
- `packages/ui/src/components/search-bar.tsx`
- `apps/web/src/main.tsx`
- `packages/ui/tests/app.test.tsx`
- `packages/ui/tests/use-parser.test.tsx`
- `packages/ui/tests/tree.test.tsx`
