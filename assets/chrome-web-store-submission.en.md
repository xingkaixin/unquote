# Unquote Chrome Web Store Submission Materials (English)

> Target version: 0.12.0  
> Extension ID: `ohcepfneflaihakpkkgmnbdgjhnmcjeg`  
> Default locale: English.

## 1. Store listing

### Name

Unquote - Escaped JSON Expander & JSONL Viewer

The name comes from the packaged `en` manifest locale. If it changes, update
`apps/extension/public/_locales/en/messages.json`; changing only the Developer
Dashboard is not sufficient.

### Summary

Expand stringified JSON and browse JSONL locally.

This is the packaged manifest description and is under the 132-character limit.

### Detailed description

Unquote is a local JSON and JSONL viewer that detects JSON encoded inside string
values and expands it into a readable, interactive tree. It is designed for API
responses, logs, AI model output, and agent tool-call transcripts.

Key features:

- Automatically detect JSON and JSONL and recursively expand stringified JSON
- Explore nested data with an interactive tree, paths, types, and syntax highlighting
- Search keys, values, and JSONPath expressions across records
- Browse JSONL records with success, error, nested-path, and field summaries
- Recognize Codex and Claude Code logs and show conversations, tool calls, and timelines
- Copy or export processed JSON and JSONL
- Open or drop local files, or send selected JSON text from a page through the context menu
- Choose light, dark, or system theme
- Process all content locally without sending it to developer or third-party servers

Unquote requires no account, contains no advertising, and does not track browsing
activity.

### Category and additional fields

| Field | Recommended value |
|---|---|
| Category | Developer Tools |
| Homepage URL | `https://unquote.xingkaixin.me/` |
| Support URL | `https://github.com/xingkaixin/unquote/issues` |
| Mature content | No |
| In-app purchases | No |
| Visibility | Public |
| Regions | All available regions |

## 2. Graphic assets

Chrome Web Store supports up to five localized screenshots per locale. Upload
these four English screenshots in this order:

1. [Dark theme: recursive JSON expansion](chrome-web-store-screenshot-en-dark-json-tree-1280x800.png)
2. [Dark theme: agent session view](chrome-web-store-screenshot-en-dark-agent-session-1280x800.png)
3. [Light theme: JSONL search](chrome-web-store-screenshot-en-light-jsonl-search-1280x800.png)
4. [Light theme: error diagnostics](chrome-web-store-screenshot-en-light-error-diagnostics-1280x800.png)

Global graphic assets:

- [128×128 store icon](../apps/extension/public/icon128.png)
- [300×300 brand logo](logo-300x300.png)
- [440×280 small promo tile](chrome-web-store-small-promo-440x280.png)
- [1400×560 marquee promo tile](chrome-web-store-marquee-1400x560.png)

The small and marquee promo tiles are global and cannot be localized.

## 3. Privacy practices

### Single purpose

Locally parse, expand, search, and display JSON, JSONL, and agent logs that the
user explicitly provides.

### Permission justifications

#### `contextMenus`

Adds “Open in Unquote” to the text-selection context menu. The extension reads
selected text only after the user invokes this menu item and opens it in the
Unquote page. It does not automatically read page content.

#### `storage`

Uses `chrome.storage.session` to hand user-selected text to the newly opened
Unquote page. The value stays in the current browser session for at most five
minutes and is deleted immediately after the first read. The extension does not
use this permission to build profiles or sync content between devices.

#### `clipboardRead`

Reads clipboard file content only during a user-initiated paste when the
clipboard represents a JSON or JSONL file. The extension does not read, poll, or
monitor the clipboard in the background.

### Host permissions

No host permissions are requested. The extension cannot read arbitrary pages,
browsing history, cookies, or network traffic.

### Remote code declaration

Select:

> No, I am not using remote code.

Explanation:

> All JavaScript and WebAssembly, if any, is packaged with the extension. The
> extension does not download, load, or execute remotely hosted code.

### Data-use disclosure

The extension handles data explicitly provided by the user:

- User-generated content: JSON / JSONL entered, pasted, opened, or dropped by the user
- Website content: only text the user selects and submits through “Open in Unquote”

Handling details:

