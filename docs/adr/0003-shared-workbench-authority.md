# ADR 0003: Shared workbench visual authority

- Status: Accepted
- Date: 2026-07-31

## Context

The existing desktop document defines a card-heavy, blue-focus system that
conflicts with the approved dense manager workbench and would allow desktop and
browser clients to drift apart.

## Decision

Root `DESIGN.md` is the shared visual and interaction authority. The approved
reference is `.impeccable/mocks/manager-workbench.png`. Both clients use the
same React components, Tailwind tokens, Lucide iconography, density, hierarchy,
typography, color roles, responsive behavior, and motion preferences.

Client documents may describe native window, menu, updater, deep-link, and
external-open behavior only.

## Consequences

The manager is a dense four-pane operational workbench rather than a dashboard
card grid. Coral denotes selection, focus, editing, and meaningful operational
emphasis. Light and dark themes are independently verified at the same primary
viewports.
