# Unquote — Agent Reference

Unquote is a local JSON / JSONL viewer that recursively expands stringified JSON and adds a session lens for recognized agent JSONL logs. It is a pnpm monorepo with four packages, plus an Xcode project that ships the same extension to Safari.

## Architecture

```
packages/core          Pure TypeScript parser library (ESM + CJS, no framework deps)
packages/ui            React component library + app logic + design system
apps/web               Vite + React web app
apps/extension         WXT + React Chrome extension (MV3)
apps/safari            Xcode host app that ships the extension to Safari (macOS)
```

## Technology Stack

| Layer | Tools |
|---|---|
| Runtime | Node.js 24 |
| Package Manager | pnpm 11.20.0 (workspace protocol `workspace:*`) |
| Build / Dev | Turbo, Vite, tsup |
| Frontend | React 19, TypeScript 7, Tailwind CSS v4 |
| Component Primitives | Base UI (dialog, menu, tabs, tooltip, separator) |
| Virtualization | `@tanstack/react-virtual` |
| Icons | `lucide-react` |
| Testing | Vitest, `@testing-library/react`, jsdom |
| Lint / Format | oxlint, oxfmt |
| Extension | WXT (web extension toolkit) |

The workspace `overrides` setting pins esbuild to 0.28.2 because tsup 8.5.1 still requests the
vulnerable `^0.27.0` line. Do not remove the override until tsup accepts a patched esbuild; verify
the change with `pnpm audit`, `pnpm check`, and `pnpm build:safari`.

## Core Domain (`packages/core`)

### Key Types

```typescript
type JsonNode = FullJsonNode | PreviewJsonNode;

type FullJsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | TruncatedJsonObjectNode
  | TruncatedJsonArrayNode
  | JsonSourceStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

type PreviewJsonNode =
  | PreviewJsonObjectNode
  | PreviewJsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

type JsonlRecord = FullJsonlRecord | PreviewJsonlRecord | FailedJsonlRecord;

interface JsonlRecordBase {
  id: string;
  lineNumber: number;
  summary: string;
}

interface FullJsonlRecord extends JsonlRecordBase {
  status: "full";
  node: FullJsonNode;
}

interface PreviewJsonlRecord extends JsonlRecordBase {
  status: "preview";
  node: PreviewJsonNode;
  preview?: JsonlRecordPreview;
}

interface FailedJsonlRecord extends JsonlRecordBase {
  status: "failed";
  node: null;
  error: string;
  errorMeta: ParseErrorMeta;
  rawLine: string;
}

interface ParseResult {
  format: "json" | "jsonl";
  records: JsonlRecord[];
  stats: { total, success, failed };
}
```

Normal container nodes own `children`; truncated containers own `value` plus
`truncated: true`; Preview container nodes own `childCount` plus `preview: true`.
Expanded Stringified JSON is represented by `rawString`, while a Preview Record
can mark it with `stringifiedPreview: true`. String nodes carry `valueLength`
directly when the displayed value is truncated. Path, depth, and Record ownership
belong to traversal context rather than `JsonNode`.

Use the guards exported by `packages/core/src/records.ts` instead of rebuilding
record-state checks: `isParsed`, `isFullRecord`, `isPreviewRecord`, and
`isFailedRecord`.

### Parser Behavior

- `parseInput(text, opts?)` — auto-detects JSON vs JSONL, recursively expands stringified JSON strings into child nodes.
- `maxDepth` guard prevents infinite recursion.
- `formatResult(result)` — serializes parsed records back to formatted JSON/JSONL.
- `materializeNode` — converts expanded trees back to plain JS values.
- `restoreNode` — core-level utility that rebuilds selected stringified nodes as raw strings; the current UI does not expose a restore-to-raw workflow.

## UI Layer (`packages/ui`)

### Exported Entry Points

```typescript
// packages/ui/src/index.ts
export * from "./app";                         // UnquoteApp component
export { I18nProvider, useTranslation } from "./i18n/context";
export { createTranslator, detectLocale, persistLocale } from "./i18n/i18n";
export type { Locale, MessageKey, Messages } from "./i18n/i18n";
export { en } from "./i18n/en";
export { zhCN } from "./i18n/zh-CN";
```

### Design System (Tailwind v4)

CSS variables defined in `src/styles.css`:
- Surface scale: `surface-50` → `surface-500`
- Text scale: `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`
- Semantic: `accent` (orange), `success` (green), `error` (red), `warning` (orange, same hue as accent)
- Code syntax: `code-string`, `code-number`, `code-boolean`, `code-null`, `code-key`
- Dark mode: `.dark` class toggle on `<html>`

