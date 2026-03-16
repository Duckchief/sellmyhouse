# Seller Detail — Single Page Redesign

**Date:** 2026-03-16
**Status:** Approved

## Problem

The seller detail page uses a tabbed layout requiring multiple clicks to access information across Overview, Timeline, Compliance, and Notifications. Agents need all information visible in a single scroll.

## Approach

Option A: Single route, all data loaded server-side up front, HTMX used only for notification pagination.

## Route & Data Layer

### `GET /agent/sellers/:id` — full page render

**Change** the handler from its current single `getSellerDetail` call to fetching all data in parallel:

```ts
const [seller, compliance, notifications] = await Promise.all([
  agentService.getSellerDetail(id, agentId),
  agentService.getComplianceStatus(id, agentId),
  agentService.getNotificationHistory(id, agentId, { page: 1, limit: 10 }),
]);
const milestones = agentService.getTimeline(seller.property?.status ?? null, null); // synchronous
```

Pass to the template: `{ seller, compliance, notifications, milestones, sellerId: seller.id }`.

Remove the HTMX branch (`if hx-request`) — this route always renders the full page.

### Route changes

- `GET /agent/sellers/:id/timeline` — **remove this route entirely**
- `GET /agent/sellers/:id/compliance` — **remove this route entirely**
- `GET /agent/sellers/:id/notifications` — **modify**: accept `?page=N` (default 1), call `getNotificationHistory(id, agentId, { page, limit: 10 })`, pass `{ notifications, sellerId: id }` to the template, always render `partials/agent/seller-notifications` (no full-page path). Used by HTMX pagination only.
- There is no `/agent/sellers/:id/overview` route (never existed; no change needed).

### Service — `getNotificationHistory`

**Change** signature from:
```ts
getNotificationHistory(sellerId: string, agentId?: string): Promise<NotificationHistoryItem[]>
```
to:
```ts
getNotificationHistory(sellerId: string, agentId?: string, opts?: { page?: number; limit?: number }): Promise<NotificationHistoryResult>
```

Add `NotificationHistoryResult` type to `agent.types.ts`:
```ts
export interface NotificationHistoryResult {
  items: NotificationHistoryItem[];
  total: number;
  page: number;
  totalPages: number;
}
```

Default: `page = 1`, `limit = 10`. Pass `skip = (page - 1) * limit` and `take = limit` to the repository.

### Repository — `getNotificationHistory`

**Change** signature from:
```ts
getNotificationHistory(sellerId: string, agentId?: string): Promise<...[]>
```
to:
```ts
getNotificationHistory(sellerId: string, agentId?: string, opts?: { skip?: number; take?: number }): Promise<{ items: NotificationHistoryItem[]; total: number }>
```

Remove the hardcoded `take: 50`. Use `prisma.$transaction([findMany, count])` or separate calls to return both `items` and `total`.

## Page Structure

Tab nav and `#tab-content` div removed. `seller-detail.njk` becomes a vertical stack of `<fieldset>` elements with `<legend>` titles:

1. **Overview** — 2-col grid: Seller Info (left) + Property (right); reuses content from `seller-overview.njk`
2. **Transaction Timeline** — full-width milestone list; reuses content from `seller-timeline.njk`
3. **CDD Status** — reuses `compliance-cdd-card.njk`
4. **Estate Agency Agreement** — reuses `compliance-eaa-card.njk`
5. **Counterparty CDD** — reuses `compliance-counterparty-cdd-card.njk`; shown conditionally only when `compliance.counterpartyCdd` exists
6. **Consent** — read-only service/marketing consent (moved inline from `seller-compliance.njk`)
7. **Case Flags** — active flags list (moved inline from `seller-compliance.njk`)
8. **Notifications** — table of latest 10 rows; pagination controls below

At the bottom of the page, below all fieldsets:
```html
<div id="compliance-modal-container"></div>
```
This moves from `seller-compliance.njk` into `seller-detail.njk` directly (existing modal flows unchanged).

**Delete** `src/views/partials/agent/seller-compliance.njk` — its Consent and Case Flags markup moves inline into `seller-detail.njk`, and `#compliance-modal-container` moves to the bottom of `seller-detail.njk`.

## Notifications Pagination

The notifications section in `seller-detail.njk`:

```html
<fieldset id="notifications-fieldset">
  <legend>{{ "Notifications" | t }}</legend>
  <div id="notifications-section">
    {% include "partials/agent/seller-notifications.njk" %}
  </div>
</fieldset>
```

`seller-notifications.njk` renders **only** the table + pagination controls (no fieldset or legend wrapper). The `<fieldset>` and its `id` live in `seller-detail.njk` and are never swapped.

HTMX pagination targets `#notifications-section` and swaps `innerHTML`:

```html
<a hx-get="/agent/sellers/{{ sellerId }}/notifications?page={{ n }}"
   hx-target="#notifications-section"
   hx-swap="innerHTML">{{ n }}</a>
```

**Rename the template variable** in `seller-notifications.njk` from `notifications` to `items` throughout (loop variable, empty-state check). The partial receives `{ items, total, page, totalPages, sellerId }`. Pagination renders prev/next + page number links. No JS required.

## Files Changed

| File | Change |
|------|--------|
| `src/domains/agent/agent.router.ts` | Update `GET /agent/sellers/:id` to fetch all data in parallel and pass full context; modify `/notifications` route for HTMX pagination (add `?page=N`, pass `sellerId`); remove `/timeline` and `/compliance` routes |
| `src/domains/agent/agent.service.ts` | Add optional `{ page, limit }` params to `getNotificationHistory`; return `NotificationHistoryResult` instead of flat array |
| `src/domains/agent/agent.repository.ts` | Add optional `{ skip, take }` params to `getNotificationHistory`; return `{ items, total }`; remove hardcoded `take: 50` |
| `src/domains/agent/agent.types.ts` | Add `NotificationHistoryResult` interface |
| `src/views/pages/agent/seller-detail.njk` | Replace tab nav + `#tab-content` div with fieldset stack; add `#compliance-modal-container` at bottom |
| `src/views/partials/agent/seller-notifications.njk` | Rename `notifications` variable to `items`; add pagination controls; accept `{ items, total, page, totalPages, sellerId }` |
| `src/views/partials/agent/seller-compliance.njk` | **Delete this file** |
| `src/domains/agent/__tests__/agent.service.test.ts` | Update `getNotificationHistory` tests for pagination params and new return type |
