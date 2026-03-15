# Admin Seller Detail Page — Design Spec

**Date:** 2026-03-16
**Status:** Approved

## Overview

Add clickable seller names across three admin list views that navigate to a new read-only admin seller detail page (`/admin/sellers/:id`). Inline action buttons (Assign/Reassign) remain unchanged on list pages.

## Scope

### 1. Clickable Names in List Pages

Three templates updated — name cell becomes a plain `<a>` tag (not `data-action="navigate"`):

- `partials/admin/pipeline-table.njk` — name links to `/admin/sellers/{{ seller.id }}`. The broken "Actions" column (currently a generic link to `/admin/sellers`) is removed.
- `partials/admin/lead-list.njk` — name links to `/admin/sellers/{{ seller.id }}`. Assign button stays.
- `partials/admin/seller-list.njk` — name links to `/admin/sellers/{{ seller.id }}`. Assign/Reassign button stays.

Plain `<a>` tags are used (not the `data-action="navigate"` whole-row pattern) — more accessible and appropriate for single-cell navigation.

### 2. Backend

**Route:** `GET /admin/sellers/:id` in `admin.router.ts`
- Guards: `requireRole('admin')` + `requireTwoFactor()` (same as all other admin routes)
- Renders `pages/admin/seller-detail` (full page, not HTMX partial)
- Returns 404 via `NotFoundError` if seller not found

**Service method:** `adminService.getAdminSellerDetail(id: string): Promise<AdminSellerDetail>`
- Fetches all data in one method via repository layer (no direct Prisma in service)
- Cross-domain data (transaction, compliance, audit) accessed via those domains' repositories, consistent with existing admin service patterns

**Data fetched:**
- Seller: name, phone, email, status, createdAt, notificationPreference
- Property: block, street, town, flatType, askingPrice, floorArea
- Assigned agent: name, ceaRegNo, phone
- Status history: audit log entries for this seller, most recent first (max 20)
- Compliance: latest CDD record, consent record count, any withdrawal on file
- Transaction: id, status, offerId, agreedPrice, hdbApplicationStatus, otpStatus, createdAt

**New type:** `AdminSellerDetail` in `admin.types.ts`

### 3. Detail Page Layout

**File:** `src/views/pages/admin/seller-detail.njk`

Full server-rendered page (not an HTMX partial). Uses existing admin card style. Sections:

1. **Header** — seller name, status badge, back link to `/admin/sellers`
2. **Seller Info** — name, phone, email, notification preference, created date
3. **Property** — block/street, town, flat type, floor area, asking price; or "No property on file"
4. **Assigned Agent** — name, CEA reg no, phone; or "Unassigned" warning badge with link to `/admin/sellers` for assignment (reuses existing assign modal, not duplicated here)
5. **Transaction Summary** — status, agreed price, HDB application status, OTP status; or "No transaction yet"
6. **Compliance** — latest CDD record status, consent record count, withdrawal on file
7. **Status History** — audit log timeline, most recent first, max 20 entries

**This page is read-only.** All mutations (assign agent, status changes) remain on list pages.

## What Is Not Changed

- Assign/Reassign modal flow — untouched
- Agent seller detail page (`/agent/sellers/:id`) — untouched
- `data-action="navigate"` whole-row pattern — not used here
- Any seller mutation routes

## Testing

- Unit: `adminService.getAdminSellerDetail` with mocked repositories — seller found, seller not found (NotFoundError), missing property/agent/transaction (graceful nulls)
- Integration: `GET /admin/sellers/:id` — 200 with full data, 404 for unknown id, 401/403 for unauthenticated/non-admin