### Key Components

| File | Purpose |
|---|---|
| `app.tsx` | Root `UnquoteApp` composition root. Connects source loading, parsing, query interaction, local-file access, workspace selection, export actions, theme, and Agent/JSON output switching. |
| `components/app-header.tsx` | Loaded-workspace header with Agent/JSON tabs, search and match navigation, source switching, locale/theme controls, and copy/export actions. |
| `components/import-dialog.tsx` / `source-import-panel.tsx` | Empty-state and source-replacement import flow: paste/drop/file input, bounded live format detection, samples, and explicit auto/json/jsonl mode selection. |
| `components/record-workspace.tsx` / `workspace-columns.tsx` | Responsive three-column JSON composition: record rail, selected Record tree, and node inspector; desktop uses fixed side columns and mobile stacks the side panes. |
| `components/record-rail.tsx` | Virtualized Record navigation with insight classification, summaries, timestamps, turn indices, active selection, and query-driven scroll targets. |
| `components/record-tree-pane.tsx` / `json-tree.tsx` | Hydrates and renders the selected Record, exposes breadcrumb/copy/Expand All/Collapse All actions, and virtualizes trees above 180 display rows, including dynamic-height values. |
| `components/node-inspector.tsx` | Resolves the selected tree path within preview limits and exposes value/path copy plus nested-JSON expansion. |
| `components/record-filter-bar.tsx` | Direct all/tool/message/event/nested filters; match and error filters remain reachable through search, the command palette, and status bar. |
| `components/agent-session-view.tsx` | Three-column Agent lens composed from a virtualized timeline, virtualized conversation with expandable tool details, and session facts/metrics. |
| `components/command-palette.tsx` | `Cmd/Ctrl+K` command panel for search, path jump, search options, and record filters. |
| `components/status-bar.tsx` | Parse/search progress, file metrics, error navigation, workspace shortcut hints, clear action, and extension-store links. |
| `components/theme-toggle.tsx` / `locale-toggle.tsx` | User preference controls. |

### Hooks

| File | Purpose |
|---|---|
| `hooks/use-parser.ts` | Wraps `parseInput` in a Web Worker (`parser-worker.ts`). Debounces at 120ms, publishes streamed records through `lib/stream-publisher.ts`, terminates superseded workers, and falls back to main-thread if `Worker` unavailable. |
| `hooks/use-desktop-workspace.ts` | Tracks the desktop workspace media query for responsive three-column or stacked layouts. |
| `hooks/use-local-file-source.ts` | Browse-time state for local JSONL files: batched Preview-to-Full Record requests, Full Record cache eviction, copy/export resolution, and abort handling. |
| `hooks/use-global-shortcuts.ts` | Owns document-level command-palette opening, escape dismissal, and selected-node copy shortcuts. |
| `hooks/use-query-interaction.ts` | Stateful wrapper around command/search/path/filter reducer state and navigation targets. |
| `hooks/use-output-view.ts` | Owns Agent/JSON output selection and resets it when the detected Agent session identity changes. |
| `hooks/use-search-worker.ts` | Runs search off the main thread with cancellation and a time budget for superseded queries, with an in-process fallback when workers are unavailable. |
| `hooks/use-source-loader.ts` | Owns source text / file import state, large JSONL streaming decisions, file read progress, and file read error callbacks. |
| `hooks/use-export-actions.ts` | Owns copy/export actions, full-record resolution, blocked-copy feedback, clipboard failures, and long-running export toasts. |
| `hooks/use-record-pipeline.ts` | Derives record lookup, insight, overview, filtered records and stats, plus visible search matches from a parse result and query state. |
| `hooks/use-record-workspace.ts` | Deep Record workspace module that combines query interaction, revision-scoped selection, local-file hydration, export actions, and selected-node projection behind one model. |
| `hooks/use-workspace-session.ts` | Owns revision-scoped Record/node/Agent-detail selection, scroll intent, query navigation, and Stringified JSON expansion state. |
| `hooks/use-theme-preference.ts` | Owns theme preference persistence and `<html>` dark-mode class synchronization. |

### Tree Utilities (`lib/tree.ts`)

- `buildRecordRows(record, expandedPaths)` → `TreeRow[]` — flattens one selected Record's `JsonNode` tree into renderable rows and marks descendants inside Stringified JSON.
- `collectStringifiedPaths(record, ...)` — finds reachable Stringified JSON boundaries; nested boundaries become reachable as their ancestors expand.
- `materializeRecord(record)` — converts the expanded tree back to a plain JSON value for copy/export.

### UI Utility Modules

