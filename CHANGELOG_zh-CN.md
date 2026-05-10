# Changelog

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
