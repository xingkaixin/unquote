# Unquote — Agent Reference

Unquote is a local JSON / JSONL viewer that recursively expands stringified JSON. It is a pnpm monorepo with four packages.

## Architecture

```
packages/core          Pure TypeScript parser library (ESM + CJS, no framework deps)
packages/ui            React component library + app logic + design system
apps/web               Vite + React web app
apps/extension         WXT + React Chrome extension (MV3)
```

## Technology Stack

| Layer | Tools |
|---|---|
| Package Manager | pnpm 10.33.0 (workspace protocol `workspace:*`) |
| Build / Dev | Turbo, Vite, tsup |
| Frontend | React 19, TypeScript 6, Tailwind CSS v4 |
| Component Primitives | Radix UI (dropdown, scroll-area, tabs, tooltip, slot) |
| Virtualization | `@tanstack/react-virtual` |
| Icons | `lucide-react` |
| Testing | Vitest, `@testing-library/react`, jsdom |
| Lint / Format | oxlint, oxfmt |
| Extension | WXT (web extension toolkit) |

## Core Domain (`packages/core`)

### Key Types

```typescript
interface JsonNode {
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  value: unknown;
  path: string[];           // e.g. ["", "payload", "items", "0"]
  wasStringified: boolean;  // true if this node came from a JSON string value
  children?: Record<string, JsonNode> | JsonNode[];
  meta: { depth, expandable, restorable, recordId?, sourceLine? };
}

interface JsonlRecord {
  id: string;
  lineNumber: number;
  node: JsonNode | null;
  error?: string;
  summary: string;
}

interface ParseResult {
  format: "json" | "jsonl";
  records: JsonlRecord[];
  stats: { total, success, failed };
}
```

### Parser Behavior

- `parseInput(text, opts?)` — auto-detects JSON vs JSONL, recursively expands stringified JSON strings into child nodes.
- `maxDepth` guard prevents infinite recursion.
- `formatResult(result)` — serializes parsed records back to formatted JSON/JSONL.
- `materializeNode` / `restoreNode` — convert tree back to plain JS values.

## UI Layer (`packages/ui`)

### Exported Entry Points

```typescript
// packages/ui/src/index.ts
export * from "./app";                         // UnquoteApp component
export { I18nProvider, useTranslation } from "./i18n/context";
export { createTranslator, detectLocale, persistLocale } from "./i18n/i18n";
export { en, zhCN } from "./i18n/*";
export "./styles.css";                         // Tailwind v4 theme
```

### Design System (Tailwind v4)

CSS variables defined in `src/styles.css`:
- Surface scale: `surface-50` → `surface-500`
- Text scale: `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`
- Semantic: `accent` (orange), `success` (green), `error` (red), `warning` (amber)
- Code syntax: `code-string`, `code-number`, `code-boolean`, `code-null`, `code-key`
- Dark mode: `.dark` class toggle on `<html>`

### Key Components

| File | Purpose |
|---|---|
| `app.tsx` | Root `UnquoteApp` component. Holds all top-level state (source text, theme, search, expanded paths, restored records). |
| `components/json-tree.tsx` | Renders a single `JsonlRecord` as a tree. Lazy hydration via `IntersectionObserver`. Virtual list auto-enabled at >160 rows. |
| `components/record-list.tsx` | Maps `records` → `JsonTree[]`. Filters `searchMatches` per record. |
| `components/search-bar.tsx` | Search input + toggle buttons (regex, case-sensitive, jq/JSONPath). |
| `components/toolbar.tsx` | Format badge, stats, hovered path label, action buttons. |
| `components/input-pane.tsx` | Textarea input + mode selector (auto/json/jsonl) + file drop zone. |
| `components/toc-pane.tsx` | JSONL record navigation sidebar. |
| `components/theme-toggle.tsx` / `locale-toggle.tsx` | User preference controls. |

### Hooks

| File | Purpose |
|---|---|
| `hooks/use-parser.ts` | Wraps `parseInput` in a Web Worker (`parser-worker.ts`). Debounces at 120ms. Falls back to main-thread if `Worker` unavailable. |

### Tree Utilities (`lib/tree.ts`)

- `buildRecordRows(record, expandedPaths, restoredIds)` → `TreeRow[]` — flattens `JsonNode` tree into renderable rows.
- `searchRecords(records, query, options)` → `SearchMatch[] | null` — searches across key, value, and path (when `jq: true`).
- `collectStringifiedPaths(record, ...)` — finds all `wasStringified` nodes for "Expand All".
- `materializeRecord(record, restoredIds)` — converts tree back to plain JSON value.

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
- If record not yet hydrated, auto-sets `hydrated = true` first.

### Internationalization

- `Locale = "en" | "zh-CN"`
- `Messages` interface in `i18n/i18n.ts` — all keys must be defined in both `en.ts` and `zh-CN.ts`
- `createTranslator(messages)` returns `t(key, params?)` function
- Locale persisted to `localStorage` key `unquote-locale`

## Web App (`apps/web`)

- **Entry:** `src/main.tsx`
- **Build:** Vite → `dist/web`
- **Features:**
  - URL hash sync via `lz-string` compression (`#data=<compressed>`)
  - File open dialog (`.json`, `.jsonl`)
  - Chrome Web Store link badge

## Chrome Extension (`apps/extension`)

- **Framework:** WXT (handles MV3 manifest generation)
- **Entry:** `entrypoints/options/main.tsx` (options page reuses `UnquoteApp`)
- **Background:** `entrypoints/background.ts`
  - Context menu: "Open in Unquote" on text selection
  - Keyboard shortcut: `Ctrl+Shift+U` / `Cmd+Shift+U`
  - Action click: opens options page
  - Stores selected text in `browser.storage.session`, extension reads it on open
- **i18n:** Manifest uses `__MSG_appName__` / `__MSG_appDescription__` with `_locales/en/messages.json` and `zh_CN/messages.json`

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
| `pnpm dev` | Start all dev servers (web + extension) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | oxlint all packages |
| `pnpm test` | Run all Vitest suites |
| `pnpm check` | typecheck + lint + test |
| `pnpm deploy:cf` | Build web + deploy to Cloudflare Pages |
| `pnpm zip-extension` | Build + zip extension for store upload |

## Development Guidelines

- **New components** go in `packages/ui/src/components/`
- **New i18n keys** must be added to `i18n/i18n.ts`, `en.ts`, and `zh-CN.ts`
- **Core parser changes** should include tests in `packages/core/tests/`
- **UI tests** use `@testing-library/react` + jsdom. Mock `Worker` as in `packages/ui/tests/app.test.tsx`.
- **Styling:** Tailwind v4 utility classes + CSS variables. No arbitrary values unless necessary.
- **Icons:** Always from `lucide-react`. Size convention: `size-3` (12px), `size-3.5` (14px), `size-4` (16px).
- **State:** Top-level app state lives in `app.tsx`. Pass down via props; no external state library.
