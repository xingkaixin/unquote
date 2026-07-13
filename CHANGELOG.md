# Changelog

## [0.9.0] - 2026-07-13

### Changed

- Large JSONL workflows now keep high-record-count navigation, Agent timelines and conversations, search, overview updates, and deferred hydration responsive with virtualization, worker-based processing, incremental indexing, and lower retained memory.
- Workspace layout and controls now provide a more consistent responsive structure, semantic page navigation, accessible control states, reduced-motion support, and system-theme application before the first render.
- Agent session details and interface copy now stay localized consistently, including timestamps.
- Web and extension app versions bumped to `0.9.0`.

### Fixed

- JSONL record-scoped expansion and Agent raw-record hydration now resolve the selected record instead of leaking state across records.
- JSONL formatting now emits valid line-delimited output, and restore-path matching no longer confuses path segments with substrings.
- Deep native JSON containers are bounded during parsing to avoid unbounded recursion.
- Stale file reads, superseded search workers, extension selection handoffs, and oversized inbound URL hashes no longer overwrite current state or leave work running unnecessarily.
- Pasted filenames, localized labels, theme preference persistence, and keyboard / screen-reader interactions now retain the expected state.

## [0.8.0] - 2026-07-03

### Changed

- The release quality gate now runs in GitHub Actions with type checking, linting, tests, and oxfmt formatting checks.
- Parser, agent-session detection, source loading, export actions, record pipeline, tree walking, and streaming parser updates were split into focused modules with dedicated tests to reduce future release risk.
- Web and extension app versions bumped to `0.8.0`.

### Fixed

- Copying after a JSONPath / jq path jump no longer loses raw key metadata or throws when copying the selected node.
- File import and deferred local-file reads now surface failures with toast feedback instead of failing silently.
- Clipboard write failures during copy actions now show user-visible errors.
- Parser workers are terminated cleanly when parsing is superseded or the component unmounts.

## [0.7.0] - 2026-06-29

### Added

- Agent session view automatically detects Codex rollout and Claude Code JSONL transcripts, then presents session metadata, conversation turns, reasoning, tool calls/results, timeline events, and the matching raw JSONL record.
- Sample inputs now include a Codex rollout JSONL session for exercising the Agent view.

### Changed

- Recognized agent logs now open in a dedicated Agent / JSON tabbed output so users can switch between the session lens and the normal expanded JSON tree.
- The main UI was tightened around the source pane, record navigation, tree rows, and agent detail panels, replacing the old standalone Path Inspector / status footer flow with inline record and node actions.
- Web and extension app versions bumped to `0.7.0`.

## [0.6.0] - 2026-06-19

### Added

- Copy and export now surface blocked large clipboard operations and long-running exports through responsive toast feedback.

### Changed

- Expand All and Collapse All were merged into one state-aware toolbar toggle.
- Copy and export actions now live in the overflow menu, and copy/export always emit the expanded object form instead of restoring stringified JSON back to escaped raw strings.
- Large JSONL export now chunks record serialization, and formatted JSON array export now streams record output without changing the exported bytes.
- Local JSONL source access, path parsing / formatting, and command/search/path interaction state were split into focused modules with dedicated tests.
- Web and extension app versions bumped to `0.6.0`.

### Fixed

- Large copy and export operations no longer freeze the tab while building one giant string on the main thread.
- Clicking a TOC record now keeps that record highlighted during smooth scroll instead of being overwritten by scroll-spy updates.

## [0.5.0] - 2026-06-05

### Added

- **Command palette** — Added a `Cmd/Ctrl+K` panel for search, path jumps, filter changes, and command discovery.
- Browser performance marks now cover parse, search, row building, and expansion hot paths to make release profiling easier.

### Changed

- Search and JSONPath / jq-style path jump now share a compact toolbar input, with match navigation and status inline.
- Copy, export, and restore actions were consolidated into a single overflow menu while keeping Expand All as the primary action.
- Large local JSONL files now transfer deferred preview records first and hydrate full records only when needed, reducing memory pressure for high-record-count files.
- Record filtering was simplified to explicit modes for all records, matches, errors, nested records, tools, messages, and events.
- Web and extension app versions bumped to `0.5.0`.

### Fixed

- Large JSONL imports no longer keep every full parsed record in UI memory before the user opens or copies a record.

## [0.4.0] - 2026-05-24

### Added

- **GitHub Open Graph image** — Added a PNG social preview image for GitHub link cards.

### Changed

- Large JSONL imports now use a faster streamed rendering path, with more incremental parser updates and less main-thread work before records become visible.
- JSONL hot paths were optimized for line indexing, path matching, tree traversal, and worker transfer payloads.
- File overview and record insight calculation now reuse cached results more effectively while records stream in.
- URL hash compression is isolated behind dedicated helpers and covered by web app tests.
- Benchmark tooling now includes a high-record-count case 4 fixture generator for release stress testing.
- Web and extension app versions bumped to `0.4.0`.

### Fixed

- AGENTS.md instruction blocks no longer get classified as error records just because the instruction text contains words such as `error`.

## [0.3.0] - 2026-05-17

### Added

- **File Overview** — High-level diagnostics for JSON / JSONL imports
  - Total, successful, failed, nested-record, and max-depth counters
  - Top nested JSON paths and common `event` / `type` / `tool` values
  - Error previews with jump-to-record actions
  - Shortcuts from overview items into path navigation and search
- **Record Insight Lens** — Per-record summaries for log, agent, and tool-call JSONL
  - Classifies records as errors, tools, messages, or events
  - Extracts common fields such as timestamp, level, status, role, event, tool, error, and message
  - Shows insight chips in record cards and the record navigation sidebar
  - Adds filters for tools, messages, events, and arbitrary insight field values
- **Focus and extraction tools** — Path Inspector actions for isolating and copying data
  - Focus a selected subtree and exit focus without losing the selected path
  - Copy subtree, escaped string, raw value, and a debug bundle for the selected node
  - Export currently visible records as JSONL or formatted JSON
- **Sample inputs** — One-click examples for escaped API responses, agent tool-call JSONL, and mixed valid / invalid JSONL.

### Changed

- Large JSONL files now keep full source records available for copy / export while transferring compact preview nodes to the UI.
- Record lists are window-virtualized at large record counts, with lazy record hydration preserved for tree rows.
- File import and render benchmarks can target selected fixtures and use real file input paths.
- Web and extension app versions bumped to `0.3.0`.
- Web social preview metadata now points to a PNG Open Graph image.

### Fixed

- Search, copy, export, path jumps, and focus state now continue to work after large JSONL imports where preview string values are compacted.
- Focused subtrees are cleared when the current search or record filter moves outside the focused path.

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
