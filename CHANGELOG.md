# Changelog

## [0.2.0] - 2026-05-02

### Added

- **Search & Filter** — Real-time search experience similar to browser Ctrl+F
  - Real-time search across key, value, and path dimensions
  - JSONPath / jq syntax path search (e.g., `$.timestamp`)
  - Regular expression search toggle
  - Case-sensitive search toggle
  - Match text highlighting (dual styles for normal match + active match)
  - Previous / next buttons for cyclic navigation with auto-scroll to target node
  - Virtual list support (`scrollToIndex`) and non-virtualized `scrollIntoView` dual modes
  - Auto-expansion of collapsed stringified paths when match is inside
  - Match count display (`3/15` format)
- New i18n keys: `search.placeholder`, `search.regex`, `search.caseSensitive`, `search.prev`, `search.next`, `search.clear`, `search.jq`

### Changed

- SEO metadata unified to **"Unquote - Escaped JSON Expander & JSONL Viewer"**
  - Webpage title / description / og / twitter / schema
  - og-image.svg title and subtitle
  - Chrome extension `appName` (en / zh_CN)
- Dependency upgrades

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
