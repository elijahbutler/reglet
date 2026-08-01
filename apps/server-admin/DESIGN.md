# Reglet Server Admin Visual Boundary

The sync-owner dashboard deliberately remains separate from the main Manager
design-system implementation.

`apps/server-admin` is built into and served by the encrypted sync service. It
must not import `packages/manager-ui`, Manager application code, local runtime
code, filesystem capabilities, or desktop-only modules. This keeps the public
homeserver's dependency and trust boundary smaller than the local Manager.

The dashboard still mirrors the product-level visual language recorded in the
root `DESIGN.md`:

- native system UI typography and monospace technical values;
- light and dark themes with the same information hierarchy;
- layered neutral surfaces, fine one-pixel separators, and compact rows;
- six-to-eight-pixel control radii and restrained panel rounding;
- coral for focus, selection, and meaningful operational emphasis;
- Lucide icons, visible keyboard focus, reduced motion, and increased contrast;
- dense operational layout instead of a card-grid dashboard.

The local `--sa-*` tokens intentionally mirror the Manager's current semantic
roles while remaining independently defined in `src/styles.css`. Reconcile
material visual changes here through review; do not make the server application
depend on the main Manager design files merely to eliminate duplicated token
values.

Server-specific information architecture is allowed where the trust boundary
requires it. The owner console focuses on connections, device access, health,
integrity, and backups. It does not reproduce the Library, Provider, Project
Inbox, Activity, or local Settings workbenches.
