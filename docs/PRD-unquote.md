# PRD: Unquote

## 1. 概述

Unquote 是一个用于检测并展开 JSON 中 stringified JSON 值的格式化工具。大模型返回内容、Agent 工具持久化存储的 JSONL 中，JSON 值经常以转义字符串形式存在，导致阅读和调试困难。Unquote 递归检测这些 stringified JSON 并提供可交互的展开、折叠、还原操作。同时原生支持 JSONL，提供带目录导航的多记录浏览体验。

产品形态为 monorepo，包含三个分发渠道：npm 包（core 逻辑）、Web 站点、Chrome Extension。

## 2. 目标用户

- 使用大模型 API 的开发者，需要阅读模型返回的嵌套 JSON 响应
- Agent / MCP 工具链的开发者，需要检查 agent session dump、tool call 记录中的 JSONL
- 日常需要格式化 JSON 的技术人员

## 3. 核心问题

### 3.1 Stringified JSON

JSON 值中嵌套的 stringified JSON 是一个普遍痛点：

```json
{
  "payload": "{\"user\":{\"id\":42,\"name\":\"Lyric\"},\"action\":\"login\"}"
}
```

现有 JSON formatter 工具（如 jq、各类在线工具）将这类值视为普通字符串，不做进一步解析。用户需要手动复制字符串值、去除转义、再次格式化，遇到多层嵌套时操作极其繁琐。

### 3.2 JSONL 浏览

Agent session dump、日志文件等通常以 JSONL 格式存储，一个文件包含几十到上千条 JSON 记录。现有工具不支持 JSONL 的结构化浏览，用户只能逐行复制粘贴到 formatter 中查看，无法快速定位和跳转。

## 4. 功能需求

### 4.1 Core（@unquote/core）

| 编号 | 功能                  | 描述                                                                                                                   |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C-1  | Stringified JSON 检测 | 遍历 JSON 对象所有 string 类型值，尝试 `JSON.parse`，判断是否为 stringified JSON                                       |
| C-2  | 递归展开              | 对检测到的 stringified JSON 递归解析，支持多层嵌套（默认最大深度 10）                                                  |
| C-3  | 带标注的 AST          | 解析结果以树形结构返回，每个节点标记 `wasStringified`（是否来源于 string 解析）及 `rawString`（原始字符串）            |
| C-4  | 选择性还原            | 支持将指定路径的节点重新 stringify 为原始形态                                                                          |
| C-5  | JSONL 解析            | 按行分割输入，逐行解析为 JsonNode 数组，每条记录附带行号和摘要信息                                                     |
| C-6  | 记录摘要提取          | 从每条 JSONL 记录的第一层字段中提取摘要（优先取 `timestamp`、`type`、`action`、`event`、`name`、`message` 等常见字段） |
| C-7  | 格式化输出            | 将处理后的 JSON 输出为格式化字符串，支持自定义缩进                                                                     |
| C-8  | 格式自动检测          | 根据输入内容自动判断 JSON 或 JSONL 格式                                                                                |
| C-9  | 错误容忍              | 输入不合法时返回具体的错误位置和原因，JSONL 逐行报告成功/失败                                                          |

### 4.2 UI 组件（@unquote/ui）

