# Changelog

> `@unquote/core` and `@unquote/ui` are repository-internal packages that are never
> published to a registry. Entries marked **Breaking** for them describe migrations
> inside this repository, not a notice to external consumers. See
> [`docs/core-distribution.md`](docs/core-distribution.md).

## [1.2.2] - 2026-09-05

### Added

- Added localized product updates pages in English, Simplified Chinese, and Japanese, with direct navigation from the status bar.
- Added theme-aware backgrounds to the import panel and empty state.

### Changed

- Migrated UI icons across the application to Phosphor Icons for a unified visual hierarchy.
- Standardized runtime management on `mise` and upgraded Vitest to version 5, decoupling release verification from hardcoded version checks.
- Cleaned up internal architecture boundaries by scoping module guidance, removing unused path query and expansion helpers, and eliminating the intermediate parse text forwarding layer.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.2.2`.

### Fixed

- Buffered export operations now enforce an explicit byte payload ceiling with localized error feedback, preventing memory exhaustion and tab crashes during heavy exports.
- Copying unhydrated records from local files bounds memory hydration before parsing, preventing runaway memory allocations on oversized lines.
- Full-record Web Worker parsing and search requests are now serialized, preventing worker contention and task queuing under heavy loads.
- Initial Agent session inputs are now parsed only once during ingestion instead of repeating across view initialization, improving first-render responsiveness and memory usage.
- Dropdown radio menus now close automatically upon selecting an option.

## [1.2.1] - 2026-08-31

### Added

- Added privacy-preserving, cookie-less visit tracking to the web app using self-hosted Umami, guarded by automated privacy boundary and bundle budget tests.
- In-memory imports (paste and drop) now enforce an explicit size boundary with localized feedback when an input exceeds safe memory thresholds.

### Changed

- Large local JSONL export now streams and chunks record serialization, eliminating memory spikes and main-thread freezes during high-volume exports.
- Local file record parsing and hydration now run off the main thread in dedicated, reusable Web Workers, keeping navigation and inspection responsive during heavy file operations.
- Local JSONL line scanning and file access logic were unified across parsing and search paths, and obsolete file handles are explicitly released when switching or closing sources.
- Agent conversation turns and trajectory event counts are now derived directly from parsed event streams and linked by conversation ID, reducing internal state complexity.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.2.1`.

### Fixed

- Claude Code turns without explicit prompt IDs now close correctly from subsequent event evidence instead of remaining indefinitely open.
- Number fields inside Agent tool call arguments and results now retain their exact source lexemes without losing precision or mutating large integers.
- The lossless JSON fallback parser now validates source syntax strictly, rejecting malformed input instead of producing invalid nodes.
- Search-driven expansion and manual tree expansion controls are now unified, preventing state divergence and unexpected collapses when toggling nodes after a search.
- Search match indexes are retained across result window updates, avoiding redundant re-indexing and keeping match navigation stable while scrolling.
- JSONPath and jq query paths now evaluate against complete sources rather than partial preview records, preventing incomplete path match results.
- Copy and export operations now strictly reject incomplete or unhydrated preview records, preventing corrupted or empty data output.
- Trajectory detail previews now properly extract and format multi-part content blocks from assistant turns.
- Microsoft Edge Add-ons Japanese store screenshots now use the standard PNG format required for store submissions.

## [1.2.0] - 2026-08-24

### Added

- Added Japanese across the web app, browser extensions, locale-aware metadata, and extension context menus, together with Japanese Chrome Web Store and Edge Add-ons listing copy and screenshots.
- Agent session parsing warnings now show their failure type and source line in the session overview, with a direct action to open the affected Record in JSON.

### Changed

