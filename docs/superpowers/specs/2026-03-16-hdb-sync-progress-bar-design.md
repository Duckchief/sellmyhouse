# HDB Sync Progress Bar — Design Spec
Date: 2026-03-16

## Problem
The "Trigger Manual Sync" button on `/admin/hdb` fires a background sync and immediately shows a static success message. The sync can take several minutes. There is no visual indication that work is in progress.

## Goal
Show an indeterminate animated progress bar with a generic status message while the sync runs. Replace it with the result (success or failure) when done.

## Approach
HTMX polling with an in-memory running flag. The POST responds immediately with the progress bar partial; the partial polls every 3 seconds until the sync is no longer running.

## Components

### 1. `src/domains/hdb/sync.state.ts` (new)
Module-level singleton tracking sync state:
```ts
export const syncState = {
  running: false,
};
```
Imported by `admin.service.ts` to set/clear the flag.

### 2. `admin.service.ts` — `triggerHdbSync` (modified)
- Set `syncState.running = true` before firing `syncService.sync()`
- Clear `syncState.running = false` in both the success path and `.catch()`

### 3. `GET /admin/hdb/sync/status` (new route)
- If `syncState.running` → render `partials/admin/hdb-progress.njk` (keeps polling alive)
- If not running → render `partials/admin/hdb-sync-done.njk` (stops polling, shows result message, triggers status card refresh)

### 4. `partials/admin/hdb-progress.njk` (new)
```html
<div id="sync-result"
     hx-get="/admin/hdb/sync/status"
     hx-trigger="every 3s"
     hx-target="#sync-result"
     hx-swap="outerHTML">
  <!-- indeterminate bar -->
  <div class="relative w-full bg-gray-200 rounded-full h-2 overflow-hidden mt-4">
    <div class="absolute h-2 w-1/3 bg-indigo-600 rounded-full animate-shimmer"></div>
  </div>
  <p class="text-sm text-gray-500 mt-2">Syncing HDB data, please wait...</p>
</div>
```

### 5. Done state (no separate partial)
When `syncState.running === false`, the status endpoint sets `HX-Redirect: /admin/hdb` and returns 200. HTMX reloads the full page, showing updated stats cards and the new sync history row. No separate done partial required — the page reload provides equivalent feedback more simply.

### 6. `POST /admin/hdb/sync` (modified)
On HTMX request, render `hdb-progress.njk` instead of `team-action-result`.

### 7. `tailwind.config.ts` (modified)
Add shimmer keyframe + animation:
```ts
keyframes: {
  shimmer: {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(400%)' },
  },
},
animation: {
  shimmer: 'shimmer 1.5s ease-in-out infinite',
},
```

## Behaviour

| State | UI |
|---|---|
| Idle | "Trigger Manual Sync" button visible |
| Sync triggered | Button replaced by indeterminate bar + "Syncing HDB data, please wait..." |
| Sync completes | HTMX `HX-Redirect` triggers full page reload; admin sees updated stats + new sync history entry |
| Server restarted mid-sync | `syncState.running` resets to `false`; next poll returns "done" partial |

## Out of Scope
- Real percentage progress (requires per-page callbacks)
- Real status messages (e.g. "Fetching page 2...")
- Preventing double-trigger (separate concern)
