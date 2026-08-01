# Reglet Manager Design Contract

This document records durable interaction, information-design, and visual-system
decisions from the approved repositioning and reviewed manager surface.

## Product Model

The interface always distinguishes four ownership zones:

1. **Library** — canonical, editable, versioned, and optionally synced.
2. **Providers** — generated projections that are previewed and explicitly
   applied, never directly edited in Reglet.
3. **Projects** — read-only discovery sources with machine-local provenance.
4. **Connections** — optional sync and remote access, both off by default.

Artifact lifecycle and projection state are separate. `active` and `archived`
describe canonical lifecycle. `pending`, `applied`, `drifted`, `missing`,
`blocked`, and `error` describe a provider projection. Typed issues explain
shadowing, missing secrets, lossy conversion, limits, invalid sources,
permissions, and unsupported fields without expanding the primary status model.

## Navigation

The primary destinations are Library, Project Inbox, Providers, Activity, and
Settings. Search and the command palette are global. Sync state is visible but
does not become primary navigation when sync is disabled.

The Library is a workbench: filters and search, artifact list, inspector/editor,
then projection preview and Apply. Project Inbox is a triage surface organized
around New, Changed, Promoted, Conflict, and Ignored states. Provider pages lead
with effective configuration rather than unrelated raw settings.

## Interaction Contracts

- Valid canonical edits autosave. Invalid structured edits visibly become
  “Draft not applied.”
- Apply is always explicit and provider failures are isolated.
- Promotions of scoped instructions require a scope-conversion choice.
- Project sources never expose an edit action.
- Provider files offer Reveal and Open in External Editor.
- Archive is the default removal action. Permanent deletion names affected
  providers, pending removals, retention, and recovery consequences.
- Archive, delete, detach, reapply-over-drift, restore, and root removal use
  inline confirmation sheets unless leaving context would be dangerous.

## Responsive Behavior

Desktop uses a resizable workbench with list and inspector visible together.
Compact widths collapse to one navigable pane while preserving selection,
unsaved draft state, and command access. No consequential action may be
available only through hover or a desktop-only context menu.

## Accessibility

Status always combines text, iconography, and optional color. Preview, diff,
validation, scope conversion, and destructive confirmations follow a logical
focus order and announce asynchronous results. Editors and diff engines are
lazy-loaded, but their loading and failure states remain keyboard accessible.

## Performance Contract

The initial shell excludes editors and diff engines. Search is backed by SQLite
FTS5. Project scans run outside the UI thread with bounded concurrency, and
filesystem invalidations are debounced and coalesced by repository and provider
target.

## Visual System

The manager uses a Raycast-style desktop workbench: dense but calm information,
restrained neutral surfaces, fine separators, compact controls, and a coral-red
accent reserved for focus, primary actions, and meaningful state. Light and dark
themes are co-primary and share the same hierarchy rather than treating light
mode as an inversion afterthought.

Desktop navigation, artifact collection, content, and projection inspection form
a stable multi-pane shell. Command-palette access is a signature interaction,
with keyboard shortcuts visible at the point of action. Panels use subtle depth
and controlled translucency; oversized cards, decorative gradients, pill-heavy
layout, and marketing-page composition are outside this product language.

Typography favors native system UI for controls and editorial reading, with
monospace reserved for paths, revisions, configuration, and diff content.
Animation is brief and functional—selection, disclosure, and sheet transitions—
and is removed when reduced motion is requested.

