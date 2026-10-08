# Unquote 架构

本文记录模块划分、依赖方向、数据流和各模块的设计原则，用于在迭代中保持边界不变。产品目标与
非目标见 `docs/product.md`，领域术语见 `CONTEXT.md`，跨切面不变量见根目录 `AGENTS.md`。

本文只描述到模块级别。文件级职责写在各包的 `AGENTS.md` 中，数值预算写在
`docs/performance.md` 中，本文不重复。

## 分层与依赖方向

```text
apps/web ───────┐
                ├──→ packages/ui ──→ packages/core
apps/extension ─┘
apps/safari ──→ apps/extension 的 Safari 构建产物
```

- `packages/core`：无框架的 TypeScript 解析库。不依赖 React、DOM 或任何 UI 行为。
- `packages/ui`：共享的 React 应用 `UnquoteApp`、领域 hook、Worker 和设计系统。它不感知分发
  渠道；渠道差异只通过 `UnquoteAppProps` 传入（初始输入、欢迎页、商店链接、更新日志链接）。
- `apps/*`：分发渠道，只负责入口和平台能力。依赖方向保持单向，平台细节不进入 `packages`。

## 数据流

```text
Source Candidate ──确认──→ Source + Source Revision
                                │
                       解析与摄取（Worker 优先）
                                │
                Record（Full / Preview / Failed）
                 │               │               │
         JSON workspace    Agent Session ──→ Agent Trajectory
                 │
        查询 · 复制/导出 · 本地分析工具
                 │
     Local-file Source Access（Preview → Full、搜索、缓存）
```

导入流程中的内容是 Source Candidate，确认后才原子发布为新的 Source Revision。之后的所有
解析、搜索和视图结果都属于产生它的 Revision。JSONL 每行只解析一次，同一次摄取同时产出
Record 和 Agent 检测证据，各视图共享同一个 Record id。

## 模块与设计原则

### Core 解析（`packages/core`）

负责 JSON / JSONL 检测、Stringified JSON 递归展开、节点模型和序列化。

- 节点只保存 JSON 事实。路径、深度和 Record 归属属于遍历上下文。
- 数字保留源字面量。无法无损往返的数字不能被静默近似。
- 达到深度预算的容器保留原值，物化和格式化不能丢失内容。
- 单行错误只影响该 Record，保留位置和诊断信息。

细节见 `packages/core/AGENTS.md`；分发决策见 `docs/core-distribution.md`。

### Source 与 Revision（`packages/ui`）

负责 Source 发布、Revision 生命周期和过期结果拒绝。

- Revision 不可变且单调递增。回到旧内容会发布新 Revision，不复用旧 Revision。
- 每个异步结果携带产生它的 Revision。旧 Revision 不能覆盖新 Revision 已拥有的状态。
- Revision 检查集中在专门模块中，功能模块不自行实现。

细节见 `docs/source-revision.md`。

### 解析与摄取

负责在 Worker 中解析、流式发布 Record，以及无 Worker 时的主线程回退。

- 解析和搜索默认在 Worker 中执行。主线程只在预算内同步工作，超出预算明确拒绝。
- 流式结果以追加方式发布，不随批次数量重复复制或全量重算。
- JSONL 摄取是唯一的逐行解析入口。其他视图复用其结果，不再次解析同一行。

### 本地文件访问（Local-file Source Access）

负责大文件的读取、搜索，以及把 Preview Record 解析为 Full Record。

- 调用方只表达意图（取得某个 Full Record、搜索、导出），不感知逐行扫描、checkpoint 或缓存。
- 浏览、复制或导出超出 Preview 范围的数据前，先取得 Full Record。
- 缓存有界，淘汰策略集中在一个模块中。所有长任务可取消，被取代的结果不得发布。

### 查询

负责文本、正则和 jq 风格路径搜索，匹配导航与 Record 过滤。

- 结果携带 Record id、路径、匹配范围和 Stringified JSON 祖先路径，可直接定位到节点。
- 正则与 jq 模式互斥。

### Record workspace

负责 Record 导航、单个 Record 的树、节点检查器和展开状态。

- 工作区一次只展示一个选中 Record。导航栏只负责导航，不渲染多份 Record 内容。
- 选择、滚动意图和展开状态都按 Revision 作用域管理。
- 共享状态放在最近的组合根或领域 hook 中，通过显式接口传递，不引入外部状态库。

### Agent Session

负责识别 Agent 日志并投影出会话、事件和对话。

- Adapter 只从原始记录中提取证据（工具调用与结果、回合、token、子 Agent、上下文压缩）。
  展示逻辑放在 Adapter 之外。
- 工具调用、结果和完成状态的配对集中在一个模块中，各 Adapter 和 Trajectory 共用。
- 完整性问题挂在受影响的条目上作为告警，不使整个会话识别失败。
- 每个事件和对话条目都保留 canonical Record 链接。
- 新增 Agent 格式时实现新的 `AgentSessionAdapter`，不修改会话模型的身份规则。

### Agent Trajectory

负责把同一 Agent Session 投影为按回合和时间组织的工作轨迹。

- Trajectory 是 Session 的投影，不创建新的会话身份。
- 派生的步骤必须明确标注，与原始事件区分。
- 投影是纯计算，可以单独计时和测试；视图在首次进入时按需加载。

### 本地分析工具

结构化比较、记录表格、字段体检和问题片段导出。

- 按需加载，不计入首屏 JavaScript。
- 每个工具都有输入、遍历和输出上限，超限明确失败。
- 不修改当前 Source。字段体检在记录表格的同一次扫描中累积，不重复解析。

### 复制与导出

- 大数据分块序列化，并在批次之间让出主线程。
- 超出输出预算时失败，不下载部分文件。
- 未解析完整的截断错误行不能作为完整数据导出。

### 虚拟化

Record rail、Agent timeline、Agent conversation、Trajectory ledger 和 JSON tree 各自持有
虚拟化实现。目前不抽取共享的虚拟列表模块，理由和触发重新评估的条件见
`docs/virtualization.md`。

### 设计系统

运行时 token 在 `packages/ui/src/styles.css` 中，使用规则见 `DESIGN.md`。

## 分发渠道

- **Web（`apps/web`）**：单页应用，以及首页、使用指南和多语言更新日志等静态页面。部署到
  Cloudflare Workers Static Assets。访问统计只使用 Umami，不采集用户内容。
- **浏览器扩展（`apps/extension`）**：WXT 管理 Manifest V3。background 负责右键菜单、快捷键、
  工具栏按钮和选区交接；options 页面复用 `UnquoteApp`。Chrome 和 Edge 共用同一构建。
- **Safari（`apps/safari`）**：macOS 宿主应用，分发扩展的 Safari 构建。实验渠道，见
  `apps/safari/AGENTS.md`。
