# Unquote Chrome Web Store 提交材料（简体中文）

> 对应版本：0.11.0  
> 扩展 ID：`ohcepfneflaihakpkkgmnbdgjhnmcjeg`  
> 默认语言：英文；本文件用于 Chrome Web Store 的简体中文本地化条目。

## 1. 商店条目

### 名称

Unquote - 转义 JSON 展开与 JSONL 查看器

名称来自扩展包内的 `zh_CN` manifest 本地化资源。修改名称时应同步修改
`apps/extension/public/_locales/zh_CN/messages.json`，不能只改开发者后台。

### 摘要

在本地展开字符串化的 JSON 并浏览 JSONL。

摘要来自扩展包内的 manifest `description`，少于 132 个字符。

### 详细说明

Unquote 是一个在浏览器本地运行的 JSON 与 JSONL 查看器。它可以识别并递归展开
JSON 字符串中再次编码的 JSON 内容，帮助开发者阅读 API 响应、日志、AI 模型输出
以及 Agent 工具调用记录。

主要功能：

- 自动识别 JSON 和 JSONL，并递归展开字符串化 JSON
- 通过交互式树视图查看嵌套数据、路径、类型和语法高亮
- 搜索键名、值和 JSONPath，快速定位匹配记录
- 浏览 JSONL 记录，查看成功、失败、嵌套路径和字段统计
- 识别 Codex 与 Claude Code 会话日志，并展示对话、工具调用和时间线
- 复制或导出处理后的 JSON / JSONL
- 支持拖放或打开本地文件，也可通过右键菜单打开选中的 JSON 文本
- 支持浅色、深色和跟随系统主题
- 所有解析均在本地完成，不会把用户内容发送到开发者服务器或第三方

Unquote 不需要账号，不包含广告，也不会跟踪浏览活动。

### 分类与其他字段

| 字段 | 建议值 |
|---|---|
| 分类 | 开发者工具 |
| 官方网站 | `https://unquote.xingkaixin.me/` |
| 支持网址 | `https://github.com/xingkaixin/unquote/issues` |
| 成人内容 | 否 |
| 付费内容 | 否 |
| 可见性 | 公开 |
| 地区 | 所有可用地区 |

## 2. 图片物料

Chrome Web Store 支持为每种语言上传最多 5 张本地化截图。建议按以下顺序上传这
4 张简体中文截图：

1. [深色主题：递归展开 JSON](chrome-web-store-screenshot-zh-dark-json-tree-1280x800.png)
2. [深色主题：Agent 会话视图](chrome-web-store-screenshot-zh-dark-agent-session-1280x800.png)
3. [浅色主题：JSONL 搜索](chrome-web-store-screenshot-zh-light-jsonl-search-1280x800.png)
4. [浅色主题：错误诊断](chrome-web-store-screenshot-zh-light-error-diagnostics-1280x800.png)

全局图片物料：

- [128×128 商店图标](../apps/extension/public/icon128.png)
- [300×300 品牌 Logo](logo-300x300.png)
- [440×280 小宣传图](chrome-web-store-small-promo-440x280.png)
- [1400×560 Marquee 宣传图](chrome-web-store-marquee-1400x560.png)

小宣传图和 Marquee 宣传图是全局物料，不能按语言分别上传。

## 3. 隐私实践

### 单一用途说明

在用户明确提供 JSON、JSONL 或 Agent 日志后，在浏览器本地解析、展开、搜索和
展示这些结构化数据。

### 权限说明

#### `contextMenus`

用于在网页文本选择菜单中添加“在 Unquote 中打开”。只有用户主动选择该菜单项
时，扩展才读取当前选中的文本，并在 Unquote 页面中打开它。扩展不会自动读取
网页内容。

#### `storage`

用于通过 `chrome.storage.session` 将用户主动选择的文本临时交接给新打开的
Unquote 页面。数据只保存在当前浏览器会话中，最长保留 5 分钟，并在页面首次
读取后立即删除。扩展不使用该权限建立用户档案或跨设备同步内容。

#### `clipboardRead`

用于在用户主动执行粘贴操作，且剪贴板内容代表 JSON / JSONL 文件时读取该文件
内容。扩展不会在后台读取、轮询或监控剪贴板。

### 主机权限

不申请任何主机权限。扩展不能读取任意网页、浏览历史、Cookie 或网络请求。

### 远程代码声明

选择：

> 否，我没有使用远程代码。

说明：

> 扩展的 JavaScript 和 WebAssembly（如有）均包含在扩展包内。扩展不会下载、
> 加载或执行远程托管的代码。

### 数据使用披露

扩展会处理以下由用户主动提供的数据：

- 用户生成的内容：用户粘贴、输入、打开或拖放的 JSON / JSONL
- 网站内容：仅限用户选中并通过“在 Unquote 中打开”明确提交的网页文本

