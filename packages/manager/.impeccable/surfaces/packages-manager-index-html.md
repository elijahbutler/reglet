---
version: 1
slug: "packages-manager-index-html"
primary_target: "packages/manager/index.html"
related_targets: ["packages/manager/src/styles.css","packages/manager/src/app.js"]
---

## Scope

Primary target: `packages/manager/index.html`

Mode: Operate. This surface is the production local manager for canonical
artifacts, provider projections, project intake, and optional remote access and
sync. `?mock=1` supplies representative data for design review.

## User job

Developers must be able to select a canonical artifact, edit or preview it,
understand how each provider will receive it, recognize drift or blockers, and
apply safe projections explicitly. Project content remains a read-only intake
source.

## Chosen direction

Raycast-style midnight command center, pinned by the user from the Refero style
reference. The approved composition is the persistent four-pane workbench in
`.impeccable/mocks/manager-workbench.png`.

The memorable interaction is the projection inspector: Desired, Applied, and
Observed remain visible beside the canonical editor, while the global command
palette makes every consequential workflow keyboard-accessible.

## Implementation inventory

| Comp commitment | Implementation medium |
|---|---|
| Compact title and command bar | Semantic HTML and CSS |
| Persistent primary navigation | Semantic buttons with authored SVG icon system |
| Searchable lifecycle-aware artifact index | FTS5-backed runtime search with bounded DOM rendering |
| Dominant Markdown editor and preview | Textarea, sanitized HTML preview, CSS |
| Provider projection list and inspector | Semantic buttons and structured mock state |
| Desired/Applied/Observed comparison | HTML data rows and monospace hashes |
| Command palette | Native dialog, search, and keyboard navigation |
| Apply feedback and isolated drift | JavaScript state transition and live-region toast |
| Responsive compact mode | CSS breakpoints and collapsible inspector |

## Constraints

- Values shown under `?mock=1` must be clearly labeled as preview data.
- Project paths and artifact content are representative, not user data.
- Coral is punctuation, not the primary action color.
- Primary actions remain neutral Mist on dark.
- No product capability may be implied beyond the accepted plan.
- The production client and preview mode share the same interaction model; all
  consequential live operations route through the shared runtime command layer.
