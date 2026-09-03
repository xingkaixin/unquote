# Unquote Design System

This document describes the design system currently shipped by Unquote. It applies to the shared
UI package, the web app, and the browser extension.

## Source of truth

Runtime tokens in `packages/ui/src/styles.css` are the executable source of truth. This document
explains their intended use; it does not define a separate visual direction.

When the implementation and this document disagree:

1. preserve current runtime behavior unless a visual migration is explicitly approved;
2. update tokens and this document in the same pull request;
3. verify both light and dark themes in the web app and extension.

Do not introduce product tokens only in this document. Do not copy visual systems, proprietary
fonts, or component rules from another product without an explicit migration decision.

## Product character

Unquote is a dense developer tool for reading JSON, JSONL, and agent sessions. Its interface should
feel precise, quiet, and operational:

- neutral surfaces keep syntax and status colors legible;
- orange marks action, attention, and the product identity;
- compact typography and square controls support information density;
- rounded cards separate major work areas without making every control soft;
- a subtle dot grid gives the workspace texture while preserving contrast;
- motion communicates state changes and never delays work.

The visual system is not a marketing-site theme. Readability, scanning speed, keyboard use, and
large-data stability take priority over decorative expression.

## Token architecture

Use semantic Tailwind tokens such as `bg-surface-100`, `text-text-secondary`, and `border-border`.
Use the lower-level CSS variables only for effects that cannot be expressed through the theme.

### Light theme

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Canvas | `--background`, `--canvas` | `#f2f2ef` | Page and workspace background |
| Primary surface | `--color-surface-100`, `--surface` | `#ffffff` | Cards, dialogs, active tabs |
| Raised surface | `--color-surface-50`, `--surface-raised` | `#f7f7f4` | Inputs, subtle emphasis |
| Surface step 2 | `--color-surface-200` | `#f2f2ef` | Hover and grouped controls |
| Surface step 3 | `--color-surface-300` | `#e6e6e1` | Stronger separation |
| Surface step 4 | `--color-surface-400` | `#d2d2cc` | Disabled or structural emphasis |
| Surface step 5 | `--color-surface-500` | `#b2b2ac` | Muted structural color |
| Display text | `--color-text-display` | `#000000` | Product name and strongest headings |
| Primary text | `--color-text-primary` | `#1a1a18` | Main content |
| Secondary text | `--color-text-secondary` | `#5c5c55` | Labels and supporting content |
| Tertiary text | `--color-text-tertiary` | `#6c6c65` | Low-emphasis metadata |
| Muted text | `--color-text-muted` | `#97978f` | Placeholders and disabled context |
| Border | `--color-border` | `#e6e6e1` | Default separation |
| Border medium | `--color-border-medium` | `#d2d2cc` | Hover, focus-adjacent emphasis |
| Border strong | `--color-border-strong` | `#6c6c66` | High-contrast edges |

### Dark theme

Dark mode is activated by the `.dark` class on `<html>`. It is a first-class theme, not a color
inversion.

| Role | Value |
| --- | --- |
| Canvas | `#000000` |
| Primary surface | `#111111` |
| Raised surface | `#1a1a1a` |
| Structural surfaces | `#222222`, `#333333`, `#666666` |
| Display text | `#ffffff` |
| Primary text | `#e8e8e8` |
| Secondary text | `#a6a6a6` |
| Tertiary text | `#8f8f8f` |
| Muted text | `#7d7d7d` |
| Default border | `#222222` |
| Medium border | `#333333` |

Components must use semantic tokens so theme changes do not require component-level color
overrides. Hard-coded black is reserved for backdrops or the dark canvas; hard-coded white is
reserved for content placed on the accent fill.

## Semantic color

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Accent | `#f26522` | `#f26522` | Primary active state, focus outline, product LED |
| Accent hover | `#ff7a36` | `#ff7a36` | Interactive emphasis |
| Success | `#2f8a4c` | `#4a9e5c` | Valid records and completed states |
| Error | `#d71921` | `#d71921` | Parse failures and destructive/error feedback |
| Warning | `#f26522` | `#f26522` | Tool warnings and attention states |

Semantic colors communicate meaning. Do not use success or error colors as general decoration.
Orange may carry both brand and warning meaning only where surrounding labels make the state
unambiguous.

## JSON syntax color

Syntax colors are semantic and theme-aware:

| JSON role | Light | Dark |
| --- | --- | --- |
| Key | `#6c6c66` | `#9b9b95` |
| String | `#3a7d52` | `#7bb389` |
| Number | `#9a6a33` | `#d6a76a` |
| Boolean | `#46689e` | `#88a6d2` |
| Null | `#a8a8a2` | `#5f5f5a` |

Syntax color supplements text and structure; it must not be the only indicator of selection,
errors, expansion, or focus.

## Typography

The project loads three Google Fonts in `packages/ui/src/styles.css`:

- `Space Grotesk` is the default UI sans-serif;
- `Space Mono` is used for JSON, paths, metadata, commands, and technical labels;
- `Doto` is the display voice and should remain limited to distinctive brand moments.

Fallback stacks are part of the tokens and must remain usable if remote fonts fail to load.

The base UI is 13px. Common roles are:

