## Scope

Primary target: `packages/manager/index.html`

Mode: Operate. This surface is a live product prototype for evaluating the
manager’s desktop information architecture and visual system with representative
local data.

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
| Searchable lifecycle-aware artifact index | Semantic HTML and mock JavaScript data |
| Dominant Markdown editor and preview | Textarea, sanitized HTML preview, CSS |
| Provider projection list and inspector | Semantic buttons and structured mock state |
| Desired/Applied/Observed comparison | HTML data rows and monospace hashes |
| Command palette | Native dialog, search, and keyboard navigation |
| Apply feedback and isolated drift | JavaScript state transition and live-region toast |
| Responsive compact mode | CSS breakpoints and collapsible inspector |

## Constraints

- Mock values must be clearly labeled as preview data.
- Project paths and artifact content are representative, not user data.
- Coral is punctuation, not the primary action color.
- Primary actions remain neutral Mist on dark.
- No product capability may be implied beyond the accepted plan.
- The production client will replace mock state with the shared runtime command
  layer without changing the interaction model.