- Detected Agent sessions reach their first usable view sooner and retain less intermediate data: the Agent output is prefetched as soon as detection succeeds, trajectory projection waits until it is needed, and Agent JSONL ingestion avoids eagerly materializing duplicate full-record input. Large-file search and nested-record insight derivation also reuse prior work instead of repeating scans.
- Parser, local-file, query, export, Agent-session, tool-lifecycle, and trajectory projection responsibilities were split into focused modules with narrower state ownership and behavior-oriented test suites, reducing the risk of stale-source updates and making release-critical paths independently verifiable.
- Release checks now cover root tooling sources, pinned GitHub Actions, extension manifest behavior, observable UI bundle budgets, and bounded test-worker concurrency; deployment and supported development dependencies were also updated and pinned where reproducibility requires it.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.2.0`.

### Fixed

- Consecutive layers of stringified JSON now expand recursively, including nested objects, arrays, primitives, and strings, while restore and formatted output preserve the expected value.
- Browser-extension actions, keyboard shortcuts, and selection handoff now open Unquote in a normal tab using the runtime-resolved options URL; legacy message responses remain supported. Safari no longer echoes native messages back to the extension.
- Replacing a Source can no longer let stale parsing, search, copy, or final export work update the new workspace, and trajectory filters are scoped to the current Source Revision. Final copy payloads are validated before clipboard writes.
- Deferred Agent and Trajectory views now present a retryable error state when their code cannot load, while parser, search, file, and export failures preserve useful asynchronous diagnostic details.
- Parser depth options and serialization limits are validated consistently, and byte-bounded serialization now enforces actual encoded size rather than character count.
- Record summaries and insights now rank candidates using full input length and structural depth, avoiding misleading labels from truncated previews or shallower competing fields.

## [1.1.0] - 2026-08-16

### Added

- Added a Trajectory tab beside Agent and JSON that projects a detected Agent session as timed work: turns carry status, duration, and event count, and each item is classified as user, system, assistant, reasoning, tool, subagent, or compaction. Steps that the log does not number itself are labeled as derived rather than presented as source data.
- The trajectory overview draws the session on a time axis: events are colored by kind with failures in red, sparse viewports render each event as a clickable span while dense ones fall back to density-tiered buckets, and idle stretches longer than a quarter of the viewport collapse to a labeled sliver so active clusters get the width.
- A dual-thumb range slider selects a time window that both zooms the overview and filters the ledger, with zoom in / out / reset controls; search, kind, and status filters narrow the ledger further, and the failures metric drills straight into failed items.
- The trajectory detail pane shows the selected item's raw Record JSON inline — call input and result output as separate blocks for tools — bounded at 20k characters, with buttons to open the full Record in the JSON tab. Preview Records state that content is not loaded yet instead of showing an empty block.
- Session metrics report turns, events, tools, failures, duration, and token usage broken down into input, output, cache read, cache write, and reasoning; integrity problems such as unpaired tool calls, duplicate results, out-of-order timestamps, or still-open turns are surfaced as warnings on the affected items.

### Changed

- Trajectory filters now live above the view, so switching to the JSON tab and back keeps the query, kind, status, and time range; they reset when the session itself changes.
- The app header adapts to narrow widths: the wordmark and spacer collapse, tab and source-button padding shrink, and the bar scrolls horizontally instead of crowding the search field.
- Release gates cover the trajectory: projection build time, view readiness, item-selection readiness, and a structural trajectory DOM budget are measured per Agent fixture, and a second 5,005-record synthetic Agent fixture exercises high session volume. Partial benchmark runs now write to an ignored report path instead of overwriting the tracked baseline.
- CI fails on high-severity dependency advisories through a dedicated `pnpm audit:high` gate.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.1.0`.

### Fixed

- Codex shell commands ending in `exec_command_end` now carry their exit status and duration, so the most common tool no longer appears as an untimed, statusless completion. Tool failures are also detected from `isError`, `success: false`, and top-level exit codes, not only from nested metadata, and a failed result with no output text is still reported instead of dropped.
- Claude Code token totals are no longer inflated: usage is counted once per request rather than once per content block, which previously more than doubled session token counts.
- Claude Code turns now close through the transcript's own evidence — the `turn_duration` record, an `end_turn` stop reason, or the turn's last timestamp when the next prompt arrives — so turns no longer stay open forever without a duration, and `compact_boundary` records project as compaction.
- Replacing the source now supersedes in-flight parser work: the previous worker is terminated instead of running to completion in the background.
- The Agent tab is selected once per source rather than every time the detected session's shape changes, so a chosen tab is no longer overridden while records are still streaming in.

## [1.0.1] - 2026-08-13

### Changed