| Role | Typical treatment |
| --- | --- |
| Card or pane title | 13px, medium, `-0.01em`, display text |
| Standard content | 12–13px, normal or medium |
| Search and code | 11.5–12px mono |
| Metadata | 11px mono, uppercase, `0.08em` tracking |
| Badge | 9px mono, bold, uppercase, `0.12em` tracking |

Use weight and contrast sparingly. Dense screens should establish hierarchy through grouping,
spacing, and text roles before adding larger type.

## Shape and elevation

The shape system intentionally contrasts square controls with rounded containers:

- `--radius-sm: 0px` and `--radius-md: 0px` keep buttons, tabs, badges, and compact inputs square;
- `--radius-card: 16px` defines primary cards and sticky toolbars;
- `--radius-overlay: 12px` defines dialogs, popovers, and command surfaces;
- `--radius-lg: 16px` is available to Tailwind utilities for large containers.

Do not add arbitrary intermediate radii. A new radius must represent a reusable structural role.

Default cards are flat: white or dark surfaces, a one-pixel semantic border, and no shadow.
Elevation is reserved for overlays and transient emphasis:

- `--shadow-sm` is none;
- `--shadow-md` and `--shadow-lg` use the same restrained ambient shadow;
- `--shadow-glass` combines an inset highlight with ambient elevation for translucent surfaces.

## Layout and spacing

Use Tailwind's spacing scale and existing component patterns. The current interface commonly uses:

- 4–8px gaps for icons, badges, and compact controls;
- 10–16px internal padding for cards and toolbars;
- 12–14px gaps between major workspace regions;
- a 52px fixed-height application header;
- a full-viewport application shell with independently scrolling panes.

Source import occupies the empty state or a dialog; a loaded source does not retain an input
editor. At viewport widths of 64rem and above, the JSON and Agent workspaces place fixed-width
navigation and detail panes around a flexible center pane. Trajectory omits the navigation pane
and uses a flexible center pane plus a fixed-width detail pane. Below 64rem, an optional navigation
pane stacks above the center pane and the detail pane becomes a bounded bottom disclosure.

Keep the central data-bearing pane flexible with `min-width: 0`. Reserve fixed widths for
navigation and detail panes, use truncation for metadata, and scroll code or long JSON values.

## Components

### Buttons

Buttons use mono uppercase labels, square corners, a visible focus outline, and a one-pixel active
translation. The shared variants are:

- `default`: transparent surface with a medium border;
- `outline`: white/dark surface with subtle hover fill;
- `ghost`: transparent chrome for secondary actions;
- `secondary`: orange fill for active or primary emphasis.

Default height is 36px; compact height is 28px. Icon-only controls use `.uq-icon-button` and reach a
minimum 44×44px hit area on coarse pointers.

### Cards

Cards are the main structural container. They use `--radius-card`, `surface-100`, a default border,
and a slightly stronger hover border. Headers use a bottom divider; content generally uses 16px
horizontal and 10px vertical padding.

### Tabs and badges

Tabs are square, compact, mono, and grouped on `surface-200`. The active tab moves to
`surface-100` and display text. Badges are 9px uppercase metadata; most are borderless, while danger
badges retain an error border.

### Inputs and command surfaces

Inputs sit on transparent or raised neutral surfaces and use border changes for focus-within.
Command surfaces use `--radius-overlay`, `surface-100`, a medium border, and overlay elevation.
Every input needs an accessible label; placeholder text is supporting context, not a label.

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

The default interactive transition is 150ms for color, background, border, and shadow. Component
transitions may include transform when the movement communicates pressing or state change.

Use `--ease: cubic-bezier(0.4, 0, 0.2, 1)` for branded ambient motion. The status LED pulses at
2.4s; error attention may use a faster 1.6s pulse.

Use `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for short UI entrances, exits, and determinate
progress. Anchored dropdowns transition transform and opacity for 180ms from their trigger origin;
determinate progress transitions transform for 150ms without animating layout.

Respect `prefers-reduced-motion: reduce`:

- decorative pulses stop;
- progress and transform transitions become immediate;
- active button translation is removed.

Do not animate layout continuously, animate large JSON collections, or add motion that delays
search, parsing, selection, or navigation.

## Accessibility

- Preserve visible `focus-visible` outlines using the accent token.
- Maintain semantic roles and keyboard behavior provided by Base UI primitives.
- Provide accessible names for icon-only controls.
- Do not rely on color alone for errors, success, active selection, or syntax meaning.
- Keep text and controls usable when remote fonts fail.
- Preserve 44px touch targets for icon controls on coarse pointers.
- Verify both themes and reduced-motion behavior for new interactive states.

## Governance checklist

Before merging a visual change:

1. Reuse an existing semantic token or explain why a new role is required.
2. Update `packages/ui/src/styles.css` and this document together when token intent changes.
3. Use shared components and `@phosphor-icons/core` rather than local replacements.
4. Check light mode, dark mode, keyboard focus, coarse-pointer targets, and reduced motion.
5. Run `pnpm check`; add focused UI tests when behavior or accessibility changes.

This document should describe shipped behavior. Aspirational redesigns belong in a proposal or
issue until their migration is approved and implemented.
