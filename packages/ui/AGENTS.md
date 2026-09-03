# UI Guide

`@unquote/ui` owns the shared React application, domain hooks, design system, and Agent-session
presentation used by the web and extension apps. Its public entry points are defined by
`package.json`, `src/index.ts`, and `src/i18n/index.ts`.

## Ownership

- `src/app.tsx` is the application composition root. Domain state may live in focused hooks and
  should be passed through explicit component interfaces.
- `use-record-workspace.ts` owns the combined Record workspace model: query interaction,
  revision-scoped selection, local-file hydration, export actions, and selected-node projection.
- `use-workspace-session.ts` owns revision-scoped Record, node, and Agent-detail selection plus
  scroll intent and Stringified JSON expansion state.
- `use-output-view.ts` owns Agent, Trajectory, and JSON output selection. It may default to Agent
  only once per Source Revision; streaming records must not override the user's selected tab.
- `use-trajectory-filters.ts` owns Trajectory filters above the view so tab switches preserve
  them. Reset them when the session model changes.
- `lib/published-source.ts` and `lib/source-revision.ts` own stale-result rejection. Do not
  reproduce revision checks ad hoc.
- `lib/jsonl-ingestion.ts` is the shared JSONL ingestion path for parsing and Agent detection. A
  line should not be parsed again to build another view.
- `lib/json-walk.ts` is the shared `JsonNode` traversal for tree rendering, search, overview, and
  Record insight.

## Agent and Trajectory Sessions

- Session detection runs only for JSONL and recognizes Codex rollout and Claude Code transcript
  records.
- Adapters emit evidence: tool calls, results and completions, turn lifecycle, token usage, model
  output, subagent activity, and compaction. Presentation belongs outside adapters.
- `lib/agent-session/tool-correlation.ts` owns call, result, and completion pairing across
  adapters and Trajectory projection.
- Integrity problems attach warnings to the affected item instead of failing the whole session.
- Agent conversation and timeline selections must retain their canonical JSONL Record linkage.
- Invalid lines collected during Agent-session ingestion become parse warnings rather than
  disabling an otherwise recognized session.
- Keep performance-sensitive thresholds and release budgets in `docs/performance.md` and
  `docs/virtualization.md` instead of duplicating their values here.

## Search and Record Hydration

- Search options support regex, case sensitivity, and jq path matching. Regex and jq are mutually
  exclusive; enabling one disables the other.
- Search results retain Record ids, paths, match ranges, and Stringified JSON ancestor paths.
- Resolve a Preview Record to a Full Record before scrolling to or copying data that is outside
  the available preview.
- Keep large-file search and hydration cancellable. Results from superseded work must not publish.

## UI Conventions

- Put reusable components in `src/components/` and reusable app logic in `src/hooks/` or
  `src/lib/` according to ownership.
- Use Tailwind CSS v4 utilities and the tokens in `src/styles.css`. Use an arbitrary value only
  when no existing token or utility represents the required value.
- Use `lucide-react` for interface icons. The normal sizes are `size-3`, `size-3.5`, and `size-4`.
- Keep dark mode on the `.dark` class applied to `<html>`.
- Add every new translation key to `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, and `src/i18n/ja.ts`.
  `en.ts` defines the canonical message schema.
- Do not introduce an external state library without a concrete need. Prefer the existing
  composition roots and focused domain hooks.

## Verification

- UI tests use Vitest, React Testing Library, and jsdom.
- Mock `Worker` using the established helpers and patterns in the app test suites.
- Agent-session parser or adapter changes require focused coverage in the relevant files under
  `packages/ui/tests/`, including canonical Record linkage and warning behavior when affected.
- Run the narrow UI suite while iterating, then run the repository-level `pnpm check` before
  handing off production behavior changes.
