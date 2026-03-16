# Admin Seller Detail — 2-column Layout with Timeline & Notifications

**Date:** 2026-03-16
**Status:** Approved

## Problem

The `/admin/sellers/:id` page uses a single-column stacked layout with 6 cards. It has no Transaction Timeline or Notifications sections, unlike the agent view which surfaces both.

## Goals

- Restructure the page into a 2-column grid layout
- Add Transaction Timeline (full-width, below the grid)
- Add Notifications history (full-width, below the timeline)
- Load all data inline on page load (no HTMX lazy-loading)

## Layout

```
[Header — full width: seller name + status badge]

[Left column]                 [Right column]
Seller Info card              Property card
Assigned Agent card           Transaction card
Compliance card

[Transaction Timeline — full width]
[Notifications — full width]
```

The grid uses `grid-cols-1 md:grid-cols-2 gap-6`. On mobile, columns stack. Wide sections (timeline, notifications) sit below the grid as full-width rows.

## Data Changes

### `admin.service.ts` — `getAdminSellerDetail`

Add two fetches to the existing `Promise.all`:

1. **Milestones** — `getTimelineMilestones(property?.status ?? null, transaction?.status ?? null)` from `seller.service`. Pure function, no DB call.
2. **Notifications** — `agentRepo.getNotificationHistory(sellerId)` with no `agentId` (admin sees all, RBAC guard skipped when agentId is absent).

### `admin.types.ts` — `AdminSellerDetail`

Add two fields:
- `milestones: TimelineMilestone[]`
- `notifications: NotificationHistoryItem[]`

## Template Changes

### `src/views/pages/admin/seller-detail.njk`

1. Wrap the 6 cards in `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">`.
2. Reorder cards: left column gets Seller Info, Assigned Agent, Compliance; right column gets Property, Transaction.
3. Include `partials/agent/seller-timeline.njk` below the grid (full-width).
4. Include `partials/agent/seller-notifications.njk` below the timeline (full-width).

### Partial reuse

The existing agent partials are template-only and use generic variable names (`milestones`, `notifications`). They can be included directly from the admin page by passing the same variable names from the router. No new partials needed.

## Files to Change

| File | Change |
|------|--------|
| `src/domains/admin/admin.types.ts` | Add `milestones` and `notifications` to `AdminSellerDetail` |
| `src/domains/admin/admin.service.ts` | Fetch milestones and notifications in `getAdminSellerDetail` |
| `src/views/pages/admin/seller-detail.njk` | Restructure to 2-col grid, add timeline and notifications |

## Out of Scope

- HTMX tab navigation (admin page stays single-scroll)
- Admin-specific partials (reuse agent partials directly)
- Any changes to the agent seller detail page