处理方式：

- 数据仅在用户设备上的扩展页面和扩展会话存储中处理
- 不传输到开发者服务器或第三方
- 不用于广告、分析、信用评估、个性化推荐或其他无关用途
- 不出售、不共享，也不允许开发者或第三方人工读取
- 本地文件内容通常保存在页面内存中；关闭或刷新页面后即被释放
- 右键菜单交接内容最长保留 5 分钟，并在读取后立即删除
- 主题和语言偏好可保存在浏览器本地存储中
- 只有用户主动执行复制或导出时，内容才会写入剪贴板或保存为本地文件

开发者后台的数据类型应与当时显示的字段定义逐项核对。不要选择“完全不处理
用户数据”：即使内容不离开设备，扩展仍会在本地处理用户提供的内容。

### Limited Use 认证

可以确认以下声明：

- 数据处理仅用于扩展公开说明的单一用途
- 不向第三方出售或转移用户数据
- 不将用户数据用于与单一用途无关的用途
- 不将用户数据用于信用评估或借贷
- 不允许人工读取用户数据

## 4. 隐私政策草案

发布前必须把本节放到公开可访问的 HTTPS 页面，并在开发者后台填写该页面的
URL。建议地址：`https://unquote.xingkaixin.me/privacy`。在该页面真实上线前，
不要把这个建议地址提交到商店。

### Unquote 隐私政策

生效日期：2026 年 7 月 24 日

Unquote 是一个在用户设备本地解析和查看 JSON、JSONL 与 Agent 日志的浏览器
扩展。

#### 我们处理的数据

Unquote 只处理用户主动输入、粘贴、打开、拖放或通过网页右键菜单提交的内容。
这些内容可能包含用户生成的内容或用户选中的网站文本。扩展还可在本地保存主题
和语言偏好。

#### 数据用途

这些内容仅用于在用户设备上解析、展开、搜索、显示、复制或导出 JSON 与 JSONL。
扩展不会将其用于广告、分析、用户画像或任何无关用途。

#### 数据存储与保留

解析内容通常只保存在当前扩展页面的内存中。通过右键菜单提交的选中文本使用
Chrome 的会话存储临时传递，最长保留 5 分钟，并在首次读取后立即删除。主题和
语言偏好可能保存在浏览器本地存储中，用户可以通过清除扩展数据将其删除。

#### 数据传输与共享

Unquote 不会把用户提供的内容发送给开发者服务器或第三方，不出售或共享用户
数据，也不允许开发者或第三方人工读取这些内容。

#### 权限

扩展使用右键菜单权限提供“在 Unquote 中打开”，使用会话存储在扩展页面之间
临时传递用户选择的文本，并仅在用户主动粘贴 JSON / JSONL 文件时使用剪贴板
读取权限。扩展不申请网站主机权限。

#### 用户控制

用户可以清空当前输入、关闭扩展页面、清除扩展存储或卸载扩展来删除本地数据。
复制和导出仅在用户主动操作后发生。

#### 政策更新

如果数据处理方式发生变化，我们会更新本政策，并按照 Chrome Web Store 政策
在新做法开始前向用户提供必要的显著披露。

#### 联系方式

问题或隐私请求请提交至：
`https://github.com/xingkaixin/unquote/issues`

Unquote 对信息的使用遵守 Chrome Web Store 用户数据政策及其 Limited Use
要求。

## 5. 审核说明

可在测试说明或审核备注中填写：

> Unquote 不需要登录或测试账号。点击扩展图标即可打开主页面。可点击输入框下方
> 的样例快速验证功能：选择“转义 API 响应”查看递归展开；选择“Codex rollout
> JSONL”查看 Agent 会话；选择“有效/无效混合 JSONL”查看逐行错误诊断。扩展
> 不申请主机权限，所有解析均在本地完成。

右键菜单测试：

1. 在任意网页选中一段 JSON 文本。
2. 右键选择“在 Unquote 中打开”。
3. 扩展会打开新页面并显示选中的内容。

快捷键测试：

- Windows / Linux：`Ctrl+Shift+U`
- macOS：`Command+Shift+U`

## 6. 提交前检查

- 运行 `pnpm check`
- 运行 `pnpm zip-extension`
- 确认 ZIP 根目录包含 `manifest.json`
- 确认版本号高于商店中已发布版本
- 上传 4 张简体中文本地化截图
- 上传 4 张英文本地化截图
- 上传 440×280 小宣传图
- 可选上传 1400×560 Marquee 宣传图
- 确认隐私政策 URL 已公开且可访问
- 确认商店披露、隐私政策和实际代码行为一致
- 提交后检查审核状态、警告和发布范围

## 7. 官方参考

- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/best-listing
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/permissions/

