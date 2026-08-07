# Changelog

> `@unquote/core` 与 `@unquote/ui` 是仓库内部包，不会发布到任何 registry。
> 其中标记为**破坏性变更**的条目描述的是仓库内部的迁移，而不是对外部调用方的通知。
> 见 [`docs/core-distribution.md`](docs/core-distribution.md)。

## [1.0.0] - 2026-08-07

### Added

- 新增专用导入流程，提供聚焦的空状态、模态 Source 编辑器、JSON / JSONL 实时识别、样例输入、粘贴 / 拖入 / 文件入口及显式格式选择。
- 新增常驻的选中节点检查器，支持复制值、复制路径和一键展开字符串化 JSON。
- Web 应用在 Chrome Web Store 入口旁新增 Edge Add-ons 快捷入口。

### Changed

- JSON 工作区改为响应式三栏布局，由虚拟化记录导航、单条选中 Record 树和节点检查器组成；搜索、过滤、展开、复制与导出仍可围绕工作区直接操作。
- Agent 会话视图改为独立的时间线、对话和会话概况三栏布局，长会话支持虚拟化，并提供可展开的工具调用 / 结果详情、会话指标及返回对应 JSONL Record 的入口。
- Expand All 与 Collapse All 现在作为并列的显式操作，仅作用于选中的 Record，不再跨所有可见 Record 执行。
- 大型 JSONL 现在只在虚拟化记录导航旁挂载一条选中 Record 的树，显著降低高记录数发布 fixture 的 DOM 与内存占用；发布 benchmark 及其 DOM 预算也已按新工作区重新校准。
- Chrome Web Store 与 Edge Add-ons 截图已更新为 1.0 界面。
- 开发与扩展工具链升级到 pnpm 11.20、Vite 8、WXT 0.21 和 jsdom 30，并移除已不再需要的依赖 override。
- Web 与浏览器扩展应用版本（包括 Safari 宿主应用营销版本）升级到 `1.0.0`。

### Fixed

- 大型或单行导入草稿在实时格式识别时不再阻塞页面，也不会仅因探测预算耗尽而显示错误的“无法解析”提示。
- 虚拟化记录导航和树行不再互相重叠，从字符串化 JSON 展开的后代节点也会保留正确的嵌套视觉轨道。
- Agent 时间线现在优先显示易读分类，并只展示会话实际报告的轮次；活动标签、控件和工具详情也会保持预期的字体与状态样式。
- 解析失败只向辅助技术播报一次；已载入 Source 控件、时间线行和工作区标题的可访问名称也与可见标签一致。

## [0.13.0] - 2026-07-30

### Added

- 新增原生 macOS 宿主应用和可重现的 Safari 扩展构建流程，并加入 Safari 专用权限过滤与 CI 校验。

### Changed

- 大型本地 JSONL 现在直接从源文件流式导出记录并增量反馈进度，无需水合全部完整记录，降低峰值内存占用。
- 大输入路径减少重复工作：经过 checkpoint 的行扫描跳过字节复制，单行 JSON 自动检测复用严格解析结果，搜索只保留可见标签范围内的高亮区间。
- Web Worker 不可用时，同步解析和搜索会限制在安全的输入预算内；超大任务会停止并显示本地化反馈，不再阻塞页面。
- `@unquote/core` 与 `@unquote/ui` 现在明确为仓库内部包，不再暗示存在实际并未提供的 registry 发布。
- Safari 打包与 benchmark 指标在缺少必要产物或预算样本时会让 CI 失败，减少发布门禁静默失效的风险。
- Web 和扩展应用版本升级到 `0.13.0`。

### Fixed

- Web 应用不再加载远程 analytics beacon，Content Security Policy 也不再放行对应端点。
- 依赖升级与定向 override 清除了开发和扩展构建链中的 5 个高危安全告警。
- Parser 和 Search Worker 失败时现在会彻底终止并进入明确的错误状态，不再让任务停留在 pending。
- 名为 `__proto__`、`constructor`、`prototype` 或其他原型成员的 JSON key 现在能在 preview、搜索和路径解析中保持原样。
- Claude Code 会话现在会把每个并行 `tool_result` 保留为独立对话项，并关联正确的 tool-call ID 与状态。
- 只有最新的复制请求可以写入剪贴板；被新来源取代的文件读取也会停止继续消费数据，不再针对过期来源完成。

