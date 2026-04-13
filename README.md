<div align="center">
  <img src="logo.svg" width="120" alt="Unquote Logo">
</div>

<h1 align="center">Unquote</h1>

检测并展开 JSON 中的字符串化（stringified）值，专为处理 AI 模型输出和 MCP/Agent 工具调用中的嵌套 JSON 设计。

## 功能

- 自动检测并递归展开字符串化的 JSON 值
- 交互式展开/折叠 UI，直观显示嵌套层级
- JSONL（JSON Lines）格式支持，含目录导航
- JSON 路径显示、一键复制、语法高亮
- 深色/浅色主题

## 分发

- **npm 包** — 纯 TypeScript 核心，零依赖
- **Web 应用** — 在线使用
- **Chrome 扩展** — Manifest V3，支持背景脚本和独立页面

## 技术栈

- TypeScript + React 19 + Tailwind CSS 4
- pnpm monorepo + Turborepo
- Vite / WXT (Chrome Extension)

## 开发

```bash
pnpm install
pnpm dev
```

## License

MIT
