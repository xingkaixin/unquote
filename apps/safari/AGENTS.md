# Safari Host Guide

`apps/safari` is the version-controlled macOS host created from the browser extension. The
extension target consumes generated resources produced by `pnpm build:safari`.

## Distribution Constraints

- Do not rerun `xcrun safari-web-extension-converter`. Rebuild and synchronize resources with
  `pnpm build:safari`.
- `Unquote Extension/Resources` and `xcuserdata` are generated or local state and do not belong in
  git.
- Keep the app and extension bundle identifiers nested as
  `com.xingkaixin.unquote` and `com.xingkaixin.unquote.extension`.
- Keep the deployment target compatible with macOS 12 unless a release decision changes the
  supported platform.
- `Unquote/Resources/Base.lproj/Main.html` is the complete host window shown during App Review.
  `Script.js` rewrites `.state-*` paragraphs, so those elements must remain text-only.
- `Unquote/SafariHostContract.swift` owns accepted JavaScript messages and extension-state
  commands. Keep the native tests and `tests/host-script.test.ts` aligned with that contract.

## Release

Follow `docs/release-guide.md` for versioning, signing, archiving, and upload. Do not encode release
state or current store status in this guide.