- Selected-node preview, copy, and Agent nested-value rendering are now bounded, so opening or copying a very large value no longer freezes the page; oversized copies report an explicit "too large to copy" state instead of failing silently.
- Structure facts derived from Preview Records are now reported only as far as they are actually known: max depth is hidden while it is a lower bound, and the nested filter is labeled "Top-level nested" when deeper nesting has not been scanned.
- Live import detection reports "at least N lines" when its probe budget is reached, instead of presenting a bounded scan as a complete count.
- Large JSONL now chooses the streaming path from actual file content rather than size alone, so files are routed by what they contain.
- Preview Record JSON detection, Agent session JSONL ingestion, repeated hydration scans, search result materialization, and search existence checks all do less redundant work, keeping large files and long sessions more responsive.
- Regex search without a Web Worker is now refused with localized feedback instead of running an unbounded main-thread scan.
- Agent session events now carry the parser's canonical Record id instead of rebuilding one from line numbers, so opening the underlying JSONL Record cannot drift from the parsed Records. Source Revision ownership and the Record workspace boundary were consolidated into single modules for the same reason.
- Release gates cover more ground: a deterministic synthetic Agent session fixture with its own budgets (`pnpm benchmark:agent`), a search-latency budget, mounted rail-row tracking, Safari host bridge contract tests in both Swift and jsdom, and CI concurrency cancellation plus job timeouts.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.0.1`.

### Fixed

- JSON numbers keep their exact source lexeme through tree labels, search, the inspector, copy, and export; large integers and high-precision decimals are no longer silently rewritten by floating-point conversion, and unsafe materialization is rejected unless approximation is explicitly requested. Preview Records preserve the same lexemes.
- Replacing the source now cancels in-flight exports and file reads, so a download or copy can no longer complete against the previous source.
- Import no longer applies a stale clipboard read or a partially published source candidate, so the panel's text, file, and detected format always describe the same input.
- Expired selected-text handoffs from the browser extension are actively cleaned up instead of lingering in session storage past their lifetime.
- JSON trees with dynamic-height rows are now virtualized correctly, so records containing long values stay scrollable and responsive.
- Virtualized Record rail and tree rows expose their position and total to assistive technology, and the rail announces itself as the Records list.
- The status bar no longer advertises an "↑↓ prev/next match" shortcut that was not bound.
- Dependency updates clear the `nanoid` advisory and pin `esbuild` to 0.28.2 while `tsup` still requests the vulnerable line.
- The staged-file pre-commit gate keeps staged paths that contain whitespace instead of splitting them apart.

## [1.0.0] - 2026-08-07

### Added

- Added a dedicated import flow with a focused empty state, modal source editor, live JSON / JSONL detection, sample inputs, paste / drop / file entry, and explicit format selection.
- Added a persistent selected-node inspector with value and path copy actions plus one-click expansion of stringified JSON.
- Added an Edge Add-ons shortcut alongside the Chrome Web Store link in the web app.

### Changed

- The JSON workspace is now a responsive three-column layout with a virtualized record rail, one selected Record tree, and the node inspector; search, filters, expansion, copy, and export remain directly accessible around that workspace.
- The Agent session view now uses dedicated timeline, conversation, and session-overview columns, with virtualized long sessions, expandable tool call / result details, session metrics, and links back to the canonical JSONL Record.
- Expand All and Collapse All are now explicit side-by-side actions scoped to the selected Record instead of operating across every visible Record.
- Large JSONL rendering now mounts one selected Record tree beside the virtualized rail, substantially reducing retained DOM and memory in the high-record-count release fixture; the release benchmark and its DOM budget were recalibrated to the new workspace.
- Chrome Web Store and Edge Add-ons screenshots were refreshed for the 1.0 interface.
- The development and extension toolchain moved to pnpm 11.20, Vite 8, WXT 0.21, and jsdom 30; obsolete dependency overrides were removed.
- Web and browser-extension app versions, including the Safari host marketing version, bumped to `1.0.0`.

### Fixed

- Large and single-line import drafts no longer block the page during live format detection or show a false unparsable hint merely because the probe budget was reached.
- Virtualized Record-rail and tree rows no longer overlap, and descendants expanded from stringified JSON retain their visual nesting rail.
- Agent timelines now lead with human-readable categories and only show turn numbers actually reported by the session; active tabs, controls, and tool details retain the intended typography and state styling.
- Parse failures are announced once to assistive technology, while loaded-source controls, timeline rows, and workspace headings expose names that match their visible labels.

## [0.13.0] - 2026-07-30

### Added

- Added a native macOS host and reproducible Safari extension build workflow, with Safari-specific permission filtering and CI verification.

### Changed

- Large local JSONL exports now stream records directly from the source file with incremental progress, avoiding full-record hydration and reducing peak memory.
- Large-input paths do less redundant work: checkpointed line scans skip byte copies, single-line JSON auto-detection reuses its strict parse, and search retains highlight ranges only for visible labels.
- When Web Workers are unavailable, synchronous parsing and search are limited to a safe input budget; oversized work stops with localized feedback instead of blocking the page.
- `@unquote/core` and `@unquote/ui` are now explicitly repository-internal packages, removing the unsupported implication that they are published to a registry.
- Safari packaging and benchmark measurements now fail CI when required outputs or budget samples are missing, reducing silent release-gate gaps.
- Web and extension app versions bumped to `0.13.0`.

### Fixed

- The web app no longer loads a remote analytics beacon or allows its endpoint in Content Security Policy.
- Dependency updates and scoped overrides clear five high-severity advisories from the development and extension build chains.
- Parser and search Worker failures now terminate cleanly and reach an explicit error state instead of leaving work pending.
- JSON keys named `__proto__`, `constructor`, `prototype`, or other prototype members remain faithful in previews, search, and path resolution.
- Claude Code sessions now preserve every parallel `tool_result` as its own conversation item with the matching tool-call ID and status.
- Only the newest copy request can write to the clipboard, and superseded file reads stop consuming data instead of completing against stale source state.

## [0.12.0] - 2026-07-27

### Added

- Chrome Web Store and Edge Add-ons submission guides and listing assets under `assets/`.

### Changed

- **Breaking (`@unquote/core`)** — `JsonlRecord` is now a discriminated union of Full, Preview, and Failed records with a required `status` field. Migrate consumers to `isFullRecord`, `isPreviewRecord`, `isFailedRecord`, and `isParsed`.
- **Breaking (`@unquote/core`)** — `JsonNode` is now a discriminated union that stores either container children, a truncated container value, a compact preview, or a typed primitive. The redundant `path`, `wasStringified`, and `meta` fields were removed. Consumers should derive paths and depth while traversing, use the owning `JsonlRecord.lineNumber`, and migrate checks to `hasJsonNodeChildren`, `isStringifiedNode`, and `isTruncatedJsonNode`.
- **Breaking (`@unquote/core`)** — The deprecated `parseDeferredJsonlRecordLine` alias was removed. Use `parsePreviewJsonlRecordLine` instead.
- Large JSONL workflows stay more responsive and retain less memory: streamed insight and overview derivation no longer rescans prior records, local-file search prefilters lines and reuses source revisions, Agent session parsing reuses top-level JSON and loads raw lines on demand, Expand All and expansion-map updates batch per call, and tree keyboard navigation uses index maps instead of full scans.
- Parser, search, query, Agent output, and navigation now share one Source Revision so file switches and superseded work reject stale results before render.
- Agent Session conversation items now belong directly to their timeline event, while a dedicated domain model resolves timeline, conversation, and Record selections through one canonical event-to-Record association.
- The CI performance gate now fails on budget overruns, gating latency budgets on the median of three samples and tracking Expand Path and Expand All readiness.
- Local-file access, tree utilities, workspace session bindings, and related hooks were consolidated into clearer module boundaries with dedicated tests, reducing maintenance and release risk.
- Web and extension app versions bumped to `0.12.0`.

### Fixed

- Expand All now works for local-file Preview Records and expands every nested stringified JSON level in one click.
- Display and preview truncation now preserves Unicode surrogate pairs instead of splitting emoji and other multi-unit characters.
- Search no longer reports key matches that are not visible in the tree, and long truncated values keep highlight ranges aligned with the displayed text.
- Aborted in-process fallback searches no longer overwrite the active query results.
- File export downloads no longer revoke the Blob URL before the browser finishes the download.

## [0.11.0] - 2026-07-23

### Added

- Repository installs now configure a lightweight pre-commit gate that formats-checks staged TypeScript, TSX, CSS, and JSON files, lints staged TypeScript and TSX, then runs type checking.

### Changed

- Streamed JSONL appends now update record lookup, selection reconciliation, file overview, and record insights incrementally, avoiding repeated full-record scans as large files arrive.
- Command palette and file overview transitions, hover hints, tree expansion targets, keyboard focus states, and muted text contrast were refined while preserving reduced-motion behavior.
- Tree display derivation, global shortcuts, toolbar summaries, and overview / insight field extraction now live in focused shared modules with dedicated tests, reducing UI maintenance and release risk.
- Web and extension app versions bumped to `0.11.0`.

### Fixed

- Changing the source or search inputs no longer briefly exposes stale matches, and regex search remains available when Web Workers are unavailable.
- Keyboard navigation now keeps non-virtualized tree rows in view, while overview controls, row actions, field labels, and status badges expose consistent accessible and localized states.
- Parse errors no longer show a potentially incorrect caret when the unexpected token appears more than once in the input.

## [0.10.0] - 2026-07-18

### Added

- Pull requests that affect parsing or rendering now publish a non-blocking benchmark report for performance tracking.
- The web app now ships a Content Security Policy.

### Changed

- The web app no longer stores source input in the URL hash and clears legacy source hashes on load, so payloads are not retained in shared URLs or browser history.
- Repeated searches, mixed-validity JSONL parsing, and streamed record or Agent session updates now reuse work and publish fewer intermediate snapshots, improving responsiveness under sustained JSONL workloads.
- Dropdown motion, progress feedback, toolbar sizing, and semantic state colors were refined while preserving reduced-motion behavior.
- The development baseline moved to Node.js 24, TypeScript 7, and Vitest 4, with coverage thresholds added to the release quality gate.
- `@unquote/core` now exposes only documented parser capabilities; the implementation-only `buildNode`, `detectFormat`, `expandNode`, `extractSummary`, `isJsonContainer`, and `summarizePrimitive` exports were removed.
- Web and extension app versions bumped to `0.10.0`.

### Fixed

- Regex searches no longer fall back to blocking the main thread when Web Workers are unavailable, and very large result sets no longer overflow match aggregation.
- The Simplified Chinese extension manifest now uses a localized application name.

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