## [0.12.0] - 2026-07-27

### Added

- 新增 Chrome Web Store 与 Edge Add-ons 的提交说明和上架素材，位于 `assets/`。

### Changed

- **破坏性变更（`@unquote/core`）** — `JsonlRecord` 改为 Full / Preview / Failed 可判别联合，并要求 `status` 字段。调用方应迁移到 `isFullRecord`、`isPreviewRecord`、`isFailedRecord` 与 `isParsed`。
- **破坏性变更（`@unquote/core`）** — `JsonNode` 改为可判别联合，只保存容器 children、截断容器 value、紧凑 preview 或带类型的 primitive 之一；移除冗余的 `path`、`wasStringified` 与 `meta`。调用方应在遍历时推导路径和深度，使用所属 `JsonlRecord.lineNumber`，并迁移到 `hasJsonNodeChildren`、`isStringifiedNode` 与 `isTruncatedJsonNode`。
- **破坏性变更（`@unquote/core`）** — 移除已弃用的 `parseDeferredJsonlRecordLine` 别名，请改用 `parsePreviewJsonlRecordLine`。
- 大型 JSONL 工作流在持续导入、搜索、Agent 会话和展开路径上更流畅，并降低内存占用：流式 insight / overview 推导不再回扫既有记录，本地文件搜索会预过滤行并复用 Source Revision，Agent 会话复用顶层 JSON 并按需加载原始行，Expand All 与展开映射按次批量更新，树键盘导航改用索引表。
- 解析、搜索、查询、Agent 输出和导航现在共享同一 Source Revision，切换文件或任务被取代时会在渲染前拒绝过期结果。
- Agent Session 的 Conversation Item 现在直接归属于对应的 timeline Event；专用领域 model 通过唯一的 Event → Record 关联统一解析 timeline、conversation 与 Record 选择。
- CI 性能门禁现在会在预算超标时失败；延迟预算按三次采样的中位数判定，并跟踪 Expand Path 与 Expand All 就绪时间。
- 本地文件访问、树工具、工作区 session 绑定及相关 hooks 收敛到更清晰的模块边界并补充专门测试，降低维护与发布风险。
- Web 和扩展应用版本升级到 `0.12.0`。

### Fixed

- Expand All 现在可作用于本地文件 Preview Record，并会在一次点击中展开每一层嵌套的字符串化 JSON。
- 展示与 preview 截断现在会保留 Unicode 代理对，不再把 emoji 等多单元字符截断拆开。
- 搜索不再报告树中不可见的 key 匹配；长截断值的高亮范围也会与显示文本对齐。
- 被中止的进程内回退搜索不再覆盖当前查询结果。
- 文件导出下载不再在浏览器完成下载前撤销 Blob URL。

## [0.11.0] - 2026-07-23

### Added

- 仓库安装现在会配置轻量的 pre-commit 门禁：格式检查已暂存的 TypeScript、TSX、CSS 和 JSON 文件，对其中的 TypeScript 与 TSX 运行 lint，然后执行类型检查。

### Changed

- 流式追加 JSONL 记录时，现在会增量更新记录索引、选中状态协调、文件概览和记录洞察，避免大型文件载入过程中反复扫描全部记录。
- 命令面板和文件概览动效、悬停提示、树展开点击区域、键盘焦点状态与弱化文本对比度得到细化，同时保留减少动效行为。
- 树展示推导、全局快捷键、Toolbar 摘要和概览/洞察字段提取拆分到聚焦的共享模块并补充专门测试，降低 UI 维护与发布风险。
- Web 和扩展应用版本升级到 `0.11.0`。

### Fixed

- 切换源内容或搜索输入时不再短暂暴露旧匹配结果，Web Worker 不可用时也仍可执行正则搜索。
- 键盘导航现在会让非虚拟化树行保持可见；概览控件、行操作、字段标签和状态徽章也会暴露一致的可访问及本地化状态。
- 当异常 token 在输入中出现多次时，解析错误不再显示可能指向错误位置的插入符。

