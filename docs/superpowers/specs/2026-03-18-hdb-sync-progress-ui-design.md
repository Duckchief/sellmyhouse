# HDB Sync Progress UI

**Date:** 2026-03-18
**Status:** Approved

## Problem

The manual HDB sync at `/admin/hdb` is fire-and-forget: the POST returns immediately, the sync runs in the background, and the page never updates to reflect completion. The admin has no feedback that the sync finished or how many records were added.

## Solution

Add a dummy animated progress bar that appears while the sync runs, an HTMX polling mechanism to detect completion, and a success/failure banner that appears when done. The stats panel refreshes automatically on completion.

## States

### 1. Idle
The existing "Trigger Manual Sync" button is shown. No changes to this state.

### 2. Syncing
After clicking, the `#sync-result` div is replaced with a progress fragment containing:
- An indeterminate striped progress bar (CSS `background` + `animation`)
- Label: "Syncing HDB data…" + "Checking for updates every 3s"
- An `hx-get` polling trigger to `/admin/hdb/sync/poll?since=<timestamp>` every 3s

The button is hidden while syncing (to prevent double-triggers).

### 3. Complete (success)
The progress bar is replaced with a green banner:
- "✓ Sync complete"
- "X new records added · Stats updated above"
- The "Trigger Manual Sync" button returns inline in the banner

The stats panel (`#hdb-stats`) is refreshed via HTMX out-of-band swap to show updated totals, date range, and last sync time.

### 3b. Complete (failed)
The progress bar is replaced with a red banner:
- "✕ Sync failed"
- Error message from the sync log
- The "Trigger Manual Sync" button returns inline in the banner

Stats panel is still refreshed (last sync shows the failed entry).

## Architecture

### New endpoint: `GET /admin/hdb/sync/poll`

Query params:
- `since` — ISO timestamp string (set at the moment the sync was triggered)

Logic:
1. Call `adminService.getHdbStatus()`
2. If `status.lastSync` exists and `status.lastSync.syncedAt > since`: return complete fragment
3. Otherwise: return the same progress bar fragment (HTMX re-triggers polling)

The fragment uses `hx-swap-oob="true"` on the stats panel to refresh it independently of the main `#sync-result` target.

### Updated endpoint: `POST /admin/hdb/sync`

Returns the progress bar fragment (instead of the current generic message). Includes `since` as a data attribute set to `Date.now()` at request time.

### New partials

- `partials/admin/hdb-sync-progress.njk` — animated progress bar with polling trigger
- `partials/admin/hdb-sync-complete.njk` — success/failure banner + OOB stats refresh

### Updated partial

- `partials/admin/hdb-status.njk` — wrap the grid in `<div id="hdb-stats">` so OOB swap can target it

### Updated page

- `pages/admin/hdb.njk` — no structural changes; the existing `<div id="sync-result">` is the swap target

## Technical Notes

- The `since` timestamp is set server-side when the POST is handled (not client-side) to avoid clock skew
- `hx-confirm` on the button remains unchanged
- Polling stops automatically when the complete/failed fragment is returned (it has no `hx-trigger`)
- No WebSockets or SSE required
- No new service or repository methods needed — poll endpoint reuses `getHdbStatus()`
