# Changelog

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
