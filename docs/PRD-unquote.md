# PRD: Unquote

## 1. 概述

Unquote 是一个在本地检测并展开 JSON 中 stringified JSON 值的查看器。大模型返回内容、Agent 工具持久化记录和其他 JSONL 日志中，JSON 经常被二次编码为转义字符串，因而难以阅读、搜索和调试。Unquote 将这些值递归解析为可浏览的结构，并保留 JSONL 的逐条记录语义。

产品提供三个分发渠道：无需登录的 Web 应用、Chrome 扩展，以及通过 macOS 宿主应用分发的 Safari 扩展。所有解析、搜索和导出均在浏览器或扩展本地完成。

### 产品边界

- Unquote 的交互模型是单向地把 stringified JSON 呈现为结构化内容；用户可以展开或收起节点，但不会在 UI 中把节点还原为原始转义字符串。
- 输入内容不会被回写。复制和导出使用展开后的结构化结果。
- `@unquote/core` 仍保留 `restoreNode` 供仓库内程序化调用；这不是 Web 或扩展的产品功能。`@unquote/core` 是仓库内部包，不发布到 registry（见 `docs/core-distribution.md`）。

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
| C-3 | 判别式节点模型 | 节点以 `kind`、`preview`、`truncated` 等判别信息区分完整容器、Preview 容器、截断容器与 primitive；路径、深度和 Record 归属由遍历上下文提供。 |
| C-4 | JSONL 解析 | 按行生成带稳定 ID、行号、摘要和错误元数据的记录；单行错误不阻断其余记录。 |
| C-5 | 格式与导出基础 | 自动识别 JSON / JSONL，并将解析树物化为格式化 JSON 或 JSONL。 |
| C-6 | 原始形态恢复原语 | `restoreNode` 可供仓库内程序化调用；当前 UI 不暴露还原操作。 |

### 4.2 UI 组件（@unquote/ui）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| U-1 | Source 导入与替换 | 空状态和导入对话框支持粘贴、示例、拖拽和打开本地 `.json` / `.jsonl` 文件，并可手动覆盖格式识别；确认后的 Source 才进入工作区。 |
| U-2 | 结构化树视图 | 渲染解析树，提供语法高亮、节点路径、选中复制和错误详情。 |
| U-3 | Stringified 标识与展开 | 对已识别节点标识其来源，并支持逐节点展开或收起。 |
| U-4 | 批量展开与收起 | 对当前记录范围内的 stringified 节点执行 Expand All 或 Collapse All。 |
| U-5 | Record 导航 | Record rail 提供行号、摘要、洞察与解析状态，并定位当前可见 Record；工作区一次浏览一个选中 Record。 |
| U-6 | 搜索、路径跳转与筛选 | 在键和值中搜索，支持正则、大小写、JSONPath / jq 风格路径跳转及记录过滤。 |
| U-7 | 工具栏与命令面板 | 当前 Record tree 工具栏执行展开/收起；`Cmd/Ctrl+K` 命令面板执行搜索、路径跳转、搜索选项与 Record 筛选。 |
| U-8 | Agent session 视图 | 自动识别 Codex rollout 与 Claude Code JSONL，以会话信息、对话、工具调用、时间线和原始记录的关联视图呈现。 |
| U-9 | Agent 轨迹视图 | 将识别到的 Agent session 投影为按时间与 turn 组织的工作轨迹，提供指标、时间范围、类别和状态筛选、事件明细、告警及原始 Record 入口。 |
| U-10 | 复制与导出 | 复制或导出可见记录为 JSONL 或格式化 JSON；大数据复制会提示改用导出。 |
| U-11 | 文件概览与记录洞察 | 汇总成功/失败、嵌套路径和常见字段值，并识别日志、消息、事件、工具调用和错误记录。 |
| U-12 | 大文件浏览 | JSONL 支持流式导入、按需取得 Full Record、虚拟列表和分块导出，降低首屏、滚动和导出时的内存压力。 |

### 4.3 Web（@unquote/web）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| W-1 | 单页应用 | 打开即用，无需登录。 |
| W-2 | 本地文件打开 | 可打开本地 `.json` / `.jsonl` 文件。输入不写入 URL：页面只会清除历史遗留的 `#data=` hash，不再产生新的分享链接。 |
| W-3 | 偏好设置 | 支持浅色、深色和跟随系统主题，以及英文和简体中文。 |