- `lib/local-file-source.ts` — local-file capability for line scanning, Preview and Full Record parsing, whole-file search, and record resolution for copy/export.
- `lib/agent-session/` — detects Codex rollout and Claude Code JSONL transcripts; adapters build sessions and the domain model resolves timeline/conversation selection back to canonical events and Records.
- `lib/json-walk.ts` — shared `JsonNode` tree traversal used by tree rendering, search, overview, and record insight code.
- `lib/jsonl-lines.ts` — shared incremental JSONL line scanner with CRLF handling and early-stop support.
- `lib/field-extraction.ts` — shared Full Record and Preview Record traversal for file overview and record-insight field candidates and nested metrics.
- `lib/partial-record-cache.ts` — shared incremental cache for file overview and record insight aggregation while records stream in.
- `lib/record-derivation.ts` — drives record insight and file overview through one field traversal per Record and incrementally reuses prior results.
- `lib/record-expansion.ts` — immutable per-Record Stringified JSON expansion state and batched update helpers.
- `lib/record-export.ts` — pure copy/export formatting, filename, blob download, and large-copy threshold helpers.
- `lib/record-filter.ts` — the canonical record-filter mode and Record classification logic.
- `lib/record-fields.ts` — shared field extraction helpers for overview and insight classification.
- `lib/record-search.ts` — searches Record keys, values, and paths and owns search match types.
- `lib/source-revision.ts` — Source Revision ownership type and stale-result guards.
- `lib/stream-publisher.ts` — batches streamed parser records before React state updates.
- `lib/path-codec.ts` — bottom-level JSONPath / jq parse and format helpers.
- `lib/query-interaction.ts` — pure reducer for header query mode, search options, path results, match navigation, record filters, and the jq/regex mutex.
- `lib/source-samples.ts` — sample payloads used by the import panel, including escaped JSON, generic tool-call JSONL, Codex rollout JSONL, and mixed valid / invalid JSONL.
- `lib/toolbar-summary.ts` — derives localized status and progress summaries from parser, file, search, and filter state.
- `lib/tree-display.ts` — converts flattened tree rows into display rows and syntax classes for `JsonTree`.
- `lib/tree-path.ts` — resolves JSONPath / jq selectors to canonical Record tree paths.
- `lib/workspace-selection.ts` — pure selection reconciliation for record replacement and streamed record appends.

### Agent Session Feature

- Detection runs only for JSONL input and currently recognizes Codex envelopes (`session_meta`, `event_msg`, `response_item`, `turn_context`) and Claude Code transcript / meta lines.
- When a session is detected, the output area defaults to the Agent tab while keeping the normal expanded JSON tree available in the JSON tab.
- The Agent tab uses a responsive timeline / conversation / session-overview layout; tool calls and results expand inline, and conversation items can open their canonical JSONL Record.
- Agent sessions preserve raw line linkage so conversation and timeline selections can show the underlying parsed record.
- Invalid JSONL lines collected during agent-session parsing become parse warnings instead of disabling the detected session.

### Search Feature

Search options (`SearchOptions`):
- `regex: boolean` — treat query as RegExp
- `caseSensitive: boolean`
- `jq: boolean` — also match `pathText` (e.g. `$.timestamp`)

**Mutual exclusion:** jq and regex cannot both be active. Clicking one while the other is on will auto-switch.

Search result (`SearchMatch`):
- `recordId`, `pathText`, `keyRanges[]`, `valueRanges[]`, `pathRanges[]`, `stringifiedPathChain[]`

Active match auto-scroll:
- Virtualized: `rowVirtualizer.scrollToIndex(index, { align: "center" })`
- Non-virtualized: `element.scrollIntoView({ block: "center", behavior: "smooth" })`
- If the target is still a Preview Record, requests its Full Record before scrolling to the match.

### Internationalization

- `Locale = "en" | "zh-CN"`
- `Messages` type is derived from the canonical `en.ts` schema and re-exported via `i18n/i18n.ts`; `zh-CN.ts` is checked against the same key set
- `createTranslator(messages)` returns `t(key, params?)` function
- Locale persisted to `localStorage` key `unquote-locale`

## Web App (`apps/web`)

- **Entry:** `src/main.tsx`
- **Build:** Vite → `dist/web`
- **Features:**
  - Clears legacy source-bearing URL hashes without persisting new input in browser history
  - File open dialog (`.json`, `.jsonl`)
  - Chrome Web Store and Microsoft Edge Add-ons links in the status bar

## Chrome Extension (`apps/extension`)