## [0.10.0] - 2026-07-18

### Added

- 影响解析或渲染的 Pull Request 现在会生成非阻塞的基准报告，用于持续跟踪性能。
- Web 应用现在提供 Content Security Policy。

### Changed

- Web 应用不再把源输入存入 URL hash，并会在加载时清除旧版 source hash，避免 payload 被保留在分享链接或浏览器历史中。
- 重复搜索、包含无效记录的 JSONL 解析，以及流式记录或 Agent 会话更新现在会复用已有工作并减少中间快照发布，提升持续 JSONL 工作负载下的响应速度。
- 下拉菜单动效、进度反馈、Toolbar 尺寸和语义状态颜色得到统一，同时保留减少动效行为。
- 开发基线升级到 Node.js 24、TypeScript 7 和 Vitest 4，并在发布质量门禁中加入覆盖率阈值。
- `@unquote/core` 现在只暴露已记录的解析器能力；移除了仅供内部实现使用的 `buildNode`、`detectFormat`、`expandNode`、`extractSummary`、`isJsonContainer` 和 `summarizePrimitive` 导出。
- Web 和扩展应用版本升级到 `0.10.0`。

### Fixed

- Web Worker 不可用时，正则搜索不再回退到阻塞主线程；超大搜索结果集也不再导致匹配聚合溢出。
- 简体中文扩展 manifest 现在使用本地化应用名称。

## [0.9.0] - 2026-07-13

### Changed

- 大型 JSONL 工作流在高记录数下的记录导航、Agent 时间线与对话、搜索、概览更新和延迟水合现在更流畅，减少了主线程工作和长期保留的内存。
- 工作区布局和控件现在提供更一致的响应式结构、语义化页面导航、可访问的控件状态、减少动效支持，并在首次渲染前应用系统主题。
- Agent 会话详情和界面文案现在保持一致的本地化，包括时间戳。
- Web 和扩展应用版本升级到 `0.9.0`。

### Fixed

- JSONL 按记录展开和 Agent 原始记录水合现在会定位当前记录，不再在记录之间泄漏状态。
- JSONL 格式化现在会输出有效的逐行 JSON，恢复路径匹配也不再把路径片段误当成字符串子串。
- 解析深层原生 JSON 容器时现在有深度上限，避免无界递归。
- 过期的文件读取、被新任务取代的搜索 worker、扩展选择交接和过大的 URL hash 不再覆盖当前状态或无谓地继续运行。
- 粘贴文件名、本地化文案、主题偏好以及键盘/屏幕阅读器交互现在能保持预期状态。

## [0.8.0] - 2026-07-03

### Changed

- 发布质量门禁现在接入 GitHub Actions，覆盖类型检查、lint、测试和 oxfmt 格式检查。
- 解析器、agent 会话识别、源文件加载、导出操作、记录流水线、树遍历和流式解析更新拆分为更聚焦的模块，并补充对应测试，降低后续发布风险。
- Web 和扩展应用版本升级到 `0.8.0`。

### Fixed

- JSONPath / jq 路径跳转后复制选中节点不再丢失原始 key 元数据或抛错。
- 文件导入和延迟本地文件读取失败时，现在会通过 toast 给出反馈，不再静默失败。
- 复制操作中的剪贴板写入失败现在会显示用户可见错误。
- 当新的解析任务取代旧任务或组件卸载时，Parser worker 会被干净终止。

## [0.7.0] - 2026-06-29

### Added

- Agent 会话视图会自动识别 Codex rollout 和 Claude Code JSONL transcript，并展示会话元信息、对话轮次、思考内容、工具调用/结果、时间线事件，以及对应的原始 JSONL 记录。
- 样例输入新增 Codex rollout JSONL 会话，用于直接体验 Agent 视图。

### Changed

- 被识别为 agent 日志的输入现在使用 Agent / JSON 双标签输出，可在会话视图和常规展开 JSON 树之间切换。
- 主界面围绕 Source 面板、记录导航、树行和 agent 详情面板收紧，旧的独立 Path Inspector / 状态栏流程改为内联记录和节点操作。
- Web 和扩展应用版本升级到 `0.7.0`。