| 编号 | 功能             | 描述                                                                   |
| ---- | ---------------- | ---------------------------------------------------------------------- |
| U-1  | JSON 输入区      | 文本编辑器，支持粘贴、拖拽文件、清空操作                               |
| U-2  | 树形输出区       | 交互式树形视图，渲染 core 返回的 AST                                   |
| U-3  | Stringified 标签 | stringified JSON 节点显示黄色 "stringified JSON" 标签，点击可展开/折叠 |
| U-4  | 一键展开全部     | 全局按钮，调用 core 的递归展开，将所有 stringified JSON 就地展开       |
| U-5  | 一键还原全部     | 全局按钮，将所有已展开节点恢复为原始 string 形态                       |
| U-6  | 复制操作         | 支持复制整体结果、复制单个节点值、复制 JSON Path                       |
| U-7  | 语法高亮         | key、string、number、boolean、null 分色显示                            |
| U-8  | 错误提示         | 输入不合法时，在输入区标注错误位置，输出区显示错误信息                 |
| U-9  | JSONL TOC 面板   | JSONL 模式下显示左侧目录面板，列出所有记录，每条显示行号 + 摘要文本    |
| U-10 | TOC 跳转         | 点击 TOC 条目，输出区滚动到对应记录                                    |
| U-11 | TOC 跟随高亮     | 滚动输出区时，TOC 自动高亮当前可见的记录                               |
| U-12 | 记录级操作       | JSONL 模式下每条记录可独立展开/折叠 stringified JSON、复制单条记录     |
| U-13 | JSONL 统计栏     | 显示总记录数、解析成功数、解析失败数                                   |
| U-14 | 路径显示         | 鼠标悬停节点时显示 JSON Path（如 `$.payload.user.name`）               |
| U-15 | 格式切换         | 手动切换 JSON / JSONL 模式（通常由自动检测处理，手动切换作为覆盖）     |

### 4.3 Web（@unquote/web）

| 编号 | 功能          | 描述                                                          |
| ---- | ------------- | ------------------------------------------------------------- |
| W-1  | SPA 页面      | 单页应用，加载即可使用，无需登录                              |
| W-2  | 本地文件打开  | 支持通过文件选择器打开本地 .json / .jsonl 文件                |
| W-3  | 深色/浅色主题 | 跟随系统 prefers-color-scheme，支持手动切换                   |
| W-4  | URL 分享      | 支持将输入内容编码到 URL hash，打开链接即可复现（小体积数据） |

### 4.4 Chrome Extension（@unquote/extension）

| 编号 | 功能             | 描述                                                                                                                           |
| ---- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| E-1  | 图标点击打开 Tab | 点击 Extension 图标，`chrome.tabs.create` 打开完整页面，功能与 Web 版一致                                                      |
| E-2  | 右键菜单         | 选中页面文本后右键 "Open in Unquote"，自动将选中内容填入输入区                                                                 |
| E-3  | 页面 JSON 检测   | Content Script 检测页面中的 `<pre>` / `<code>` 块，如果内容为 JSON，在元素旁显示 "Unquote" 按钮，点击后在新 Tab 打开并填入内容 |
| E-4  | 快捷键           | 支持自定义快捷键打开 Extension 页面                                                                                            |

## 5. 界面布局

### 5.1 单条 JSON 模式

两栏布局：

```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    Input Editor      │    Tree Output       │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

### 5.2 JSONL 模式

三栏布局，左侧 TOC 常驻：

```
┌────────┬─────────────────┬──────────────────┐
│  TOC   │                 │                  │
│        │  Input Editor   │  Tree Output     │
│ #1 ◉   │                 │  ┌─ Record #1 ─┐│
│ #2     │                 │  │  ...         ││
│ #3     │                 │  └─────────────┘│
│ #4     │                 │  ┌─ Record #2 ─┐│
│ ...    │                 │  │  ...         ││
│        │                 │  └─────────────┘│
│ Stats: │                 │                  │
│ 42 ok  │                 │                  │
│ 1 err  │                 │                  │
└────────┴─────────────────┴──────────────────┘
```

TOC 每条记录显示：行号、摘要（从记录中提取的关键字段值）、解析状态（成功/失败图标）。

## 6. 非功能需求

| 编号 | 类别 | 要求                                                 |
| ---- | ---- | ---------------------------------------------------- |
| N-1  | 性能 | 10MB 以下 JSON 文件在 3 秒内完成解析和首屏渲染       |
| N-2  | 性能 | 大文件解析在 Web Worker 中执行，不阻塞主线程         |
| N-3  | 性能 | 树形视图使用虚拟滚动，仅渲染可视区域节点             |
| N-4  | 安全 | 所有处理在客户端本地完成，不向任何服务器发送用户数据 |
| N-5  | 体积 | Extension 打包体积 < 500KB（gzip）                   |
| N-6  | 兼容 | Web 支持 Chrome / Firefox / Safari 最新两个版本      |
| N-7  | 兼容 | Extension 支持 Chrome Manifest V3                    |

## 7. 技术架构

### 7.1 Monorepo 结构

```
unquote/
├── packages/
│   ├── core/          # 纯 TypeScript，零依赖
│   ├── ui/            # React 组件库
│   ├── web/           # Vite SPA
│   └── extension/     # Chrome Extension (Manifest V3)
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### 7.2 依赖关系

