# Spec: Testimonial Detail Drawer

**Date:** 2026-03-18
**Feature:** Click a testimonial row to open its details in the slide-in drawer

## Overview

Clicking a row in the `/admin/content/testimonials` table opens the existing slide-in drawer with a read-only detail view of that testimonial. The drawer content varies by status. `pending_submission` rows are not clickable.

## Status Behaviour

| Status | Row clickable | Drawer content |
|---|---|---|
| `pending_submission` | No | Nothing — row has no `hx-get` |
| `pending_review` | Yes | Read-only detail + Approve + Reject buttons |
| `approved` | Yes | Read-only detail + Featured status |
| `rejected` | Yes | Read-only detail only |

## UI

### Row changes in `testimonial-list.njk`

Rows where `status != 'pending_submission'` gain:

```njk
hx-get="/admin/content/testimonials/{{ record.id }}"
hx-target="#testimonial-drawer-content"
hx-swap="innerHTML"
data-action="open-testimonial-drawer"
class="... cursor-pointer"
```

`data-action="open-testimonial-drawer"` is a semantic convention carried over from the "Add Testimonial" button — it has no click-delegation handler in `app.js`. Opening is handled purely by HTMX: loading content into `#testimonial-drawer-content` triggers the existing `htmx:afterRequest` listener (lines ~305-313), which removes the panel's `translate-x-full` / `opacity-0` classes and shows the backdrop.

`pending_submission` rows keep their existing non-interactive styling (`cursor-default`) and no `hx-get`.

### Detail partial — `testimonial-detail-drawer.njk`

A single partial covers all three visible states using status-conditional blocks.

**All statuses show:**
- Header: client name + close button (`data-action="close-testimonial-drawer"`)
- Status badge (colour-coded, same scheme as the list)
- Town + source badge (Manual/Seller) + source label if present
- Rating — 5-star display (read-only, filled stars in amber)
- Testimonial text (plain text, no editing)

**`approved` additionally shows:**
- "Featured on website" — Yes/No label

**`pending_review` additionally shows:**
- Approve button: `hx-post="/admin/content/testimonials/{{ record.id }}/approve"`, `hx-target="#testimonial-list"`, `hx-swap="innerHTML"`
- Reject button: same pattern with `/reject` path

The drawer closes automatically after a successful approve/reject POST — the existing `htmx:afterRequest` listener in `app.js` already closes the drawer whenever a successful request originates from inside `#testimonial-drawer-panel` and targets `#testimonial-list`. No `HX-Trigger` header or new JS listener is needed.

**`rejected`** shows no additional elements.

### Approve / Reject action flow

The Approve and Reject buttons use HTMX (`hx-post`, `hx-target="#testimonial-list"`, `hx-swap="innerHTML"`). On success, the server responds with the refreshed `testimonial-list` partial.

The drawer closes automatically — the existing `htmx:afterRequest` listener in `app.js` (lines ~316-321) already handles this: when a successful request originates from inside `#testimonial-drawer-panel` and targets `#testimonial-list`, it adds `translate-x-full` / `opacity-0` / `pointer-events-none` and hides the backdrop. No server-side `HX-Trigger` header and no new JS code are needed.

Non-HTMX requests (direct form POST fallback) continue to redirect to `/admin/content/testimonials` as before.

## Routes

| Method | Path | Handler | HTMX response | Non-HTMX response |
|---|---|---|---|---|
| `GET` | `/admin/content/testimonials/:id` | Fetch testimonial, render detail partial | Partial HTML | Redirect to list |
| `POST` | `/admin/content/testimonials/:id/approve` | Approve + notify (existing) | List partial (drawer closes via existing JS) | Redirect (existing) |
| `POST` | `/admin/content/testimonials/:id/reject` | Reject (existing) | List partial (drawer closes via existing JS) | Redirect (existing) |

Both existing POST routes only add the HTMX branch — the non-HTMX redirect path is unchanged.

The `GET /:id` route returns 404 (via `NotFoundError`) for unknown IDs. For `pending_submission` status, the route still works (returns the partial) but these rows are never wired up in the template, so it is never triggered in practice.

## Backend

### `content.service.ts`

New named export: `getTestimonialById(id: string)` — thin wrapper around `contentRepo.findTestimonialById(id)`, throws `NotFoundError` if not found. Follows the same export pattern as `approveTestimonial` / `rejectTestimonial` so the router can call `contentService.getTestimonialById(id)`.

### `content.repository.ts`

`findTestimonialById` already exists as `prisma.testimonial.findUnique({ where: { id } })` — returns all Testimonial columns. No change needed. Fields available to the detail partial include: `id`, `clientName`, `clientTown`, `rating`, `content`, `source`, `isManual`, `clientType`, `status`, `displayOnWebsite`, `createdAt`, `sellerId`, `buyerId`, `transactionId`, `createdByAgentId`, `approvedByAgentId`, `approvedAt`.

### `admin.router.ts`

- Add `GET /admin/content/testimonials/:id` before the existing `POST /:id/approve` route (to avoid param collision)
- Update `POST /admin/content/testimonials/:id/approve`: when `hx-request`, respond with refreshed list partial (existing `htmx:afterRequest` JS closes the drawer automatically)
- Update `POST /admin/content/testimonials/:id/reject`: same

## Affected Files

| File | Change |
|---|---|
| `src/domains/content/content.service.ts` | Add `getTestimonialById` named export |
| `src/domains/admin/admin.router.ts` | Add `GET /:id` route; update approve + reject to return list partial on HTMX requests |
| `src/views/partials/admin/testimonial-list.njk` | Add `hx-get` + `cursor-pointer` to clickable rows |
| `src/views/partials/admin/testimonial-detail-drawer.njk` | New partial |
| `public/js/app.js` | No change needed — existing drawer JS handles open/close |

## Testing

- Unit: `getTestimonialById` — happy path; throws `NotFoundError` when not found
- Integration: `GET /admin/content/testimonials/:id` — returns 200 with partial for known ID; returns 404 for unknown ID
- Integration: `POST /admin/content/testimonials/:id/approve` (HTMX) — returns 200 with list partial and `HX-Trigger` header
- Integration: `POST /admin/content/testimonials/:id/reject` (HTMX) — same
- Existing non-HTMX redirect tests for approve/reject remain unchanged
