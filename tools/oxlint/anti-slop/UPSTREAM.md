# Vendored anti-slop

Source repository: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

Source commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`.

Source directory: `skills/install-anti-slop/assets/anti-slop/` at that commit.
The enclosing skill tree is `89044d21c75a367eac1ddbaf208e650b1a7d5820`.

Installed on 2026-09-11 using the local skill's `scripts/install.mjs`.
Every copied file was compared byte-for-byte with the source directory at the
commit above. The comparison matched; this revision identifies the copied assets.

## Installed paths and integration

- Generic plugin: `tools/oxlint/anti-slop/index.ts`.
- Optional Effect plugin: `tools/oxlint/anti-slop/effect/index.ts`.
- Stylistic source, license, and provenance: `tools/oxlint/anti-slop/vendor/eslint-stylistic/`.
- Root `.oxlintrc.json` enables 14 generic rules and `oxc/no-accumulating-spread`
  at error severity. Four blanket rules are off after project-specific review;
  see [`docs/lint-policy.md`](../../../docs/lint-policy.md) for every decision.
  Effect rules are inactive because no workspace manifest directly depends on Effect.
- `oxlint` and `@oxlint/plugins` are pinned together at `1.81.0`.
- Lint and format ignore the copied plugin and local agent assets.
- Turbo lint inputs include the root lint configuration and copied plugin.

## Intentional deviations

- `shared/dictionary-types.ts` and `rules/no-known-value-widening.ts`: a concrete
  anonymous object contract is no longer classified as an escape hatch. Open
  dictionaries and actual widening targets remain checked.
- `rules/require-readable-spacing.ts`: keep spacing around module and named
  function/class/type declarations, but do not force blank lines around ordinary
  local bindings, returns, or control flow. Preserve overload grouping.
- `shared/dictionary-types.ts` and `rules/no-unsafe-dictionary-type.ts`: add
  `allowUnknownValues`, defaulting to false. The project opts in for four raw JSON
  decoders/formatters. Other unsafe dictionary values remain rejected, including
  additional unsafe index signatures beside an allowed unknown-valued signature.
- Added this provenance record. The copied bundle has no upstream tests; project
  CLI regressions live in `scripts/tests/anti-slop.test.ts`.

The byte comparison above describes the pristine installation before these
intentional changes. Recover that baseline from the recorded source directory
and commit when comparing future updates.

Preserve `vendor/eslint-stylistic/LICENSE` and its `UPSTREAM.md` when updating.
Compare updates against the source directory at the recorded commit, retain
local changes, and upgrade both Oxlint packages together.
