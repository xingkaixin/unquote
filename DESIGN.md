# Unquote Design System

This document describes the design system currently shipped by Unquote. It applies to the shared
UI package, the web app, and the browser extension.

## Source of truth

Runtime tokens in `packages/ui/src/styles.css` are the executable source of truth. This document
names token roles and usage rules; it deliberately does not copy color or size values, so read the
stylesheet for current values.

When the implementation and this document disagree:

1. preserve current runtime behavior unless a visual migration is explicitly approved;
2. update tokens and this document in the same pull request;
3. verify both light and dark themes in the web app and extension.

Do not introduce product tokens only in this document. Do not copy visual systems, proprietary
fonts, or component rules from another product without an explicit migration decision.

## Product character

Unquote is a dense developer tool for reading JSON, JSONL, and agent sessions. Its interface should
feel precise, quiet, and operational:

- cool neutral surfaces keep syntax and status colors legible;
- orange marks action, active selection, attention, and the product identity;
- compact type and small radii support information density;
- full-height panes separated by borders hold the workspace; rounded panels group content inside
  a pane;
- motion communicates state changes and never delays work.

The visual system is not a marketing-site theme. Readability, scanning speed, keyboard use, and
large-data stability take priority over decorative expression. The import empty state is the one
place that shows themed artwork, and only at desktop widths.

## Tokens

Use semantic Tailwind tokens such as `bg-surface-100`, `text-text-secondary`, and `border-border`.
Use the lower-level CSS variables only for effects that cannot be expressed through the theme.
Dark mode redefines the same tokens under the `.dark` class on `<html>`; it is a first-class theme,
not a color inversion.

| Group | Tokens | Use |
| --- | --- | --- |
| Canvas | `--background`, `--foreground` | Page background and default text |
| Surfaces | `surface-100` | Panes, panels, dialogs, menus |
| | `surface-50` | Inputs and raised emphasis |
| | `surface-200` | Hover fills and grouped controls |
| Text | `text-primary` | Main content |
| | `text-secondary` | Labels and supporting content |
| | `text-tertiary` | Metadata, placeholders, section labels |
| Borders | `border` | Default separation |
| | `border-medium` | Controls, overlays, hover emphasis |
| Accent | `accent`, `accent-hover`, `accent-soft` | Active state, focus outline, selection fill |
| Status | `success`, `error`, `warning` | Valid, failed, and attention states |
| Syntax | `code-key`, `code-string`, `code-number`, `code-boolean`, `code-null` | JSON values |
| Event dots | `--dot-error`, `--dot-tool`, `--dot-message`, `--dot-event` | Record and event markers |
| Elevation | `--shadow-panel`, `--overlay` | Menus, dialogs, and their backdrop |

Components must use semantic tokens so theme changes do not require component-level color
overrides. Hard-coded white is reserved for content placed on the accent fill.

Semantic colors communicate meaning. Do not use success or error colors as general decoration.
`warning` shares the accent hue, so use it only where a label makes the state unambiguous.
Syntax color supplements text and structure; it must not be the only indicator of selection,
errors, expansion, or focus.

## Typography

Fonts are bundled from pinned Fontsource variable packages through `packages/ui/src/fonts.css`:

- `IBM Plex Sans Variable` (`--font-sans`) is the UI typeface;
- `JetBrains Mono Variable` (`--font-mono`) is used for JSON, paths, metadata, tabs, and labels.

Fallback stacks are part of the tokens and must remain usable if a font fails to load.

The base UI is 13px. Common roles are:

| Role | Treatment |
| --- | --- |
| Standard content | 12–13px sans |
| Buttons and compact text | `uq-text-11` (11px / 16px) |
| JSON, paths, search | 11.5–12px mono |
| Section labels | `.uq-label`: 10.5px mono, uppercase, `--tracking-tag`, `text-tertiary` |
| Tabs | 11px mono, uppercase |
| Status tags | 10–10.5px mono with a one-pixel border |

Dense screens should establish hierarchy through grouping, spacing, and text roles before adding
larger type or heavier weights.

## Shape and elevation

Radius tokens map to structural roles:

| Token | Use |
| --- | --- |
| `rounded-xs` | Status tags, keyboard hints, small icon buttons |
| `rounded-sm` | Compact 24px controls |
| `rounded-md` | Buttons, inputs, tab lists and triggers, hover highlight |
| `rounded-lg` | Panels and drop zones inside a pane |
| `rounded-xl` | Dialogs, dropdown menus, command palette |