## [0.6.0] - 2026-06-19

### Added

- 复制和导出现在会通过响应式 toast 反馈提示大文件复制受限和长时间导出进度。

### Changed

- Expand All 和 Collapse All 合并为一个会随当前状态切换的 Toolbar 按钮。
- 复制和导出操作收拢到更多菜单中，并始终输出展开后的对象结构，不再把 stringified JSON 还原成原始转义字符串。
- 大型 JSONL 导出改为分块序列化记录，格式化 JSON 数组导出也改为流式输出记录且保持导出字节不变。
- 本地 JSONL 源访问、路径解析/格式化、命令/搜索/路径交互状态拆分为更聚焦的模块，并补充对应测试。
- Web 和扩展应用版本升级到 `0.6.0`。

### Fixed

- 大型复制和导出操作不再因为在主线程构建单个巨大字符串而冻结页面。
- 点击 TOC 记录后，平滑滚动过程中的 scroll-spy 更新不再覆盖用户刚选中的高亮记录。

## [0.5.0] - 2026-06-05

### Added

- **命令面板** — 新增 `Cmd/Ctrl+K` 面板，集中支持搜索、路径跳转、记录过滤和命令发现。
- 浏览器性能标记覆盖解析、搜索、树行构建和展开等热路径，便于发布前 profiling。

### Changed

- 搜索和 JSONPath / jq 风格路径跳转合并到更紧凑的 Toolbar 输入框，并内联展示匹配跳转和状态。
- 复制、导出和 Restore All 操作收拢到同一个更多菜单中，同时保留 Expand All 作为主操作。
- 大型本地 JSONL 文件会先传输延迟预览记录，仅在打开或复制记录时按需水合完整记录，降低高记录数文件的内存压力。
- 记录过滤简化为明确模式：全部、搜索命中、解析错误、嵌套记录、工具、消息和事件。
- Web 和扩展应用版本升级到 `0.5.0`。

### Fixed

- 大型 JSONL 导入不再在用户打开或复制记录前，把所有完整解析记录长期保留在 UI 内存中。

## [0.4.0] - 2026-05-24

### Added

- **GitHub Open Graph 图片** — 新增 PNG 社交预览图，用于 GitHub 链接卡片展示。

### Changed

- 大型 JSONL 导入改为更快的流式渲染路径，解析结果更早增量进入 UI，减少首条记录可见前的主线程工作。
- 优化 JSONL 热路径，包括行索引、路径匹配、树遍历和 Worker 传输负载。
- 文件概览和记录洞察在流式记录追加时更充分复用缓存结果。
- URL hash 压缩逻辑拆到独立 helper，并补充 Web 应用测试。
- 基准工具新增高记录数 case 4 fixture 生成器，用于发布前压力测试。
- Web 和扩展应用版本升级到 `0.4.0`。

### Fixed

- AGENTS.md instruction 文本不再因为正文包含 `error` 等词而被误识别为错误记录。

## [0.3.0] - 2026-05-17

### Added

- **文件概览** — 面向 JSON / JSONL 导入的高层诊断
  - 统计总记录、成功、失败、含嵌套记录和最大深度
  - 展示高频 nested JSON 路径和常见 `event` / `type` / `tool` 字段值
  - 预览解析错误，并支持跳转到对应记录
  - 概览项可直接触发路径跳转或搜索
- **记录洞察** — 面向日志、Agent、工具调用 JSONL 的单记录摘要
  - 将记录识别为错误、工具、消息或事件
  - 提取 timestamp、level、status、role、event、tool、error、message 等常见字段
  - 在记录卡片和记录导航侧栏展示洞察标签
  - 新增工具、消息、事件和任意 insight 字段值过滤
- **聚焦与提取工具** — Path Inspector 支持隔离和复制选中数据
  - 聚焦选中子树，并可在保留选中路径的情况下退出聚焦
  - 复制子树、转义字符串、原始值和选中节点调试包
  - 将当前可见记录导出为 JSONL 或格式化 JSON
- **样例输入** — 一键载入转义 API 响应、Agent 工具调用 JSONL、有效/无效混合 JSONL。

