# PRD: Unquote

## 1. 概述

Unquote 是一个在本地检测并展开 JSON 中 stringified JSON 值的查看器。大模型返回内容、Agent 工具持久化记录和其他 JSONL 日志中，JSON 经常被二次编码为转义字符串，因而难以阅读、搜索和调试。Unquote 将这些值递归解析为可浏览的结构，并保留 JSONL 的逐条记录语义。

产品提供三个分发渠道：供程序使用的 core 库、无需登录的 Web 应用，以及 Chrome 扩展。所有解析、搜索和导出均在浏览器或扩展本地完成。

### 产品边界

- Unquote 的交互模型是单向地把 stringified JSON 呈现为结构化内容；用户可以展开或收起节点，但不会在 UI 中把节点还原为原始转义字符串。
- 输入内容不会被回写。复制和导出使用展开后的结构化结果。
- `@unquote/core` 仍保留 `restoreNode` 供库消费者按需使用；这不是 Web 或扩展的产品功能。

## 2. 目标用户

- 使用大模型 API 的开发者，需要阅读嵌套的 JSON 响应。
- Agent / MCP 工具链的开发者，需要检查 Codex、Claude Code 等 session dump、tool call 记录和 JSONL 日志。
- 日常需要在本地格式化、检索或导出 JSON / JSONL 的技术人员。

## 3. 核心问题

### 3.1 Stringified JSON

JSON 值中嵌套的 stringified JSON 是一个普遍痛点：

```json
{
  "payload": "{\"user\":{\"id\":42,\"name\":\"Lyric\"},\"action\":\"login\"}"
}
```

常规 JSON formatter 会将 `payload` 视为普通字符串。用户需要手动复制、去除转义并再次格式化；多层嵌套时，这个过程既慢又容易出错。

### 3.2 JSONL 与 Agent 记录

Agent session dump 和日志通常以 JSONL 存储，一个文件可包含几十到数十万条记录。逐行查看会丢失记录之间的时间线和上下文，也难以定位字段、错误或特定事件。用户需要能在不上传数据的前提下，导航、搜索、筛选和按会话语义阅读这些记录。

## 4. 当前能力

### 4.1 Core（@unquote/core）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| C-1 | Stringified JSON 检测 | 遍历 JSON 的 string 值并尝试 `JSON.parse`，识别可展开的 stringified JSON。 |
| C-2 | 递归展开 | 递归解析嵌套值，并以最大深度保护避免无限展开。 |
| C-3 | 带标注的树 | 节点包含 `kind`、路径、`wasStringified` 和展开性等元数据，使 UI 和库消费者可以按结构处理。 |
| C-4 | JSONL 解析 | 按行生成带稳定 ID、行号、摘要和错误元数据的记录；单行错误不阻断其余记录。 |
| C-5 | 格式与导出基础 | 自动识别 JSON / JSONL，并将解析树物化为格式化 JSON 或 JSONL。 |
| C-6 | 库级原始形态恢复 | `restoreNode` 可供程序化调用；当前 UI 不暴露还原操作。 |

### 4.2 UI 组件（@unquote/ui）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| U-1 | 输入与文件打开 | 支持粘贴、示例、拖拽和打开本地 `.json` / `.jsonl` 文件，并可手动覆盖格式识别。 |
| U-2 | 结构化树视图 | 渲染解析树，提供语法高亮、节点路径、选中复制和错误详情。 |
| U-3 | Stringified 标识与展开 | 对已识别节点标识其来源，并支持逐节点展开或收起。 |
| U-4 | 批量展开与收起 | 对当前记录范围内的 stringified 节点执行 Expand All 或 Collapse All。 |
| U-5 | JSONL 导航 | 提供记录目录、可见记录定位、记录级展开控制与成功/失败统计。 |
| U-6 | 搜索、路径跳转与筛选 | 在键和值中搜索，支持正则、大小写、JSONPath / jq 风格路径跳转及记录过滤。 |
| U-7 | 命令工具栏 | 在工具栏和 `Cmd/Ctrl+K` 命令面板集中执行搜索、路径跳转、展开/收起与筛选。 |
| U-8 | Agent session 视图 | 自动识别 Codex rollout 与 Claude Code JSONL，以会话信息、对话、工具调用、时间线和原始记录的关联视图呈现。 |
| U-9 | 复制与导出 | 复制或导出可见记录为 JSONL 或格式化 JSON；大数据复制会提示改用导出。 |
| U-10 | 文件概览与记录洞察 | 汇总成功/失败、嵌套路径和常见字段值，并识别日志、消息、事件、工具调用和错误记录。 |
| U-11 | 大文件浏览 | JSONL 支持流式导入、按需水合完整记录、虚拟列表和分块导出，降低首屏、滚动和导出时的内存压力。 |

### 4.3 Web（@unquote/web）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| W-1 | 单页应用 | 打开即用，无需登录。 |
| W-2 | 本地文件与链接分享 | 可打开本地 `.json` / `.jsonl`，并以 URL hash 分享小体积输入。 |
| W-3 | 偏好设置 | 支持浅色、深色和跟随系统主题，以及英文和简体中文。 |

