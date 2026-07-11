# Virtualization Architecture

This document records the UQ-57 investigation into a shared virtualization seam. The conclusion is
to keep the five current implementations separate. They share rendering mechanics, but not enough
behavioral invariants to justify one interface.

## Current implementations

| Collection | Scroll owner | Activation rule | Size model | Programmatic navigation | Additional invariants |
| --- | --- | --- | --- | --- | --- |
| Record list | Window | More than 160 records | Dynamic, 260px estimate, 12px gap | Record start | Maintains window scroll margin and active-record tracking |
| Agent conversation | Window | More than 160 items | Dynamic, 96px estimate, 12px gap | Selected item center | Maintains window scroll margin and non-virtual item refs |
| Agent timeline | Element | More than 160 events | Dynamic, 54/76px estimate, 4px gap | None | Estimate depends on preview presence |
| Table of contents | Element | More than 160 records | Dynamic, 64px estimate, 4px gap | None | Lives in a constrained flex scroll container |
| JSON tree | Element | More than 180 eligible rows | Dynamic, 38px estimate | Keyboard auto; search center | Disables virtualization for long or multiline values and coordinates hydration |

All five collections use `@tanstack/react-virtual`, render a total-size spacer, position visible rows
with `translateY`, and measure mounted rows. These are library usage details rather than a product
interface: callers still need to own row rendering, selection semantics, and scroll behavior.

## Seam decision

A shared `VirtualCollection` module is rejected. Its interface would need to expose:

- window versus element scrolling;
- window-relative `scrollMargin` measurement and resize handling;
- collection-specific activation thresholds and eligibility checks;
- fixed, conditional, or dynamic size estimates and gaps;
- stable item identity;
- start, center, and auto navigation alignment;
- virtual and non-virtual selection behavior;
- active-record observation, keyboard navigation, and deferred hydration hooks.

The deletion test fails: deleting such a module would restore only the spacer, transform, and
measurement boilerplate, while removing its interface would eliminate most of the configuration
knowledge. The proposed module would therefore be shallow.

## Local seams considered

The two window-scrolling collections duplicate scroll-margin measurement. The three
element-scrolling collections duplicate the absolute-row shell. Neither extraction is currently
recommended:

- a window-margin hook would have only two consumers and would leave navigation and measurement
  behavior in each caller;
- an absolute-row wrapper would require polymorphic DOM ownership because Timeline renders a
  button, TOC renders a div containing multiple controls, and JSON Tree renders an interactive tree
  row.

These extractions can be reconsidered only if a third consumer appears with the same behavioral
contract, or if a production bug must otherwise be fixed independently in multiple collections.

## Verification contract

Virtualization changes must preserve the existing characterization coverage for:

- threshold behavior and bounded rendered-row counts;
- dynamic row measurement;
- window and element scrolling;
- selected-item and search-target navigation;
- active-record tracking;
- JSON Tree keyboard navigation and deferred hydration.

Run `pnpm --filter @unquote/ui test` for focused validation and `pnpm check` before merging.