- **Framework:** WXT (handles MV3 manifest generation)
- **Entry:** `entrypoints/options/main.tsx` (options page reuses `UnquoteApp`)
- **Background:** `entrypoints/background.ts`
  - Context menu: "Open in Unquote" on text selection
  - Keyboard shortcut: `Ctrl+Shift+U` / `Cmd+Shift+U`
  - Action click: opens options page
  - Stores selected text in `browser.storage.session`, extension reads it on open
- **i18n:** Manifest uses `__MSG_appName__` / `__MSG_appDescription__` with `_locales/en/messages.json` and `zh_CN/messages.json`

## Safari Extension (`apps/safari`)

Safari extensions ship inside a native macOS app, so `apps/safari` holds an Xcode project that `xcrun safari-web-extension-converter` generated once and that is version-controlled from then on. Re-running the converter is not part of the workflow: the extension target reads its `Resources` directory, and `pnpm build:safari` is what rebuilds and refills it.

- **Bundle identifiers:** `com.xingkaixin.unquote` (app) and `com.xingkaixin.unquote.extension` (extension). App Store Connect requires the extension identifier to nest under the app's.
- **Deployment target:** macOS 12. Selection handoff needs `storage.session` (Safari 16.4+), which macOS 12 users can install; on older Safari the handoff opens an empty editor instead of failing.
- **Manifest differences:** the Safari build drops `clipboardRead`, which Safari does not support. `wxt.safari.config.ts` only overrides the output directory — `wxt.config.ts` owns the browser-conditional manifest.
- **Ignored paths:** `Unquote Extension/Resources` is a build output and `xcuserdata` is local state; neither belongs in git.
- **Host app window:** `Unquote/Resources/Base.lproj/Main.html` is the app's entire interface and therefore what App Review judges. `Script.js` rewrites the `.state-*` paragraphs, so keep those elements text-only.
- **Host bridge contract:** `Unquote/SafariHostContract.swift` owns the extension-state commands and accepted JavaScript messages. `UnquoteTests` verifies the native mapping, while `apps/safari/tests/host-script.test.ts` executes the shipped HTML and JavaScript resources under jsdom. The shared scheme and macOS CI run the native tests without signing.
- **Release:** open the project in Xcode, pick a signing team, bump `CURRENT_PROJECT_VERSION`, then Archive and upload to the Mac App Store. `MARKETING_VERSION` syncs from the extension manifest during `pnpm build:safari`.

## TypeScript Configuration

- Base: `tsconfig.base.json` — `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- Path mapping:
  - `@unquote/core` → `packages/core/src/index.ts`
  - `@unquote/ui` → `packages/ui/src/index.ts`
  - `@unquote/ui/*` → `packages/ui/src/*`

## Turbo Pipeline

```json
{
  "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".output/**"] },
  "dev": { "cache": false, "persistent": true },
  "test": { "dependsOn": ["^build"], "outputs": [] }
}
```

## Scripts

| Command | Description |
|---|---|
| `pnpm install` | Install dependencies and configure the staged-file pre-commit gate |
| `pnpm dev` | Start all dev servers (web + extension) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | oxlint all packages |
| `pnpm format:check` | oxfmt check across all packages |
| `pnpm test` | Run all Vitest suites |
| `pnpm check` | format check + typecheck + lint + test + production build |
| `pnpm benchmark` | Regenerate default fixtures, then build and run the release performance gate |
| `pnpm benchmark:agent` | Run the performance gate against the synthetic Agent session fixture |
| `pnpm benchmark:fixtures` | Deterministically regenerate the ignored Agent, case 2, and case 4 fixtures |
| `pnpm benchmark:case4-fixture` | Generate high-record-count JSONL release/stress fixtures |
| `pnpm deploy:cf` | Build web + deploy to Cloudflare Pages |
| `pnpm zip-extension` | Build + zip extension for store upload |
| `pnpm build:safari` | Build the Safari extension and sync it into the Xcode project |

## Development Guidelines

- **New components** go in `packages/ui/src/components/`
- **New i18n keys** must be added to `en.ts` and `zh-CN.ts`
- **Core parser changes** should include tests in `packages/core/tests/`
- **Agent session parser changes** should include tests in `packages/ui/tests/agent-session.test.tsx`.
- **UI tests** use `@testing-library/react` + jsdom. Mock `Worker` as in `packages/ui/tests/app.test.tsx`.
- **Styling:** Tailwind v4 utility classes + CSS variables. No arbitrary values unless necessary.
- **Icons:** Always from `lucide-react`. Size convention: `size-3` (12px), `size-3.5` (14px), `size-4` (16px).
- **State:** Top-level app state lives in `app.tsx`. Pass down via props; no external state library.