- Data is processed only on the user's device in the extension page and session storage
- Data is not transmitted to developer or third-party servers
- Data is not used for advertising, analytics, credit assessment, personalization, or unrelated purposes
- Data is not sold or shared, and is not made available for human review
- Local file content normally remains in page memory and is released after the page is refreshed or closed
- Context-menu handoff data is retained for no more than five minutes and deleted after the first read
- Theme and locale preferences may be stored in browser-local storage
- Content reaches the clipboard or a downloaded file only after an explicit copy or export action

Review the data-type checkboxes against the definitions shown in the Developer
Dashboard at submission time. Do not claim that the extension handles no user
data: local-only processing still counts as handling under the current policy.

### Limited Use certification

The following statements can be certified:

- Data handling is limited to the extension's disclosed single purpose
- User data is not sold or transferred to third parties
- User data is not used for purposes unrelated to the single purpose
- User data is not used for creditworthiness or lending
- User data is not made available for human review

## 4. Privacy policy draft

Before submission, publish this section on a publicly accessible HTTPS page and
enter that URL in the Developer Dashboard. Suggested location:
`https://unquote.xingkaixin.me/privacy`. Do not submit this suggested URL until
the page is live.

### Unquote Privacy Policy

Effective date: July 24, 2026

Unquote is a browser extension that locally parses and displays JSON, JSONL, and
agent logs on the user's device.

#### Data we handle

Unquote handles only content the user explicitly enters, pastes, opens, drops,
or submits through the page-selection context menu. This content may include
user-generated content or website text selected by the user. The extension may
also store theme and language preferences locally.

#### How data is used

The content is used only to parse, expand, search, display, copy, or export JSON
and JSONL on the user's device. It is not used for advertising, analytics,
profiling, or any unrelated purpose.

#### Storage and retention

Parsed content normally remains only in memory in the current extension page.
Text submitted through the context menu is temporarily transferred using
Chrome session storage, retained for no more than five minutes, and deleted
immediately after the first read. Theme and language preferences may remain in
browser-local storage until the user clears extension data.

#### Transfer and sharing

Unquote does not send user-provided content to developer or third-party servers,
does not sell or share user data, and does not make that content available for
human review.

#### Permissions

The extension uses the context-menu permission to provide “Open in Unquote,”
session storage to temporarily transfer user-selected text between extension
pages, and clipboard-read permission only when the user pastes a JSON or JSONL
file. It requests no website host permissions.

#### User controls

Users can clear current input, close the extension page, clear extension
storage, or uninstall the extension to remove local data. Copying and exporting
occur only after an explicit user action.

#### Policy changes

If our data-handling practices change, we will update this policy and provide
any prominent notice required by Chrome Web Store policy before the new
practice begins.

#### Contact

For questions or privacy requests, open an issue at:
`https://github.com/xingkaixin/unquote/issues`

Unquote's use of information complies with the Chrome Web Store User Data
Policy, including the Limited Use requirements.

## 5. Reviewer notes

Use the following as test instructions or reviewer notes:

> Unquote requires no login or test account. Click the extension icon to open
> the main page. Use the built-in samples below the input: choose “Escaped API
> response” to verify recursive expansion, “Codex rollout JSONL” to verify the
> agent-session view, and “Mixed valid/invalid JSONL” to verify per-line error
> diagnostics. The extension requests no host permissions and performs all
> parsing locally.

Context-menu test:

1. Select a JSON string on any webpage.
2. Right-click and choose “Open in Unquote.”
3. A new extension page opens with the selected text.

Keyboard shortcut:

- Windows / Linux: `Ctrl+Shift+U`
- macOS: `Command+Shift+U`

## 6. Pre-submission checklist

- Run `pnpm check`
- Run `pnpm zip-extension`
- Confirm that `manifest.json` is at the root of the ZIP
- Confirm that the version is higher than the currently published version
- Upload the four localized English screenshots
- Upload the four localized Simplified Chinese screenshots
- Upload the 440×280 small promo tile
- Optionally upload the 1400×560 marquee promo tile
- Confirm that the privacy-policy URL is public and reachable
- Confirm that store disclosures, privacy policy, and code behavior agree
- After submission, check review status, warnings, and distribution scope

## 7. Official references

- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/best-listing
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/permissions/

