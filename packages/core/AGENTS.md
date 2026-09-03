# Core Parser Guide

`@unquote/core` is a framework-free TypeScript library published as ESM and CommonJS. Its public
entry points and exported types are defined by `package.json`, `src/index.ts`, and
`src/ingestion.ts`.

## Data Model

- `JsonNode` has Full and Preview forms. Read `src/types.ts` rather than reproducing the union in
  documentation or call sites.
- Normal containers own `children`; truncated containers own `value` and `truncated: true`;
  Preview containers own `childCount` and `preview: true`.
- Expanded Stringified JSON is represented by `rawString`. A Preview string can mark the same
  boundary with `stringifiedPreview: true`.
- String nodes carry `valueLength` when the displayed value is truncated.
- Parsed number nodes carry `rawValue`, the exact source lexeme, alongside the numeric value.
- Path, depth, and Record ownership belong to traversal context, not to `JsonNode`.
- Use `isParsed`, `isFullRecord`, `isPreviewRecord`, and `isFailedRecord` from `src/records.ts`
  instead of rebuilding Record-state checks.

## Parser and Serialization

- `parseInput` detects JSON or JSONL and recursively expands stringified JSON within `maxDepth`.
- `lossless-json.ts` owns number-lexeme preservation, including the fallback for runtimes without
  native parse context.
- `json-probe.ts` owns the cheap-then-strict check for Stringified JSON. Reuse it for Preview
  detection instead of adding another probe.
- `stringifyJsonNode` and `materializeNode` preserve number lexemes. `materializeNode` rejects
  numbers that cannot round-trip unless the caller explicitly requests approximate numbers.
- `restoreNode` rebuilds selected expanded nodes as raw strings. Do not add UI behavior here.

## Verification

Parser and serialization behavior belongs in `packages/core/tests/`. Add or update tests when a
change affects parsing, truncation, Stringified JSON, number preservation, error metadata, or
public serialization behavior.

During iteration, use the Core package scripts. Run the repository-level `pnpm check` before
handing off a production behavior change.
