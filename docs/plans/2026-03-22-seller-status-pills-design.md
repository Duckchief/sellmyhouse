# Design: Seller Status Pills for /agent/sellers and /admin/sellers

**Date:** 2026-03-22
**Status:** Approved

## Problem

Both `/agent/sellers` and `/admin/sellers` use a `<select>` dropdown to filter by seller status. The `/admin/pipeline` page already has a much better pattern: a row of clickable cards with counts per status. This design replaces the dropdown with the same pill-row pattern on both sellers pages.

## Visual Layout

A row of pill buttons above the search bar:

```
[ All 47 ] [ Lead 12 ] [ Engaged 8 ] [ Active 15 ] [ Completed 9 ] [ Archived 3 ]

[ Search input ] [ Town input* ] [ Search button ]     *agent page only
```

Color scheme matches pipeline: blue/Lead, yellow/Engaged, green/Active, gray/Completed, red/Archived. The active pill shows a colored ring. Counts are global (total per status for that agent's sellers / all sellers for admin) — consistent with how the pipeline page works.

## Backend Changes

### New repository functions

**`agent.repository.ts`** — `getSellerStatusCounts(agentId?: string): Promise<Record<string, number>>`
Uses `prisma.seller.groupBy({ by: ['status'], where: { agentId } })` scoped to the agent's own sellers.

**`admin.repository.ts`** — `getAdminSellerStatusCounts(): Promise<Record<string, number>>`
Same groupBy across all sellers, no agentId filter.

Both return shape: `{ lead: 12, engaged: 8, active: 15, completed: 9, archived: 3 }`.

### Service wrappers

- `agent.service.ts` — `getSellerStatusCounts(agentId?: string)`
- `admin.service.ts` — `getAdminSellerStatusCounts()`

### Router changes

Both `/agent/sellers` and `/admin/sellers` GET handlers run the count query in `Promise.all` alongside the existing list query. Both `statusCounts` and `currentStatus` (from `req.query.status`) are passed to the template. The HTMX partial render path also receives `statusCounts` so counts remain visible after a search refresh.

## Frontend Changes

### New shared partial

`src/views/partials/shared/seller-status-pills.njk`
Reused by both agent and admin sellers templates.

Receives:
- `statusCounts` — `Record<string, number>`
- `currentStatus` — the active status value (or empty string for All)
- `hxEndpoint` — `/agent/sellers` or `/admin/sellers`
- `formId` — id of the search form (for `hx-include`)

Each pill:
- `hx-get` pointing to the correct endpoint
- `hx-target="#seller-list"`
- `hx-include` referencing the search form by id
- `hx-vals` injecting the status value (`""` for All)
- Active ring applied via Nunjucks conditional on `currentStatus == s.value`

A small inline script (nonce-tagged, consistent with existing `formLoadedAt` pattern) toggles the active ring class on the clicked pill immediately on click, preventing flicker while the HTMX response loads.

### Template changes

- `src/views/pages/admin/sellers.njk` — remove `<select name="status">`, add `{% include "partials/shared/seller-status-pills.njk" %}` above the search form
- `src/views/pages/agent/sellers.njk` — same

The `<select>` is removed entirely. Status flows through `hx-vals` on each pill.

## What Is Not Changing

- Search input, town input, Search button — unchanged
- HTMX swap target (`#seller-list`) — unchanged
- Partial templates (`partials/agent/seller-list.njk`, `partials/admin/seller-list.njk`) — unchanged except receiving `statusCounts`
- Filter logic in repositories — unchanged
