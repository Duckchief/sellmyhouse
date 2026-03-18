# Spec: Market Content Status Filter Buttons

**Date:** 2026-03-18
**Branch:** admin-testimonials-ui

## Summary

Add a row of status filter buttons to `/admin/content/market`, matching the existing pattern on `/admin/content/testimonials`. Buttons filter the list via HTMX without a full page reload.

## Statuses

| Value | Label | Button colour |
|---|---|---|
| _(all)_ | All | Indigo |
| `ai_generated` | AI Generated | Gray |
| `pending_review` | Pending Review | Yellow + throb animation when records exist |
| `approved` | Approved | Green |
| `rejected` | Rejected | Red |
| `published` | Published | Blue |

## Behaviour

- Clicking a filter button fires an HTMX GET to `/admin/content/market?status=<value>` (or `/admin/content/market` for All)
- HTMX target: `#market-content-list`, swap: `innerHTML`
- Active button shows filled/bordered style; inactive shows muted hover style
- "Pending Review" button throbs (CSS animation) when `hasPendingReview` is true
- Filter state is reflected in the rendered partial (`activeStatus` variable)

## Files Changed

### `src/views/partials/admin/market-content-list.njk`
Add filter button row at top using the same `filters` array + loop pattern as `testimonial-list.njk`. Pass `activeStatus` and `hasPendingReview` from the router.

### `src/domains/admin/admin.router.ts`
GET `/admin/content/market`:
- Read `req.query.status` as `activeStatus?: MarketContentStatus`
- Compute `hasPendingReview` from the unfiltered count (or from the fetched records)
- Pass `activeStatus` and `hasPendingReview` to both the HTMX partial render and the full-page render

### `src/domains/content/content.service.ts`
`listMarketContent(status?: MarketContentStatus)` — forwards status param to repository.

### `src/domains/content/content.repository.ts`
`findAllMarketContent(status?: MarketContentStatus)` — adds `where: { status }` to the Prisma query when status is provided.

## Out of Scope

- No changes to the detail panel, approve/reject actions, or any other behaviour
- No new tests beyond verifying the existing service/repo unit tests still pass (the filter param is a trivial optional where-clause addition)
