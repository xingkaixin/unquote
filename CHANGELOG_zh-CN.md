# Changelog

## [0.2.0] - 2026-05-02

### Added

- **搜索与过滤** — 类似浏览器 Ctrl+F 的实时搜索体验
  - 实时搜索，支持 key、value、path 三维度匹配
  - JSONPath / jq 语法路径搜索（如 `$.timestamp`）
  - 正则表达式搜索开关
  - 大小写敏感开关
  - 匹配文本高亮（普通 match + active match 双重样式）
  - 上/下按钮循环跳转，自动滚动到对应节点
  - 虚拟列表兼容（`scrollToIndex`）与非虚拟化 `scrollIntoView` 双模式
  - match 位于折叠 stringified 节点内部时自动展开路径
  - 匹配计数显示（`3/15` 格式）
- 新增国际化文案：`search.placeholder`、`search.regex`、`search.caseSensitive`、`search.prev`、`search.next`、`search.clear`、`search.jq`

### Changed

- SEO 元信息统一更新为 **"Unquote - Escaped JSON Expander & JSONL Viewer"**
  - 网页 title / description / og / twitter / schema
  - og-image.svg 标题与副标题
  - Chrome 插件 `appName`（en / zh_CN）
- 依赖升级

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
