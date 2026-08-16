<div align="center">
  <img src="logo.svg" width="120" alt="Unquote Logo">
</div>

<h1 align="center">Unquote</h1>

检测并展开 JSON 中的字符串化（stringified）值，专为处理 AI 模型输出和 MCP/Agent 工具调用中的嵌套 JSON 设计。

## 功能

- 自动检测 JSON / JSONL，并递归展开字符串化的 JSON 值
- 专用导入流程，支持粘贴、拖入、选择文件、样例输入、实时格式提示及 JSON / JSONL 显式模式
- 三栏 JSON 工作区：虚拟化记录导航、单条记录树和选中节点检查器，支持值/路径复制及一键展开嵌套 JSON
- JSONL 记录分类、搜索、过滤，以及 JSONPath / jq 风格路径跳转
- Agent 会话工作区：自动识别 Codex / Claude Code JSONL，按时间线、对话和会话概况查看，并可展开工具调用/结果或返回原始记录
- Agent 轨迹视图：把会话投影到时间轴上，按回合组织事件并给出状态、时长、工具与失败统计和 token 用量；支持时间区间缩放、按类别/状态过滤、内联查看原始 Record JSON
- 顶部搜索执行文本搜索与上一个/下一个匹配导航；`Cmd/Ctrl+K` 命令面板执行搜索、路径跳转、搜索选项与记录过滤
- 大型 JSONL 流式导入，仅渲染选中的记录树并虚拟化记录导航，降低高记录数文件的 DOM 与 UI 内存占用
- 大型本地 JSONL 按需水合完整记录，并对导出进行分块处理，避免大文件操作卡住页面
- 记录洞察会在导航中识别日志、消息、事件、工具调用和错误记录
- 可见记录复制/导出为 JSONL 或格式化 JSON，大文件导出带进度反馈
- 解析在浏览器或扩展本地完成
- 深色/浅色/跟随系统主题，支持英文和简体中文

## 分发

- **Web 应用** — [unquote.xingkaixin.me](https://unquote.xingkaixin.me/)
- **Chrome 扩展** — [Chrome Web Store](https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg)，Manifest V3，支持右键菜单和独立页面
- **Edge 扩展** — [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/amdbhljchamjbhknbamkcemccmelegdp)，与 Chrome 扩展共享 Manifest V3 代码
- **Safari 扩展** — 尚未上架，宿主 app 的 Xcode 项目见 `apps/safari`，用 `pnpm build:safari` 构建扩展产物

## 技术栈

- TypeScript + React 19 + Tailwind CSS 4
- pnpm monorepo + Turborepo
- Vite / WXT (Chrome Extension) + Xcode (Safari Extension)

## 开发

需要 Node.js 24 和 pnpm 11.20.0。仓库通过 `.node-version` 固定 Node 主版本，pnpm 版本由 `packageManager` 固定。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

提交前运行与 CI 相同的生产质量门：

```bash
pnpm check
```

该命令依次检查格式、类型、lint、测试，并构建 Web 应用与 Chrome 扩展的生产产物。

`pnpm install` 会自动接入 `.githooks/pre-commit`，仅对本次暂存的 TS/TSX/CSS/JSON 文件做 oxfmt/oxlint 检查和一次 `pnpm typecheck`，作为提交前的轻量门禁（`git commit --no-verify` 可跳过）。

## License

MIT

## Performance

Release performance gates are documented in [docs/performance.md](docs/performance.md).