Do not add arbitrary intermediate radii. A new radius must represent a reusable structural role.

Panes and panels are flat: a surface and a one-pixel border, no shadow. `--shadow-panel` is
reserved for transient overlays such as menus and dialogs.

## Layout

- The application shell fills the viewport; panes scroll independently.
- The header wraps on narrow screens instead of truncating primary actions.
- Source import occupies the empty state or a dialog; a loaded source does not keep an input
  editor.
- At 64rem and above, the JSON and Agent workspaces place fixed-width navigation and detail panes
  around a flexible center pane. Trajectory omits the navigation pane.
- Below 64rem, the navigation pane stacks above the center pane and the detail pane becomes a
  bounded bottom disclosure.

Keep the central data-bearing pane flexible with `min-width: 0`. Use truncation for metadata, and
scroll code or long JSON values.

## Components

### Buttons

Buttons use rounded-md corners, `uq-text-11` sans labels, a visible focus outline, and a
one-pixel active translation. The shared variants in `components/button.tsx` are:

- `default`: transparent with a medium border; hover turns the border and label accent;
- `outline`: surface fill with a subtle hover fill;
- `ghost`: transparent chrome for secondary actions;
- `secondary`: accent fill for the primary action;
- `selected`: accent border on `accent-soft` for a toggled-on state.

Default height is 36px; compact height is 28px. Icon-only controls use `.uq-icon-button` and reach a
minimum 44×44px hit area on coarse pointers.

### Tabs and menus

Tab lists sit on `surface-100` with a border; the active trigger takes the accent fill. Tabs and
dropdown menus share one decorative hover highlight (`components/fluid-hover.tsx`). Click targets
and keyboard behavior stay with Base UI. Virtualized lists do not use this effect.

### Inputs and overlays

Inputs sit on a transparent or `surface-50` background and show focus with an accent border or
outline. Every input needs an
accessible label; placeholder text is supporting context, not a label. Dialogs, menus, and the
command palette use `rounded-xl`, `surface-100`, a medium border, and `--shadow-panel`.

### JSON and record views

JSON rows prioritize alignment and scanability. Keys and values use the syntax palette, paths use
mono text, and selection combines structural styling with color. Large collections may virtualize,
but virtual and non-virtual paths must remain visually equivalent.

## Icons

Use regular-weight SVGs from `@phosphor-icons/core` only. Import them with the `?react` suffix so
the shared SVGR build transform emits React components containing only the selected weight.
Standard sizes are:

- `size-3` for inline micro-actions;
- `size-3.5` for most controls;
- `size-4` for prominent actions.

Icons supplement labels and accessible names. Do not communicate a state through an icon alone.

## Motion

The default interactive transition is 150ms for color, background, border, and shadow.

Use `--ease-out` for short entrances, exits, and disclosure. Dropdowns and dialogs transition
transform and opacity for 180ms; disclosures (`.uq-collapse`) animate their grid rows for 180ms.
The hover highlight uses a short, non-bouncing spring.

Respect `prefers-reduced-motion: reduce`:

- pulses and row entrance animations stop;
- transform, progress, and disclosure transitions become immediate;
- overlays fade without scaling;
- active button translation is removed and the hover highlight snaps instead of travelling.

Do not animate layout continuously, animate large JSON collections, or add motion that delays
search, parsing, selection, or navigation.

## Accessibility

- Preserve visible `focus-visible` outlines using the accent token.
- Maintain semantic roles and keyboard behavior provided by Base UI primitives.
- Provide accessible names for icon-only controls.
- Do not rely on color alone for errors, success, active selection, or syntax meaning.
- Preserve 44px touch targets for icon controls on coarse pointers.
- Verify both themes and reduced-motion behavior for new interactive states.

## Governance checklist

Before merging a visual change:

1. Reuse an existing semantic token or explain why a new role is required.
2. Update `packages/ui/src/styles.css` and this document together when token roles change.
3. Use shared components and `@phosphor-icons/core` rather than local replacements.
4. Check light mode, dark mode, keyboard focus, coarse-pointer targets, and reduced motion.
5. Run `pnpm check`; add focused UI tests when behavior or accessibility changes.

This document should describe shipped behavior. Aspirational redesigns belong in a proposal or
issue until their migration is approved and implemented.