```
web ──→ ui ──→ core
extension ──→ ui ──→ core
```

### 7.3 技术选型

| 层        | 选型                       | 理由                                                       |
| --------- | -------------------------- | ---------------------------------------------------------- |
| Monorepo  | pnpm workspace + turborepo | 依赖管理干净，构建缓存和任务编排                           |
| Core      | TypeScript + tsup          | 纯逻辑包，输出 ESM + CJS                                   |
| UI        | React + Tailwind CSS       | 组件复用于 Web 和 Extension                                |
| Web       | Vite                       | 开发体验和构建速度                                         |
| Extension | Vite 多入口                | background service worker + full page 入口，不引入额外框架 |
| 测试      | Vitest                     | 与 Vite 生态一致                                           |

### 7.4 Core 数据结构

```typescript
interface JsonNode {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  value: unknown;
  wasStringified: boolean;
  rawString?: string;
  path: string[];
  children?: Record<string, JsonNode> | JsonNode[];
}

interface JsonlRecord {
  lineNumber: number;
  node: JsonNode | null; // null 表示该行解析失败
  error?: string; // 解析失败时的错误信息
  summary: string; // 从记录中提取的摘要文本
}

interface ParseResult {
  format: "json" | "jsonl";
  records: JsonlRecord[]; // JSON 模式下长度为 1
  stats: {
    total: number;
    success: number;
    failed: number;
  };
}
```

### 7.5 Extension 架构

```
extension/
├── src/
│   ├── background.ts       # Service Worker，监听 icon click / 右键菜单
│   ├── content.ts          # Content Script，页面 JSON 检测
│   ├── pages/
│   │   └── main/           # Full page 入口，引用 @unquote/ui
│   └── manifest.json
```

权限需求：`activeTab`、`contextMenus`。不需要 `<all_urls>`，Content Script 按需注入。

## 8. 分期计划

### P0（MVP）

- Core：C-1 ~ C-9（全部）
- UI：U-1 ~ U-13
- Web：W-1, W-2, W-3
- Extension：E-1

交付物：可用的 Web 站点 + Chrome Extension，覆盖 stringified JSON 检测展开 + JSONL TOC 浏览的完整核心体验。

### P1

- UI：U-14（路径显示）, U-15（手动格式切换）
- Web：W-4（URL 分享）
- Extension：E-2（右键菜单）, E-3（页面 JSON 检测）, E-4（快捷键）

交付物：Extension 完整交互能力，细节体验补齐。

### P2（按需）

- 大文件优化：N-2 Web Worker, N-3 虚拟滚动
- Monaco Editor 替代 textarea
- JSON Schema 校验
- JSON Diff（对比两个 JSON）
- jq 表达式过滤
- JSONL 记录过滤/搜索

## 9. 竞品参考

| 工具                           | Stringified JSON 处理     | JSONL 支持     | 形态      |
| ------------------------------ | ------------------------- | -------------- | --------- |
| quaily.com/tools/jsonformatter | 支持检测和展开，带标签 UI | 不支持         | Web       |
| jsonformatter.org              | 不支持                    | 不支持         | Web       |
| JSON Viewer (Chrome Extension) | 不支持                    | 不支持         | Extension |
| jq                             | 不支持（需要手动 pipe）   | 支持但无可视化 | CLI       |

Unquote 的核心差异点：递归 stringified JSON 检测与交互式展开/还原 + JSONL 原生 TOC 浏览体验，同时覆盖 Web + Extension + npm 包三种分发渠道。
