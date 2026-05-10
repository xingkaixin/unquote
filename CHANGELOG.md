# Changelog

## [0.2.0] - 2026-05-10

### Added

- **Search & filtering** — Browser-style navigation across JSON records and nested stringified JSON
  - Search across keys, values, and JSONPath / jq-style paths
  - Regular expression and case-sensitive modes
  - Match highlighting, previous / next navigation, and match counters
  - Auto-scroll support for virtualized and standard tree rendering
  - Auto-expansion of stringified JSON paths that contain a match
  - Record filters for all records, search matches, parse errors, and nested JSON
- **Path tools** — Direct JSONPath / jq navigation and node inspection
  - Jump to exact paths across JSON / JSONL records
  - Inspect selected node path, raw key, type, source, and record number
  - Copy JSONPath and jq selectors
  - Status footer with current format, stats, and hovered or selected path
- **Large JSONL import** — Streamed parsing for pasted and dropped JSONL files
  - File drag-and-drop and clipboard file import in the source pane
  - Parsing status, progress, and imported-file preview
  - Worker-side chunk parsing with batched record updates
- **Parse diagnostics** — Line and column metadata for invalid JSON / JSONL
  - Error context snippets in source and output views
  - Raw failed line preserved for copying
  - Auto mode keeps valid JSONL records when a mixed JSONL input has failures
- **Performance benchmark tooling** — Release gate for large JSONL fixtures
  - `pnpm benchmark` and `pnpm benchmark:fixtures`
  - Headless Chrome render metrics and core parser p95 baselines
  - Documented 0.2.0 budgets in `docs/performance.md`

### Changed

- Web and extension app versions bumped to `0.2.0`.
- SEO metadata refined for escaped JSON / JSONL search intent
  - Page title, description, Open Graph, Twitter card, schema.org, sitemap, and `og-image.svg`
  - Chrome extension display name updated to **"Unquote - Escaped JSON Expander & JSONL Viewer"**
  - Cloudflare Web Analytics added to the web app
- Toolbar and record navigation layout tightened for responsive screens.
- Copy actions split into formatted JSON and JSONL outputs.
- Dependency upgrades: Tailwind CSS, Vite, WXT, oxlint, TypeScript, and lockfile.

### Fixed

- Turbo build tasks now depend on upstream package builds.

## [0.1.0] - 2026-04-29

### Added

- **JSON / JSONL Parser** — Local parsing with recursive stringified JSON expansion
  - Single-file JSON browsing
  - Multi-record JSONL browsing (with record navigation TOC)
  - Web Worker background parsing to avoid blocking the main thread
- **Chrome Extension** — Right-click menu to open current page JSON in Unquote
  - Options page configuration
  - Simplified permission model
- **Responsive UI** — Cursor design system
  - Theme switching (light / dark / system)
  - Internationalization (English + Simplified Chinese)
  - File drag-and-drop import
  - Node collapse/expand (stringified JSON nested auto-expansion)
  - Path copy, node value copy, full record copy
  - Virtual list optimization (auto-enabled for >160 nodes)
- **SEO & Branding**
  - og-image, Twitter card, schema.org structured data
  - Canonical links, robots meta tags
- Complete type checking, linting, and unit testing pipeline (Vitest + oxlint)
