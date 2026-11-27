# Chrome Web Store Listing — Unquote

Last Updated: 2026-11-27

This document records repository-derived listing information. Dashboard-only fields below
must be confirmed before a store submission; this change does not submit a release.

## Store Listing

**Extension Name:** Unquote - Escaped JSON Expander & JSONL Viewer

**Short Description:** Expand stringified JSON and browse JSONL locally.

**Detailed Description:**

Expand escaped JSON and browse JSONL files and SSE event streams on your device. Search
records, inspect nested values, copy data, and export formatted results. Recognized agent logs provide conversation
and trajectory views. Track Claude Code subagent activity, see reported session costs and
timing, inspect API errors and retries, and filter tool calls from per-tool summaries.

Open each SSE event as a record with expanded JSON data and source line references. Decode
JWT headers and payloads without signature verification, and view supported timestamps in
local time and UTC without changing the original values.

Compare JSON by path, build filtered record tables, inspect field presence and types, and
export matching rows as CSV. Select source lines and redact specified fields before
copying or downloading problem excerpts as Markdown or JSONL. Select Agent conversation turns
from a floating bar to preview, copy, and download redacted Markdown reports with full source
content, source line references, and paired tool calls and results.

Open Unquote faster with a lighter initial bundle, drop files anywhere onto an active
workspace, step through search matches with Enter / Shift+Enter, and keep search and record
filters accessible on narrow screens.

Open Unquote from the toolbar or keyboard shortcut (reusing an open Unquote tab when present),
then paste text or open a local file. You can also select text on a page and choose Open in
Unquote from the context menu. If the selection cannot be imported, Unquote explains how to
paste it manually or open a file.

**Category:** Developer Tools (proposed; confirm dashboard selection).

**Single Purpose:** Inspect and expand JSON, JSONL, and SSE event data locally.

**Primary Language:** English; Chinese and Japanese translations are included.

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Present | apps/extension/public/icon128.png |
| Store screenshots | 1280×800 or 640×400 | Confirm existing dashboard assets | Not tracked here |

Screenshot refresh: capture JSON comparison, record tables with field profiles, redacted
report previews, and selection-import recovery messages for the current listing; include
narrow-screen toolbar layouts. For 1.2.5, include SSE event records, decoded inspector values,
Agent turn report previews, and Claude Code subagent activity and tool summaries.

## Permissions Justification

| Permission | Purpose |
| --- | --- |
| alarms | Remove temporary selected text that was not imported. |
| contextMenus | Let users open selected page text in Unquote. |
| storage | Temporarily hold selected text while the viewer opens. |
| clipboardRead | Support importing copied files through the paste workflow. |

No host permissions are requested. This change adds no permissions.

## Privacy & Data Use

JSON content is processed locally. Selected text is held in session storage, removed when
claimed, and scheduled for cleanup after five minutes if unclaimed. Theme and language
preferences are stored locally. No JSON upload or analytics code was found in the reviewed
extension and shared UI sources.

SSE parsing, JWT and timestamp decoding, Agent summaries, and turn report generation run
locally. JWT decoding does not verify signatures or contact an authentication service.
Reports redact only the paths the user specifies and download to the user's device.

Fonts are bundled with the extension. The shared stylesheet no longer requests Google Fonts.

This change puts only a handoff identifier or failure marker in the viewer URL, never the
selected text, and removes that parameter after processing. Failure messages contain no
selected text. Data is not sold, used for unrelated purposes, or used for lending decisions.

## Privacy Policy

**Privacy Policy URL:** Confirm the current published URL in the dashboard before submission.

## Distribution & Developer Info

**Existing listing:** https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg

**Homepage:** https://unquote.xingkaixin.me/

**Web Guides (include in store description updates):**
- JSON Unescape: https://unquote.xingkaixin.me/json-unescape/
- JSONL / NDJSON Viewer: https://unquote.xingkaixin.me/jsonl-viewer/
- Claude Code, Codex & MCP Agent Log Viewer: https://unquote.xingkaixin.me/agent-log-viewer/
- SSE Stream Viewer: https://unquote.xingkaixin.me/sse-viewer/

**Support:** https://github.com/xingkaixin/unquote/issues

**Publisher, contact email, visibility, regions:** Confirm current dashboard settings.

## Version History

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 1.2.6 | 2026-11-27 | Cut initial UI JavaScript by roughly 41% and accelerate large-file parsing, streaming, search, and Trajectory views; add window drag-and-drop, Copy Markdown for reports, floating Agent turn report bar, and search match stepping/filter chips; improve search routing, Agent message selection and tool collapse, JSON tree navigation, SSE metadata handling, and extension tab reuse. No permission or extension data-use changes. | Prepared; not submitted |
| 1.2.5 | 2026-10-26 | Add SSE event viewing, JWT and timestamp decoding, Agent turn reports, Claude Code subagent activity and reported totals, per-tool summaries and API retry details; correct Codex tool completion failures and timing. No permission or extension data-use changes. | Prepared; not submitted |
| 1.2.4 | 2026-10-10 | Reduce parsing and view-loading delays, run submitted searches immediately, and improve narrow-screen toolbars and search placeholder contrast. No permission or extension data-use changes. | Prepared; not submitted |
| 1.2.3 | 2026-09-13 | Add JSON comparison, filtered tables and CSV export, field profiles, and redacted problem reports; improve large-record copy/export, selection-import recovery, and hover feedback; bundle fonts locally. | Prepared; not submitted |
| Unreleased (after repository version 1.2.2) | 2026-09-06 | Explain failed selection imports and clear consumed import parameters to avoid repeat warnings on refresh. | Draft |

## Review Notes

No store submission or dashboard verification was performed for this change. Existing
selection storage, one-time claiming, and expiry behavior are preserved.
