# `@unquote/core` 分发决策

## 决策

`@unquote/core` 是**仓库内部包**，不发布到任何 registry。

在 v0.13.0 之前，仓库同时表达了两个互斥的契约：package 具备完整的 ESM / CJS / types
导出面、changelog 使用 "Breaking … migrate consumers" 的公共库语气、PRD 提到「供库消费者
使用」；但 npm registry 上从未存在这个包，也没有任何发布流程。任何一边都不完整，读者
无法判断该依赖哪一种承诺。

## 这个决策回答的问题

| 问题 | 答案 |
|---|---|
| 目标用户 | 本仓库内的 `@unquote/ui`、`@unquote/web`、`@unquote/extension`，以及 `benchmark/` 与 `scripts/`。没有仓库外的消费者。 |
| 支持范围 | 仅保证与本仓库同一 commit 上的其它 package 兼容。不提供跨版本迁移路径、弃用周期或 LTS。 |
| 版本责任 | `version` 字段只用于 workspace 解析，不表达面向外部的 semver 承诺。changelog 中标记的 breaking 变更描述的是仓库内的迁移，不是对外部调用方的通知。 |
| 发布所有者 | 无。`private: true` 让 `npm publish` 直接失败；没有人负责 registry 上的这个名字。 |

## 实施

- `packages/core/package.json` 标记 `private: true`，registry 发布被工具本身阻止。
- `files` 白名单让 `pnpm pack --dry-run` 的结果可解释：只有 `dist` 与 `LICENSE`，不再默认
  带上 `src`、`tests`、`tsconfig*.json` 与 `vitest.config.ts`。
- changelog 顶部说明 `@unquote/core` 的 breaking 条目只对仓库内部有意义。
- 文档不再暗示外部安装或外部消费者。

## 如果以后要公开发布

这个决策可以推翻，但代价是需要一并补齐的东西，而不是单独去掉 `private`：

- `description`、`license`、`repository`、`publishConfig` 等 metadata 与一份面向消费者的
  README；
- 针对 ESM、CJS、types 与目标 Node 版本的 pack smoke test；
- 一条 registry 发布流程，以及一个明确的 semver 与弃用策略所有者。

在这些就位之前，公开导出面只是没有人负责的承诺。
