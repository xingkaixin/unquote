# Chrome Web Store Listing — Unquote

Last Updated: 2026-09-06

This document records repository-derived listing information. Dashboard-only fields below
must be confirmed before a store submission; this change does not submit a release.

## Store Listing

**Extension Name:** Unquote - Escaped JSON Expander & JSONL Viewer

**Short Description:** Expand stringified JSON and browse JSONL locally.

**Detailed Description:**

Expand escaped JSON and browse JSONL files on your device. Search records, inspect nested
values, copy data, and export formatted results. Recognized agent logs provide conversation
and trajectory views.

Open Unquote from the toolbar or keyboard shortcut, then paste text or open a local file.
You can also select text on a page and choose Open in Unquote from the context menu. If the
selection cannot be imported, Unquote explains how to paste it manually or open a file.

**Category:** Developer Tools (proposed; confirm dashboard selection).

**Single Purpose:** Inspect and expand JSON and JSONL data locally.

**Primary Language:** English; Chinese and Japanese translations are included.

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Present | apps/extension/public/icon128.png |
| Store screenshots | 1280×800 or 640×400 | Confirm existing dashboard assets | Not tracked here |

Screenshot refresh: capture the selection-import recovery message if documenting this change.

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

The shared stylesheet references Google Fonts, which can cause external font requests;
therefore the listing must not claim that the extension makes no network requests.

This change puts only a handoff identifier or failure marker in the viewer URL, never the
selected text, and removes that parameter after processing. Failure messages contain no
selected text. Data is not sold, used for unrelated purposes, or used for lending decisions.

## Privacy Policy

**Privacy Policy URL:** Confirm the current published URL in the dashboard before submission.

## Distribution & Developer Info

**Existing listing:** https://chromewebstore.google.com/detail/unquote/ohcepfneflaihakpkkgmnbdgjhnmcjeg

**Homepage:** https://unquote.xingkaixin.me/

**Support:** https://github.com/xingkaixin/unquote/issues

**Publisher, contact email, visibility, regions:** Confirm current dashboard settings.

## Version History

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| Unreleased (after repository version 1.2.2) | 2026-09-06 | Explain failed selection imports and clear consumed import parameters to avoid repeat warnings on refresh. | Draft |

## Review Notes

No store submission or dashboard verification was performed for this change. Existing
selection storage, one-time claiming, and expiry behavior are preserved.
