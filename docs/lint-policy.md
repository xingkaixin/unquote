# Lint policy

Judge a rule by the maintenance problems it prevents. Judge each finding separately:
fix an unnecessary escape hatch, document a necessary exception, or correct the rule
when it rejects a sound pattern. Existing violations alone are not a reason to
disable a useful rule.

The root `.oxlintrc.json` enables 14 generic anti-slop rules and Oxlint's native
accumulating-spread rule at error severity. Effect rules are not enabled because
the workspace has no direct Effect dependency. Tests follow the same policy as
production code.

## Rule decisions

| Rule | Decision | Maintenance rationale and legitimate exceptions |
| --- | --- | --- |
| `no-array-filter-map` | Off | Two linear passes are not inherently a performance bug. Combining them can change callback order, indexes, and sparse-array behavior. Optimize measured hot paths. |
| `no-reduce-accumulator-copy` | Error | Repeatedly copying a growing accumulator can create quadratic work. Fresh local mutation is allowed. |
| `oxc/no-accumulating-spread` | Error | Covers growing spread accumulators. One incremental-derivation test deliberately retains consecutive immutable snapshots; only that loop is exempt. |
| `no-chained-type-assertions` | Error | Double assertions erase evidence. Limited platform fixtures and Node APIs missing from ES2022 typings carry local explanations. |
| `no-conditional-empty-object-spread` | Off | Conditional omission is intentional with `exactOptionalPropertyTypes`; an absent property differs from a property containing `undefined`. |
| `no-known-value-widening` | Error, adjusted | Keep known domain structure. Accept concrete anonymous object contracts without requiring an otherwise unnecessary type alias. Raw recursive fixtures and dynamic lookup tables have local exceptions. |
| `no-module-mocking` | Error | Avoid coupling ordinary tests to module internals. Local exceptions cover unavailable browser APIs, observable side effects, fault injection, and traversal-count regression boundaries. They do not justify production dependency-injection layers solely for tests. |
| `no-object-parameters` | Error | Domain inputs should expose the fields their owners require. |
| `no-reflect-apply` | Error | Prefer direct invocation when the callable contract is known. |
| `no-reflect-get` | Error | Prefer typed property access. Proxy traps retain `Reflect.get` to preserve receiver semantics; the browser benchmark also reads a separately evaluated global timing value. |
| `no-runtime-typeof` | Off | Runtime narrowing is a normal part of decoding arbitrary JSON and handling non-Error exceptions. The blanket ban conflicts with this application's input boundary. |
| `no-shape-in-symbol-names` | Off | A lexical naming ban does not distinguish redundant implementation names from useful domain vocabulary. Review names in context. |
| `no-unknown-parameters` | Error | Application operations should accept domain inputs. Decoders, error normalization, cancellation reasons, and generic transport boundaries retain `unknown` locally. |
| `no-unknown-returns` | Error | Return a concrete contract after normalization. Generic JSON materialization and unvalidated browser responses retain `unknown` at their boundary. |
| `no-unknown-type-aliases` | Error | A renamed `unknown` should not masquerade as a domain model. |
| `no-unsafe-dictionary-type` | Error, scoped option | Domain dictionaries need concrete values. Four decoder/formatter files allow direct `unknown` values; `any`, `object`, empty-object values, and unsafe unions remain rejected. Other raw storage and malformed fixture exceptions stay on individual declarations. |
| `no-widen-then-assert` | Error | Preserve the owner's type instead of discarding it and asserting it back later. |
| `require-readable-spacing` | Error, adjusted | Separate module and named function/class/type declarations, while keeping local bindings, short control flow, and overload groups together. |
| `require-safety-comment-for-type-assertion` | Error | Remove redundant assertions. For a necessary assertion, state the invariant TypeScript cannot establish with `SAFETY:` immediately beside it. `as const` is exempt. |

The `allowUnknownValues` option is limited to these files:

- `packages/core/src/lossless-json.ts`
- `packages/ui/src/lib/agent-session/agent-value-format.ts`
- `packages/ui/src/lib/agent-session/claude-adapter.ts`
- `packages/ui/src/lib/agent-session/codex-adapter.ts`

These modules inspect raw JSON fields before returning normalized values. A decoder
dictionary is not a replacement for a typed application model. The option defaults
to false and does not disable other rules in those files.

## Findings from the initial adoption

The unmodified preset reported 4,157 diagnostics. These were policy findings,
including overlapping diagnostics, rather than 4,157 independent bugs.

| Initial findings | Assessment and action |
| --- | --- |
| 3,518 spacing diagnostics | Most demanded blank lines inside ordinary local control flow. Narrowed the rule and applied the remaining structural spacing changes separately from code cleanup. |
| 158 assertions lacking a safety explanation; 19 chained assertions | Removed redundant browser/Worker and DOM assertions, typed mocks from their actual interfaces, used real `MessageEvent` objects, and documented necessary parser or platform invariants. |
| 80 unknown parameters; 11 unknown returns; 48 unsafe dictionaries | Several test and transport contracts could reuse their owner's type. Raw JSON, arbitrary thrown values, and malformed input fixtures require a deliberate boundary exception. |
| 18 known-value widening diagnostics | Concrete anonymous return contracts were false positives. Dynamic-key lookup and recursively nested fixtures need local exceptions. |
| 25 module mocks | Removed a no-op Sonner mock. Remaining mocks isolate browser/platform behavior, observe side effects, or inject failures and traversal probes. |
| 10 reflective reads | Proxy forwarding and a browser benchmark bridge are legitimate exceptions. |
| 148 conditional spreads; 120 runtime type checks | Normal application patterns; the blanket rules were disabled for the reasons above. |
| One filter/map chain; one accumulating spread | No demonstrated need to rewrite the linear pipeline. The spread belongs to a test retaining immutable stream snapshots, so only that loop is exempt. |

## Maintaining exceptions and upgrades

Use `oxlint-disable-next-line` for the smallest relevant statement, with a concrete
reason after `--`. Do not exempt an entire test directory or hide an escape hatch
behind a new alias. Reassess the exception if its owner or input contract changes.
Unused disable directives are errors, so removed violations cannot leave stale
exceptions behind.

Vendored code and local agent assets are excluded from application lint and format
checks. Root configuration and vendored rule files are explicit Turbo lint inputs.
Oxlint and `@oxlint/plugins` must move together at exactly matching versions.

The source revision and local rule changes are recorded in
[`tools/oxlint/anti-slop/UPSTREAM.md`](../tools/oxlint/anti-slop/UPSTREAM.md).
Preserve them when updating. CLI regression tests in `scripts/tests/anti-slop.test.ts`
cover the adjusted rules, exception scope, unused exceptions, documentation
attachment, and lint/formatter stability.