### Changed

- 大型 JSONL 文件导入后，复制和导出会按需读取完整源记录，同时 UI 只接收压缩后的预览节点。
- 大量记录场景启用记录级窗口虚拟列表，并保留树节点的懒加载水合。
- 文件导入和渲染基准支持指定 fixture，并使用真实文件输入路径。
- Web 和扩展应用版本升级到 `0.3.0`。
- Web 社交分享元信息改为指向 PNG Open Graph 图片。

### Fixed

- 大型 JSONL 导入中预览字符串被压缩后，搜索、复制、导出、路径跳转和聚焦状态仍能继续工作。
- 当搜索结果或记录过滤移动到聚焦路径之外时，会清除当前聚焦子树。

## [0.2.0] - 2026-05-10

### Added

- **搜索与过滤** — 跨 JSON 记录和嵌套 stringified JSON 的浏览器式导航
  - 搜索 key、value、JSONPath / jq 风格路径
  - 正则表达式和大小写敏感模式
  - 匹配高亮、上/下跳转、匹配计数
  - 支持虚拟列表和标准树渲染的自动滚动
  - 自动展开包含匹配项的 stringified JSON 路径
  - 记录过滤：全部、搜索命中、解析错误、嵌套 JSON
- **路径工具** — JSONPath / jq 直达跳转和节点检查
  - 跨 JSON / JSONL 记录跳转到精确路径
  - 查看选中节点的路径、原始 key、类型、来源和记录编号
  - 复制 JSONPath 和 jq selector
  - 底部状态栏显示当前格式、统计信息、悬停或选中的路径
- **大型 JSONL 导入** — 对粘贴和拖入的 JSONL 文件进行流式解析
  - Source 面板支持文件拖放和剪贴板文件导入
  - 显示解析状态、进度、已导入文件预览
  - Worker 分块解析并批量更新记录
- **解析诊断** — 为无效 JSON / JSONL 提供行列元数据
  - Source 和 Output 视图显示错误上下文片段
  - 保留失败原始行，支持复制
  - 自动模式在混合 JSONL 输入中保留有效记录
- **性能基准工具** — 面向大型 JSONL fixture 的发布门禁
  - `pnpm benchmark` 和 `pnpm benchmark:fixtures`
  - Headless Chrome 渲染指标和 core parser p95 基线
  - `docs/performance.md` 记录 0.2.0 性能预算

### Changed

- Web 和扩展应用版本升级到 `0.2.0`。
- SEO 元信息围绕 escaped JSON / JSONL 搜索意图调整
  - 页面 title、description、Open Graph、Twitter card、schema.org、sitemap、`og-image.svg`
  - Chrome 扩展展示名称更新为 **"Unquote - Escaped JSON Expander & JSONL Viewer"**
  - Web 应用接入 Cloudflare Web Analytics
- Toolbar 和记录导航布局针对响应式屏幕收紧。
- 复制操作拆分为格式化 JSON 和 JSONL 输出。
- 依赖升级：Tailwind CSS、Vite、WXT、oxlint、TypeScript、lockfile。

### Fixed

- Turbo build 任务现在依赖上游包构建。

## [0.1.0] - 2026-04-29

### Added

- **JSON / JSONL 解析器** — 本地解析，支持递归展开 stringified JSON
  - 单文件 JSON 浏览
  - 多记录 JSONL 浏览（带记录导航 TOC）
  - Web Worker 后台解析，避免阻塞主线程
- **Chrome 扩展** — 右键菜单一键打开当前页面 JSON 到 Unquote
  - 选项页配置
  - 简化权限模型
- **响应式 UI** — Cursor design system
  - 主题切换（light / dark / system）
  - 国际化（英文 + 简体中文）
  - 文件拖放导入
  - 节点折叠/展开（stringified JSON 嵌套自动展开）
  - 路径复制、节点值复制、整记录复制
  - 虚拟列表优化（>160 节点自动启用）
- **SEO & 品牌**
  - og-image、Twitter card、schema.org 结构化数据
  - canonical 链接、robots 元标签
- 完整的类型检查、lint、单元测试体系（Vitest + oxlint）
