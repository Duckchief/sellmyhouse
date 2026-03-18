# Admin Market Content Sidebar

**Date:** 2026-03-18
**Branch:** admin-testimonials-ui

## Problem

1. `/admin/content/market` navigates away to a separate detail page (`/admin/content/market/:id`) instead of keeping the user in context.
2. `market_content` is incorrectly included in the agent review queue (`/agent/reviews?tab=market_content`). Market content is platform-wide social media content — it has no seller relationship and does not belong in a per-seller review workflow.

## Design

### 1. Remove market_content from agent review queue

- Remove `market_content` from `EntityType` in `review.types.ts` and `ENTITY_TYPES`
- Remove `market_content` from the tab list in `reviews.njk`
- Remove `market_content` cases from `review.service.ts` (approve/reject) and `review.repository.ts`
- Remove `review-detail-market-content.njk` partial
- Remove `market_content` from the `partialMap` in `review.router.ts`
- Update `countByType` references in any view that renders market_content count

### 2. Sidebar on /admin/content/market

**Behaviour:** Clicking any row opens a fixed right-side slide-out panel (same pattern as `reviews.njk`). No "View" column.

**Panel contents:**
- Header: period, status badge, created date
- Body (scrollable): Narrative, TikTok (≤150 chars), Instagram (≤300 chars), LinkedIn (≤700 chars), Raw Data
- Footer (only when `status == 'pending_review'`): Approve button + rejection textarea + Reject button. Actions POST to existing `/admin/content/market/:id/approve` and `/admin/content/market/:id/reject` endpoints via HTMX. On success, swap the row status badge in-place and close the panel.

**Implementation pattern** (mirrors `reviews.njk`):
- `market-content.njk`: add backdrop div + panel div with close button; wrap list in `#market-content-list`
- `market-content-list.njk`: each `<tr>` gets `hx-get="/admin/content/market/:id/detail"` targeting `#market-detail-content`, `hx-swap="innerHTML"`, `cursor-pointer`; remove the "View" `<td>`
- New partial `partials/admin/market-content-detail-panel.njk`: the panel body content (rendered via HTMX)
- New GET route `GET /admin/content/market/:id/detail`: returns the panel partial
- JS: same open/close pattern as the agent review panel (translate-x-full toggle)

### 3. Delete detail page

- Delete `src/views/pages/admin/market-content-detail.njk`
- Remove the `GET /admin/content/market/:id` route handler from `admin.router.ts`

## Files Affected

| File | Change |
|------|--------|
| `src/domains/review/review.types.ts` | Remove `market_content` from `EntityType` |
| `src/domains/review/review.service.ts` | Remove `market_content` cases |
| `src/domains/review/review.repository.ts` | Remove `market_content` cases |
| `src/domains/review/review.router.ts` | Remove `market_content` from `partialMap` |
| `src/domains/admin/admin.router.ts` | Remove detail page route; add `GET /admin/content/market/:id/detail` |
| `src/views/pages/agent/reviews.njk` | Remove `market_content` tab |
| `src/views/pages/admin/market-content.njk` | Add backdrop + panel + JS |
| `src/views/partials/admin/market-content-list.njk` | Row HTMX attrs, remove "View" column |
| `src/views/partials/admin/market-content-detail-panel.njk` | New — panel body partial |
| `src/views/partials/agent/review-detail-market-content.njk` | Delete |
| `src/views/pages/admin/market-content-detail.njk` | Delete |

## Out of Scope

- Changing the approve/reject endpoint behaviour (POST routes unchanged)
- Any changes to how market content is generated or published
