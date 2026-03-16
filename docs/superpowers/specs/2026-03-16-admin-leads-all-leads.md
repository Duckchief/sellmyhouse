# Admin Leads — "All Leads" Section

**Date:** 2026-03-16
**Status:** Approved

## Problem

`/admin/leads` shows only unassigned leads. Admins have no visibility into leads that have already been assigned to an agent, making it impossible to see the full lead picture from one page.

## Goal

Add an "All Leads" section below "Unassigned Leads" on `/admin/leads`, showing every seller with `status = 'lead'` regardless of agent assignment. Same column style as the existing admin table.

## Layout

```
<h1>Leads</h1>

[Unassigned Leads]          ← existing table, unchanged, with pagination
  Name | Phone | Town | Lead Source | Created | Assign

[All Leads]                 ← new section, up to 50, no pagination
  Name | Phone | Town | Lead Source | Created | Assign
```

- If `unassigned.leads.length == 0`: skip the "Unassigned Leads" subheading and table entirely (don't render an empty section).
- If no leads at all: show "No leads." empty state.
- "All Leads" always renders when there is at least one lead (assigned or not).
- "All Leads" is capped at 50 most recent leads — no pagination needed (operational view).

## Data Layer

### `admin.repository.ts`
Add `findAllLeads(limit = 50)`:
- Same Prisma query shape as `findUnassignedLeads` but without `agentId: null` filter.
- Must include `properties: { take: 1, select: { town: true } }` so the service layer can derive `town` from `s.properties[0]?.town ?? null`.
- Fixed `take: limit`, ordered by `createdAt desc`. No pagination offset.

### `admin.types.ts`
Add `AdminLeadQueueResult`:
```typescript
export interface AdminLeadQueueResult {
  unassigned: LeadListResult;   // existing paginated type
  all: Array<{                  // flat array, no pagination
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
}
```

### `admin.service.ts`
Add `getAdminLeadQueue(page?: number): Promise<AdminLeadQueueResult>`:
- Calls `getUnassignedLeads(page)` (same-file service function) and `adminRepo.findAllLeads()` (repo call) in `Promise.all`.
- Maps the raw repo result for `all` the same way `getUnassignedLeads` maps its results (derive `town` from `properties[0]?.town ?? null`).
- Returns `{ unassigned, all }`.
- Keep `getUnassignedLeads` unchanged (used by existing tests).

### `admin.router.ts`
`GET /admin/leads`: call `getAdminLeadQueue(page)` instead of `getUnassignedLeads(page)`. Pass `{ unassigned, all, currentPath }` to both the full page render and the HTMX partial render (replacing the old `{ result, currentPath }` variable name). The HTMX partial response must render the **complete restructured partial** (both Unassigned and All Leads sections), so paginating the unassigned table correctly re-renders the entire `#lead-list` div including the All Leads section.

## Template Changes

### `src/views/pages/admin/leads.njk`
Change `<h1>` from `"Unassigned Leads"` to `"Leads"`.

### `src/views/partials/admin/lead-list.njk`
Restructure using a Nunjucks macro for the table (avoids repeating the `<table>` markup):

The template context changes: the variable previously named `result` (a `LeadListResult`) is replaced by two variables — `unassigned` (a `LeadListResult`) and `all` (a flat array). All references to `result.*` must be updated to `unassigned.*`.

```
macro leadTable(leads)  → renders the shared <table> markup

if unassigned.leads.length > 0:
  <h2>Unassigned Leads</h2>
  {{ leadTable(unassigned.leads) }}
  [pagination for unassigned — links to /admin/leads?page=N, hx-target="#lead-list"]

if all.length > 0:
  <h2>All Leads</h2>
  {{ leadTable(all) }}
else:
  <p>No leads.</p>
```

Note: `all` is a superset of `unassigned.leads`. If `all.length == 0` then `unassigned.leads.length` will also be `0` — the `else` branch covers both simultaneously.

The macro renders: Name (link to `/admin/sellers/:id`), Phone, Town, Lead Source, Created (date filter), Assign button (opens assign modal via HTMX).

## Files Changed

| File | Change |
|------|--------|
| `src/domains/admin/admin.repository.ts` | Add `findAllLeads(limit)` |
| `src/domains/admin/admin.service.ts` | Add `getAdminLeadQueue()` |
| `src/domains/admin/admin.types.ts` | Add `AdminLeadQueueResult` |
| `src/domains/admin/admin.router.ts` | Use `getAdminLeadQueue()` |
| `src/views/pages/admin/leads.njk` | Update `<h1>` to "Leads" |
| `src/views/partials/admin/lead-list.njk` | Macro + two-section layout |
| `src/domains/admin/__tests__/admin.service.test.ts` | Tests for `getAdminLeadQueue` |

## Out of Scope

- Pagination for "All Leads" (50-item cap is sufficient for an operational view)
- Agent name column in "All Leads" (Assign button opens the modal which shows assignment state)
- Filtering or sorting controls
