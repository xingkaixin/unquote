# Virtualization Architecture

This document records the current result of the shared-virtualization seam investigation. UQ-57
established the original decision; v1.0.0 replaced the old Record list and table of contents with the
Record workspace, UQ-177 made JSON Tree measurement comprehensive, and UQ-184 deepened workspace
ownership. Those changes update the implementation inventory, but they do not create a useful shared
product interface.

## Current implementations

`rg -l "useVirtualizer" packages/ui/src --glob '*.tsx'` resolves exactly four owners:

| Collection and owner | Scroll owner | Activation | Size and measurement | Navigation and invariants |
| --- | --- | --- | --- | --- |
| Record rail — `components/record-rail.tsx` | Its `scrollRef` element | More than 160 Records | Fixed 86px row, overscan 12; CSS height must equal the estimate | Record `ScrollIntent` centers the target; non-virtual navigation uses the same element scroller. Stable Record IDs survive filtering and streamed append. |
| Agent timeline — `components/agent-timeline-pane.tsx` | Its `scrollRef` element | More than 160 Agent Events | Fixed 44px row, overscan 12 | Selection highlights the canonical Record; the pane has no programmatic selection scroll. |
| Agent conversation — `components/agent-conversation-pane.tsx` | Its `scrollRef` element | More than 160 Conversation Items | Dynamic, 96px estimate, 24px gap, overscan 4; every mounted virtual item is measured | Selection centers an item. Expanded tool details change height; the non-virtual path keeps item refs for equivalent navigation. |
| JSON tree — `components/json-tree.tsx` | Its `parentRef` element | More than 180 display rows | Dynamic, 24px estimate, overscan 12; every mounted virtual row is measured and keyed by stable row ID | Keyboard navigation uses auto alignment and search/path intent centers its target. Long and multiline values remain virtualized; Preview Record expansion delegates Full Record resolution to workspace actions. |

`WorkspaceColumns` deliberately owns no overflow. Each collection therefore resolves a real element
scroller in both desktop columns and the stacked narrow layout. In every virtual branch,
`@tanstack/react-virtual` provides the total size and visible indexes while the owner renders an
absolute row translated by its virtual start. Only the two dynamic-height collections call
`measureElement`; the fixed-height collections instead enforce their estimate in row CSS.

## Seam decision

A shared `VirtualCollection` module remains rejected. Its interface would have to expose:

- collection-specific thresholds, overscan, gaps, estimates, measurement, and stable identities;
- fixed-height enforcement versus dynamic measurement refs;
- no navigation, Record intent, selected-item centering, or tree keyboard/search navigation;
- virtual and non-virtual behavior that must remain equivalent;
- Record filtering/append semantics, expandable Agent tool details, tree active-descendant state, and
  Preview-to-Full Record intent;
- the button, article wrapper, or ARIA tree-row DOM owned by each collection.

The deletion test still fails. Removing that proposed module would restore a small options object,
the total-size spacer, and `translateY` mapping in each owner. It would not duplicate the behavioral
rules above, while deleting the shared interface would remove most of its configuration surface.
That is a shallow module, not a deep seam.

## Smaller seams considered

The current inventory has two apparent pairs, but neither supports an extraction:

- Record rail and Agent timeline both use fixed rows, threshold 160, and overscan 12. Their shared
  code is a few virtualizer options; only the rail owns navigation and streamed Record identity.
- Agent conversation and JSON Tree both measure dynamic rows. Their gaps, overscan, selection,
  remeasurement triggers, non-virtual refs, keyboard behavior, and row DOM are different.

An absolute-row wrapper across all four would also need polymorphic DOM and ref ownership: the fixed
collections position buttons directly, conversation measures a wrapper around an article, and JSON
Tree passes measurement into its ARIA row component. These seams should be reconsidered only when a
new consumer shares one complete behavioral contract, or when the same production bug otherwise
requires independent fixes in multiple owners.

## Verification contract

Virtualization changes must preserve the characterization coverage in:

- `tests/record-rail.test.tsx`: threshold, bounded rows, exact fixed height, and Record intent scroll;
- `tests/agent-timeline-pane.test.tsx`: threshold, bounded rows, and fixed row geometry;
- `tests/agent-conversation-pane.test.tsx`: threshold, selected-item navigation, bounded rows, and
  dynamic measurement;
- `tests/json-tree-virtualized.test.tsx`: bounded long/multiline rows, stable measurement after
  expansion and collapse, keyboard navigation, and search/path intent.

Run `pnpm --filter @unquote/ui test` for focused behavior and `pnpm check` before merging. The source
inventory command above must continue to return the same number of documented owners.
