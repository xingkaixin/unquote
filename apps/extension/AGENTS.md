# Browser Extension Guide

The WXT extension reuses `UnquoteApp` in its options page. `entrypoints/background.ts` owns the
context menu, keyboard shortcut, action click, and selection handoff through
`browser.storage.session`.

## Browser Builds

- `wxt.config.ts` owns the browser-conditional manifest. `wxt.safari.config.ts` only changes the
  output directory.
- The Safari build must omit `clipboardRead`; Safari does not support that permission.
- Selection handoff depends on `storage.session`. On older Safari versions, opening an empty
  editor is the compatibility fallback.
- Keep manifest localization catalogs aligned across `en`, `zh_CN`, and `ja`.

## Verification

Use the extension package tests for background, distribution, and manifest behavior. Run
`pnpm build:safari` when changing WXT configuration, permissions, background handoff, or Safari
packaging.
