<div align="center">
  <img src="logo.svg" width="120" alt="Unquote Logo">
</div>

<h1 align="center">Unquote</h1>

检测并展开 JSON 中的字符串化（stringified）值，专为处理 AI 模型输出和 MCP/Agent 工具调用中的嵌套 JSON 设计。

## 功能

- 自动检测 JSON / JSONL，并递归展开字符串化的 JSON 值
- 交互式树视图，支持展开/折叠、语法高亮、路径显示和一键复制
- JSONL 记录导航、搜索、过滤、JSONPath / jq 风格路径跳转
- 统一命令工具栏和 `Cmd/Ctrl+K` 命令面板，集中执行搜索、路径跳转、展开/收起和记录过滤
- 大型 JSONL 流式导入，针对高记录数文件优化首条记录可见时间、滚动性能和 UI 内存占用
- 大型本地 JSONL 按需水合完整记录，并对导出进行分块处理，避免大文件操作卡住页面
- 文件概览：成功/失败统计、嵌套路径、常见 event/type/tool 值和错误预览
- 记录洞察：识别日志、消息、事件、工具调用和错误记录
- Path Inspector：聚焦子树，复制子树、原始值、转义字符串和调试包
- 可见记录复制/导出为 JSONL 或格式化 JSON，大文件导出带进度反馈
- 解析在浏览器或扩展本地完成
- 深色/浅色/跟随系统主题，支持英文和简体中文

## 分发

- **npm 包** — 纯 TypeScript 核心，零依赖
- **Web 应用** — [unquote.xingkaixin.me](https://unquote.xingkaixin.me/)
- **Chrome 扩展** — [Chrome Web Store](https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg)，Manifest V3，支持右键菜单和独立页面

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

## Performance

Release performance gates are documented in [docs/performance.md](docs/performance.md).