### 4.4 浏览器扩展（@unquote/extension）

| 编号 | 功能 | 描述 |
| ---- | ---- | ---- |
| E-1 | 独立页面 | 点击扩展图标在独立标签页中打开完整 Unquote 体验。 |
| E-2 | 右键菜单 | 选中文本后通过 “Open in Unquote” 将内容交给扩展页面查看。 |
| E-3 | 快捷键 | 支持 `Ctrl+Shift+U` / `Cmd+Shift+U` 打开扩展页面。 |
| E-4 | Safari 分发 | 同一套扩展通过 `apps/safari` 的 macOS 宿主应用分发到 Safari，尚未上架 App Store；Safari 不支持 `clipboardRead`，剪贴板读取会自行降级。 |

## 5. 界面布局

### 5.1 Source 导入

没有当前 Source 时，主区域显示居中的导入面板。用户可粘贴文本、拖入或选择文件、载入示例，并在
auto / JSON / JSONL 中选择解析模式。导入内容是待确认的 Source Candidate；确认后才会原子替换
当前 Source 与解析模式。Source 加载后不保留常驻输入编辑区，后续替换通过 header 打开同一导入
流程。

### 5.2 JSON workspace

JSON 与 JSONL 共用 Record workspace；JSON Source 也以一个 Record 呈现。桌面布局由 Record rail、
当前 Record tree 与 Node inspector 三栏组成，filter bar 位于三栏上方：

```
┌──────────────────────────────── App header ────────────────────────────────┐
├──────────────────────────────── Record filters ────────────────────────────┤
├──────────────────┬───────────────────────────────┬─────────────────────────┤
│   Record rail    │     Selected Record tree      │     Node inspector      │
│ line / summary   │ breadcrumb / expand-collapse │ value / path / actions  │
│ insight / state  │ search and path target        │                         │
├──────────────────┴───────────────────────────────┴─────────────────────────┤
│                                Status bar                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Record rail 只负责导航，不同时渲染多张 Record card。搜索、筛选和路径跳转会同步选择目标 Record，
并在 tree 中定位对应 JSON Node；本地大文件的目标若仍是 Preview Record，会先请求对应 Full Record。
窄屏下 rail、tree 与 inspector 垂直排列，inspector 收入底部 disclosure。

### 5.3 Agent 与 Trajectory outputs

识别到 Agent Session 时，header 提供 Agent / Trajectory / JSON output 切换。每个 Source Revision
首次识别成功时默认进入 Agent output；流式记录继续到达时保留用户已经选择的 output。Agent output
仍保留返回 canonical Record 的入口。Agent 桌面布局为 timeline、conversation 与 session facts 三栏，
窄屏使用与 JSON workspace 相同的堆叠策略。

```
┌────────────────────┬───────────────────────────────┬──────────────────────┐
│ Agent timeline     │ Conversation                  │ Session facts        │
│ event / turn       │ message / reasoning / tools   │ metadata / metrics   │
└────────────────────┴───────────────────────────────┴──────────────────────┘
```

Trajectory output 将同一 Agent session 投影为带时间范围的工作轨迹。桌面布局由中心工作区和 detail
两栏组成：中心工作区包含 session 指标、搜索与类别/状态筛选、时间轴 overview，以及按 turn 分组的
虚拟化 ledger；detail 展示选中事件的事实、告警、受限长度的原始 Record JSON 和返回 Record 的入口。
窄屏下中心内容垂直滚动，detail 收入底部 disclosure。

```
┌────────────────────────────────────────────┬─────────────────────────────┐
│ Metrics / filters / time overview          │ Trajectory detail           │
│ Turn-grouped event ledger                  │ facts / warnings / Records  │
└────────────────────────────────────────────┴─────────────────────────────┘
```

App header 始终承载 Source 替换、搜索、output 切换、偏好与复制/导出操作；解析、搜索、文件和错误状态
由底部 status bar 汇总。

## 6. 非功能需求

| 编号 | 类别 | 要求 |
| ---- | ---- | ---- |
| N-1 | 本地性 | 输入、解析、搜索、复制和导出均在浏览器或扩展本地处理，不向服务端发送用户数据。 |
| N-2 | 响应性 | 预算内的初始 Source 可同步完成以避免结果闪烁；其余解析与搜索通过 Web Worker 执行。没有 Worker 时只在主线程预算内回退，过大 Source 明确拒绝同步工作。 |
| N-3 | 大文件 | JSONL 使用流式发布、记录虚拟化和按需取得 Full Record，避免为浏览少量记录而常驻完整树。 |
| N-4 | 导出 | 大型导出分块生成并向主线程让步，避免长时间阻塞页面。 |
| N-5 | 兼容 | Web 面向现代浏览器；Chrome 扩展使用 Manifest V3。 |

## 7. 技术架构

### 7.1 Monorepo 结构

```
unquote/
├── apps/
│   ├── web/          # Vite + React Web 应用
│   ├── extension/    # WXT + React 浏览器扩展（MV3）
│   └── safari/       # 把同一扩展分发到 Safari 的 macOS 宿主应用
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
safari ──→ extension 的构建产物
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