### 4.4 Chrome Extension（@unquote/extension）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| E-1 | 独立页面 | 点击扩展图标在独立标签页中打开完整 Unquote 体验。 |
| E-2 | 右键菜单 | 选中文本后通过 “Open in Unquote” 将内容交给扩展页面查看。 |
| E-3 | 快捷键 | 支持 `Ctrl+Shift+U` / `Cmd+Shift+U` 打开扩展页面。 |

## 5. 界面布局

### 5.1 JSON 模式

输入与结构化结果并排显示；工具栏承载搜索、路径跳转、批量展开/收起及复制/导出操作。

```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    Input Editor      │    Tree Output       │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

### 5.2 JSONL 模式

记录目录、输入区和结果区并列。结果区可以在普通 JSON 树和识别出的 Agent session 视图之间切换。

```
┌────────┬─────────────────┬──────────────────┐
│  TOC   │                 │ JSON / Agent     │
│        │  Input Editor   │ ┌─ Record #1 ─┐  │
│ #1 ◉   │                 │ │  ...         │  │
│ #2     │                 │ └─────────────┘  │
│ #3     │                 │ ┌─ Record #2 ─┐  │
│ ...    │                 │ │  ...         │  │
│ Stats  │                 │ └─────────────┘  │
└────────┴─────────────────┴──────────────────┘
```

TOC 显示行号、摘要和解析状态；搜索和路径跳转会将目标记录带入视图，必要时先水合该记录。

## 6. 非功能需求

| 编号 | 类别 | 要求 |
| ---- | ---- | ---- |
| N-1 | 本地性 | 输入、解析、搜索、复制和导出均在浏览器或扩展本地处理，不向服务端发送用户数据。 |
| N-2 | 响应性 | 解析与搜索通过 Web Worker 执行；没有 Worker 的环境可回退到主线程。 |
| N-3 | 大文件 | JSONL 使用流式发布、记录虚拟化和按需水合，避免为浏览少量记录而常驻完整树。 |
| N-4 | 导出 | 大型导出分块生成并向主线程让步，避免长时间阻塞页面。 |
| N-5 | 兼容 | Web 面向现代浏览器；Chrome 扩展使用 Manifest V3。 |

## 7. 技术架构

### 7.1 Monorepo 结构

```
unquote/
├── apps/
│   ├── web/          # Vite + React Web 应用
│   └── extension/    # WXT + React Chrome Extension（MV3）
├── packages/
│   ├── core/         # 无框架依赖的 TypeScript 解析库
│   └── ui/           # 共享的 React UI 与应用逻辑
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

`apps` 负责分发渠道，`packages` 负责可复用能力；应用依赖方向保持单向，避免平台细节渗入解析层。

```
web ──→ ui ──→ core
extension ──→ ui ──→ core
```

### 7.2 技术选型

| 层 | 选型 | 理由 |
| --- | ---- | ---- |
| Monorepo | pnpm workspace + Turborepo | 管理共享包、构建缓存和任务编排。 |
| Core | TypeScript + tsup | 保持解析逻辑可独立使用，并输出 ESM 与 CJS。 |
| UI | React + Tailwind CSS | 让 Web 与扩展共享一致的交互和设计系统。 |
| Web | Vite | 提供 Web 应用的开发与构建能力。 |
| Extension | WXT | 生成和管理 Manifest V3，组织 background 与 options 页面入口。 |
| 测试 | Vitest | 覆盖 core、UI、Web 和扩展的单元及交互测试。 |

### 7.3 数据与扩展边界

Core 将输入解析为以路径和元数据标注的树；UI 负责显示、查询、虚拟化和本地文件的延迟读取。Web 仅增加 URL hash 和文件选择等网页入口能力。

扩展由 WXT 管理 MV3 manifest、background 与 options 页面；options 页面复用 `UnquoteApp`。选中文本通过扩展存储交接给页面，避免把内容编码进 URL 或泄漏给网页上下文。

## 8. 产品状态与决策

### 已交付

- JSON / JSONL 的递归解析、树形浏览、记录导航和错误隔离。
- Web Worker 解析、流式 JSONL、大记录虚拟化、按需水合和分块导出。
- 搜索、正则和大小写选项、JSONPath / jq 风格路径跳转、记录过滤及命令面板。
- Codex rollout 和 Claude Code JSONL 的 session 识别与专用浏览视图。
- URL 分享、主题与语言偏好、Chrome 扩展的独立页面、右键菜单和快捷键。

### 已否决

- UI restore：不再提供 Restore All、单条 restore 或任何将结构化结果重新显示为原始转义字符串的操作。该能力会和 Collapse All 重复，并使显示与复制/导出的结果产生不必要的双重语义。

### 未承诺方向

以下仅是可在明确用户需求和成本后评估的候选，不构成产品路线承诺：更专业的文本编辑体验、JSON Schema 校验，以及 JSON Diff。

## 9. 价值定位

Unquote 的差异不在于替代通用 JSON formatter，而在于把难读的嵌套字符串和逐行 Agent 记录变为可探索的本地结构：递归 stringified JSON 展开、JSONL 原生导航，以及对已识别 Agent session 的上下文视图，同时覆盖 Web、Chrome Extension 和可复用 core 库。
