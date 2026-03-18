# Spec: Admin Manual Testimonial Creation

**Date:** 2026-03-18
**Feature:** Add Testimonial button on `/admin/content/testimonials`

## Overview

Admins can manually create testimonials from offline sources (phone, WhatsApp, email), external platforms (Google Reviews, Facebook), or general marketing copy. Manually created testimonials start as `pending_review` and flow through the existing approve → feature workflow.

## Data Model Changes

### Schema changes to `Testimonial`

| Change | Detail |
|---|---|
| Drop `sellerId` (required FK → Seller) | Replace with optional FK |
| Add `sellerId` (optional FK → Seller) | Nullable, for seller-submitted testimonials |
| Add `buyerId` (optional FK → Buyer) | Nullable, reserved for future buyer testimonials |
| Add `clientType` | Enum: `seller \| buyer`, optional — set to `seller` for seller-submitted, `buyer` for future buyer-submitted, **null for manual admin entries** |
| Rename `sellerName` → `clientName` | String, display name entered at creation. DB column renamed `seller_name` → `client_name` in the migration. |
| Rename `sellerTown` → `clientTown` | String, HDB town. DB column renamed `seller_town` → `client_town` in the migration. |
| Add `source` | String?, free text — e.g. "Google", "WhatsApp", "Phone" |
| Add `isManual` | Boolean, default `false` |
| Add `createdByAdminId` | String?, optional FK → Admin |
| `transactionId` | Make nullable (was required unique FK) |

**Rationale for dual FKs:** Follows the existing `ConsentRecord` pattern (separate `sellerId` + `buyerId` columns) to maintain referential integrity while supporting both client types. Prisma does not support polymorphic FKs natively.

### Migration

New migration: `YYYYMMDDHHMMSS_testimonial_manual_and_client_type`

## UI

### Button placement

`+ Add Testimonial` button in the top-right of the `/admin/content/testimonials` page header, consistent with other admin content pages.

### Slide-in drawer

Reuses the existing slide-panel infrastructure from `/agent/reviews`:
- Fixed-position right panel, `translate-x-full` default, slides in on trigger
- Backdrop div for click-outside close
- `data-action` JS delegation for open/close
- 300ms ease-out transition

**Trigger:** Button click fires `hx-get="/admin/content/testimonials/new"` into `#testimonial-drawer-content`, JS detects HTMX load and slides panel in.

**Form fields:**
- Client Name (required, max 100 chars)
- Town (required, max 100 chars)
- Rating — 1–5 stars (required, integer)
- Testimonial Text (required, min 10 chars, max 1000 chars)
- Source (optional, max 50 chars) — free text, e.g. "Google", "WhatsApp"

`clientType` is not a form field — it is always `null` for manually created testimonials. Manual testimonials are never linked to an existing Seller or Buyer record; `sellerId` and `buyerId` remain null permanently.

**Save behaviour:** `POST /admin/content/testimonials`, on success panel closes and `#testimonial-list` refreshes via HTMX.

### List changes

Add a **Source** column to `testimonial-list.njk`. Badge logic uses `isManual`:
- `isManual: true` → `Manual` badge (indigo) + source label if present (e.g. "Google")
- `isManual: false` → `Seller` badge (gray) for seller-submitted entries

`clientType` is not used for badge display — it is reserved for future buyer-submitted logic.

## Routes

| Method | Path | Handler | Response |
|---|---|---|---|
| `GET` | `/admin/content/testimonials/new` | Returns drawer form partial | HTMX only |
| `POST` | `/admin/content/testimonials` | Creates testimonial | HTMX: refreshed `#testimonial-list` partial; non-HTMX: redirect to `/admin/content/testimonials` |

Both routes require admin auth + 2FA (existing middleware).

## Backend

### `content.service.ts`

New method: `createManualTestimonial(adminId: string, input: CreateManualTestimonialInput)`
- Sets `isManual: true`
- Sets `status: pending_review`
- Sets `createdByAdminId: adminId`
- `sellerId`, `buyerId`, `transactionId` all null
- `submissionToken`, `tokenExpiresAt` null

### `content.repository.ts`

New method: `createManualTestimonial(input)` — plain insert, no FK constraints on client.

### `compliance.service.ts`

`removeTestimonial(sellerId)` currently calls `content.repository.hardDeleteTestimonial` after finding the testimonial via `findTestimonialBySeller(sellerId)`. The repository method uses `where: { sellerId }`.

After this change, the repository query becomes `where: { sellerId }` (unchanged — the column exists as before, just now nullable). No logic change needed for the seller PDPA path. When a buyer PDPA deletion is added in the future, a parallel `removeTestimonialByBuyer(buyerId)` method will be added using `where: { buyerId }`.

## Affected Files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Schema changes as above |
| `prisma/migrations/…` | New migration |
| `content.repository.ts` | New method; field renames (`sellerName`→`clientName`, `sellerTown`→`clientTown`) throughout |
| `content.service.ts` | New method; field renames throughout |
| `compliance.service.ts` | Update `removeTestimonial` for new FK structure |
| `admin.router.ts` | Two new routes |
| `src/views/pages/admin/testimonials.njk` | Add button + drawer container |
| `src/views/partials/admin/testimonial-list.njk` | Add source/manual badge column |
| `src/views/partials/admin/testimonial-add-drawer.njk` | New — creation form partial |
| Tests | New unit tests for `createManualTestimonial` |

## Testing

- Unit: `createManualTestimonial` in content.service.test.ts — happy path, validation errors (missing required fields, text too short/long)
- Unit: repository `createManualTestimonial` — verify `isManual: true`, `status: pending_review`, `sellerId`/`buyerId`/`transactionId` all null
- Existing testimonial tests updated for renamed fields (`clientName`, `clientTown`)
- Integration: `POST /admin/content/testimonials` — creates testimonial, returns 200 with list partial; missing required fields returns 422