Core 将输入解析为判别式节点与 Record；UI 在遍历上下文中计算路径和深度，并负责显示、查询、虚拟化与本地文件的按需 Full Record 读取。Web 仅增加文件选择等网页入口能力。

扩展由 WXT 管理 MV3 manifest、background 与 options 页面；options 页面复用 `UnquoteApp`。选中文本通过扩展存储交接给页面，避免把内容编码进 URL 或泄漏给网页上下文。

## 8. 产品状态与决策

### 已交付

- JSON / JSONL 的递归解析、树形浏览、记录导航和错误隔离。
- Web Worker 解析、流式 JSONL、大记录虚拟化、按需取得 Full Record 和分块导出。
- 顶部搜索执行文本搜索与上一个/下一个匹配导航；命令面板执行搜索、正则和大小写选项、JSONPath / jq 风格路径跳转与记录过滤。
- Codex rollout 和 Claude Code JSONL 的 session 识别与专用浏览视图。
- Agent session 的时间轨迹、turn ledger、指标、时间范围与类别/状态筛选、事件明细及原始 Record 入口。
- 主题与语言偏好，以及浏览器扩展的独立页面、右键菜单和快捷键。

### 已否决

- URL hash 分享：不再把输入编码进 URL。会话内容留在设备上，链接也无法承载真实体量的日志；Web 只保留清除历史遗留 `#data=` hash 的行为。
- UI restore：不再提供 Restore All、单条 restore 或任何将结构化结果重新显示为原始转义字符串的操作。该能力会和 Collapse All 重复，并使显示与复制/导出的结果产生不必要的双重语义。

### 未承诺方向

以下仅是可在明确用户需求和成本后评估的候选，不构成产品路线承诺：更专业的文本编辑体验、JSON Schema 校验，以及 JSON Diff。

## 9. 价值定位

Unquote 的差异不在于替代通用 JSON formatter，而在于把难读的嵌套字符串和逐行 Agent 记录变为可探索的本地结构：递归 stringified JSON 展开、JSONL 原生导航，以及对已识别 Agent session 的上下文与轨迹视图，同时覆盖 Web、Chrome 扩展与 Safari 扩展。

### 记录表格

顶部记录表格入口支持对当前 Source 的全部记录选列、筛选、分页和 CSV 导出。JSONL 每行对应一行，JSON 整体对应一行；此版本不将对象数组拆成表格行。选中节点路径作为初始列，可添加最多 12 个明确路径。每列支持任意值、等于、文本包含、数字比较和字段缺失，条件之间为 AND。数字比较保留精度，读取完整记录后再判断条件，无效 JSON 行单独计数。行号可返回原始记录。CSV 使用完整值，公式样式字符串添加单引号前缀，缺失值和空字符串都输出空单元格。

### 字段体检

记录表格每次扫描同时统计所选列在全部有效源记录中的出现率、缺失、null、空字符串和类型分布。统计在过滤前累积且不抽样，无效 JSON 行不计入字段出现率的分母。空字符串也计入 string 类型。点击计数替换所有现有筛选条件，并重新扫描对应记录。此版本不自动判定类型差异为错误，不推断 Schema 或扫描未选字段。
