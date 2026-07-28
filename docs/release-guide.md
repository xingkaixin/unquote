# Release Guide

用于每次发布前同步版本号、`CHANGELOG.md`、`CHANGELOG_zh-CN.md`、`README.md` 和 `AGENTS.md`。

## 输入

- 上一个发布 tag，例如 `v0.5.0`
- 上一个版本号，例如 `0.5.0`
- 目标版本，例如 `0.6.0`
- 目标 tag，例如 `v0.6.0`
- 计划发布日期，使用实际发布日，不要沿用预备提交日期

## 1. 确认基线

```sh
PREV_TAG=v0.5.0
PREV_VERSION=0.5.0
VERSION=0.6.0

git status --short
git tag --list 'v*' --sort=-v:refname
git log --date=short --pretty=format:'%h %ad %s' "$PREV_TAG"..HEAD
git diff --stat "$PREV_TAG"..HEAD
```

发布说明必须基于上一个发布 tag 到当前 `HEAD` 的实际差异。不要只看最后一个版本准备提交。

## 2. 梳理变更

按用户可感知结果归类：

- `Added`：新增能力、入口、可见反馈、工具
- `Changed`：交互变化、默认行为变化、性能路径变化、架构中会影响后续维护的模块边界
- `Fixed`：已修复的用户问题、性能卡顿、错误状态、回归

内部重构只有在它改变维护边界、测试边界或发布风险时才写入 changelog。不要把每个 commit 都机械翻译成条目。

常用辅助命令：

```sh
git show --stat --oneline <commit>
git show --name-status --format=medium <commit>
git show --name-only --format='' "$PREV_TAG"..HEAD | sort -u
```

## 3. 更新版本号

应用发布版本需要同步：

- `package.json`
- `apps/web/package.json`
- `apps/extension/package.json`

`packages/core/package.json` 和 `packages/ui/package.json` 是仓库内部包（`private: true`），不发布到任何 registry，其 `version` 只用于 workspace 解析，因此不跟随应用版本。分发决策见 `docs/core-distribution.md`。

检查遗漏：

```sh
rg -n "$PREV_VERSION|$VERSION|version" package.json apps packages -g 'package.json'
```

## 4. 更新 changelog

同时更新：

- `CHANGELOG.md`
- `CHANGELOG_zh-CN.md`

要求：

- 顶部新增或更新目标版本章节，例如 `## [0.6.0] - 2026-06-19`
- 英文和中文条目语义一致，顺序一致
- 保留历史版本日期和内容，除非发现明确错误
- 明确写出版本号同步项，例如 Web 和扩展应用版本升级到 `0.6.0`
- 性能或大文件相关改动要写用户结果，不只写实现名

## 5. 使用 annotated tag

发布 tag 使用 annotated tag：

```sh
git tag -a "v$VERSION" -m "Release v$VERSION"
```

如果需要补打历史版本 tag，先定位准确提交，再显式指定目标提交：

```sh
git tag -a v0.5.0 <commit> -m "Release v0.5.0"
git rev-parse v0.5.0^{}
```

## 6. 按需更新 README 和 AGENTS

更新 `README.md` 的条件：

- 用户可见功能、入口、限制或行为变化
- 对外描述已经过期或遗漏发布重点

更新 `AGENTS.md` 的条件：

- 架构模块、关键文件职责、脚本、测试入口或约束变化
- 某个旧产品行为已经移除，继续保留会误导后续实现

不要为了“顺手整理”改无关段落。

## 7. 校验

文档更新后至少检查：

```sh
git diff -- CHANGELOG.md CHANGELOG_zh-CN.md README.md AGENTS.md docs/release-guide.md
rg -n "$PREV_VERSION|$VERSION|release" CHANGELOG.md CHANGELOG_zh-CN.md README.md AGENTS.md docs
```

如果发布包含代码、性能或大文件路径改动，运行：

```sh
pnpm check
pnpm benchmark
```

如果本次只改发布文档，可以不运行完整测试，但需要在最终说明中明确未运行。

## 8. Safari 渠道

Safari 扩展与 Chrome 扩展是同一套代码，通过 `apps/safari` 的 macOS 宿主应用分发。
除签名与上传外，发布前的准备都可以从干净 checkout 重现：

```sh
pnpm build:safari
```

这条命令做两件事，任何一步不满足都会失败而不是静默通过：

1. 用 `wxt.safari.config.ts` 构建 `dist/extension-safari`，其 manifest 不申请
   `clipboardRead`（Safari 没有该权限）；
2. 校验产物完整性与 manifest 身份，把 `MARKETING_VERSION` 同步为 manifest 版本，
   并重新填充 `apps/safari/Unquote Extension/Resources`。

同步后确认 Xcode 项目没有残留改动——若有，说明版本尚未提交：

```sh
git diff -- "apps/safari/Unquote.xcodeproj/project.pbxproj"
```

本地可以先做一次无签名构建，确认宿主应用仍能编译（CI 的 macOS job 执行同一命令）：

```sh
xcodebuild -project "apps/safari/Unquote.xcodeproj" -scheme Unquote -configuration Debug \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
```

**以下步骤需要人工在 Xcode 中完成，无法自动化：**

- 选择签名团队（App Store Connect 要求扩展 bundle id 嵌套在宿主应用之下：
  `com.xingkaixin.unquote` 与 `com.xingkaixin.unquote.extension`）；
- 递增 `CURRENT_PROJECT_VERSION`（`MARKETING_VERSION` 已由上面的命令同步）；
- Archive 并上传到 Mac App Store。

审核前检查：

- `apps/safari/Unquote/Resources/Base.lproj/Main.html` 是 App Review 实际看到的界面，
  `Script.js` 只改写其中的 `.state-*` 段落，因此这些元素必须保持纯文本；
- Deployment target 为 macOS 12；选中文本交接依赖 `storage.session`（Safari 16.4+），
  在更旧的 Safari 上会打开空编辑器而不是报错；
- `apps/safari/Unquote Extension/Resources` 与 `xcuserdata` 是构建产物与本地状态，
  不应出现在提交中。

## 9. 发布前最终核对

- 工作区 diff 只包含本次发布文档和必要版本号
- 双语 changelog 的 `Added` / `Changed` / `Fixed` 对齐
- README 没有夸大未完成能力
- AGENTS 没有保留已移除 UI 行为
- 目标版本号只更新了应更新的 package
- 若本次包含扩展改动，`pnpm build:safari` 已执行且 Xcode 项目无残留 diff
- 校验命令结果或未运行原因已记录
