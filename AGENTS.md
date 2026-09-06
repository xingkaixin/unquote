# Unquote — Agent Guide

Unquote is a local JSON / JSONL viewer. It recursively expands stringified JSON and provides
Agent and Trajectory views for recognized agent-session logs.

## Repository Map

```text
packages/core          Framework-free TypeScript parser library (ESM + CJS)
packages/ui            React component library, app logic, and design system
apps/web               Vite web app
apps/extension         WXT browser extension shared by Chrome and Safari builds
apps/safari            macOS host app that distributes the Safari extension
```

The package manifests, `pnpm-workspace.yaml`, `tsconfig.base.json`, and `turbo.json` are the
sources of truth for versions, scripts, path mappings, and build configuration. Read the scoped
guide before changing one of these areas:

- `packages/core/AGENTS.md` — parser model, serialization, and Core tests
- `packages/ui/AGENTS.md` — UI ownership, Agent-session behavior, styling, i18n, and UI tests
- `apps/extension/AGENTS.md` — extension entry points and browser-specific behavior
- `apps/safari/AGENTS.md` — Xcode host, bridge contract, and Safari release constraints

## Cross-Cutting Invariants

- Preserve JSON number source lexemes through parsing, serialization, copy, and export.
- Keep Record identity and raw-line linkage stable across parser, search, Agent, and Trajectory
  views.
- Reject asynchronous parser, search, hydration, and selection results produced for an obsolete
  Source Revision.
- Parse each JSONL line once per ingestion path and reuse its canonical Record id.
- Keep shared state at the nearest composition root or domain hook. Do not add an external state
  library without a concrete requirement that the existing ownership model cannot satisfy.

## Workflow

- Safari builds are experimental. Exclude Safari-specific compatibility, packaging, and
  distribution from routine reviews and validation unless the user explicitly requests Safari
  work. This policy takes precedence over Safari verification requirements in scoped guides.
- Use pnpm workspace scripts instead of reconstructing build commands from package internals.
- Run the smallest checks that cover the change while iterating. Run `pnpm check` before handing
  off a code change that can affect production behavior.
- Run `pnpm benchmark` for parser, search, virtualization, Agent-session, or large-file changes
  that can affect the release performance budgets documented in `docs/performance.md`.
- Run `pnpm build:safari` only when explicitly requested Safari work affects packaging or
  distribution behavior.
- Add or update tests when they protect changed observable behavior, a regression boundary, or a
  fragile platform contract. Follow the scoped guide for test entry points.

## Dependency Constraint

`pnpm-workspace.yaml` pins esbuild to 0.28.2 because tsup 8.5.1 still requests the vulnerable
`^0.27.0` line. Do not remove the override until tsup accepts a patched esbuild. Verify a proposed
removal with `pnpm audit` and `pnpm check`.
