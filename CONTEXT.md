# Unquote

Unquote 将 JSON、JSONL 与可识别的 Agent 日志转换为可浏览、可查询的本地结构。

## Language

**Source**:
用户当前打开或输入的一份 JSON 或 JSONL 内容。
_Avoid_: Input payload, document

**Source Revision**:
Source 内容及其解析模式的一个不可变版本。任何解析、搜索或视图派生结果都只属于产生它的 Source Revision。
_Avoid_: Generation, request version

**Local-file Source Access**:
本地文件 Source 的能力边界，负责读取、搜索，以及将 Preview Record 解析为 Full Record；调用方只表达意图，不感知逐行扫描、checkpoint 或 cache。
_Avoid_: File helper, hydration layer

**Record**:
Source 中可独立定位和查看的内容项；JSON Source 对应整体内容，JSONL Source 对应一个非空行。
_Avoid_: Row, entry

**JSON Node**:
Record 内的一项 JSON 事实。容器节点保存 children，primitive 保存 value；路径、深度与 Record 归属属于遍历上下文，不复制到节点。
_Avoid_: Tree row, value wrapper

**Truncated JSON Node**:
达到解析深度预算的容器节点。它不再递归建立 children，但保留未展开的容器 value，以保证 materialize 与格式化不丢失内容。
_Avoid_: Preview Record, failed node

**Preview Record**:
仅提供浏览和定位所需部分信息、完整内容尚未取得的 Record。
_Avoid_: Deferred record, compact record

**Full Record**:
完整内容已经可用于浏览、复制和导出的 Record。
_Avoid_: Hydrated record

**Failed Record**:
无法解析为 JSON、但仍保留来源位置与诊断信息的 Record。
_Avoid_: Error row

**Stringified JSON**:
编码在 JSON string 值中的合法 JSON；Unquote 将其识别为可展开的嵌套结构。
_Avoid_: Escaped JSON

**Agent Session**:
从可识别的 Agent JSONL Source 中投影出的会话语义，包含会话信息、对话与时间线。
_Avoid_: Agent log

**Agent Event**:
Agent Session 时间线中的一次可定位事件，并关联回产生它的 Record。
_Avoid_: Timeline row

**Conversation Item**:
Agent Session 对话中的一项用户消息、助手消息、推理、工具调用或工具结果，并关联回产生它的 Agent Event。
_Avoid_: Message row, conversation block
