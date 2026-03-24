# Spec: Agent Listing Access — Portals Index, Photo Download, Listing Card

**Date:** 2026-03-24
**Status:** Approved

## Problem

After approving listing photos and description, the agent has no way to access them. The portals page (`/agent/listings/:listingId/portals`) exists but is unreachable — no sidebar link, no link from seller-detail. Photos cannot be downloaded. The agent cannot progress from review approval to portal posting.

## Solution

Three UI additions that close the gap:

1. **Portals nav entry** — a "Portals" link in the agent sidebar leads to an index of all active listings. Badge count shows listings fully approved and not yet posted to all portals.
2. **Photos section on portals page** — the existing portals page gains a photo panel at the top: thumbnails, photo count, and a "Download All & Delete" button. After download, photos are deleted from the platform (data lifecycle) and the section shows a permanent "downloaded" state.
3. **Listing card on seller-detail** — a new "Listing" card on the seller detail page shows approval status for photos and description, portals progress (X/3 posted), and a "Go to Portals →" link.

## Behaviour

### Sidebar — Portals nav entry
- New "Portals" entry in the agent sidebar, positioned after "Reviews".
- Badge shows count of listings where both `photosApprovedAt` and `descriptionApprovedAt` are set, `photos` is not null (i.e. not yet downloaded), and at least one portal listing is not `posted`.
- Admin sees all listings; agent sees only their assigned listings (existing `agentFilter` pattern).
- **Badge population:** The badge count (`portalsReadyCount`) is injected into `res.locals` by a new small middleware applied to the agent router — identical in structure to how `cspNonce` and the CSRF token are injected globally. This ensures the badge is visible on every agent page (dashboard, sellers, seller-detail, portals, etc.) without updating each individual route handler. The middleware calls `portalService.getPortalsReadyCount(agentFilter)` — a lightweight count query. The `agentFilter` is derived from `req.user` inside the middleware.

### Portals index page (`GET /agent/portals`)
- Table of active listings: seller name, property address, photos status, description status, portals progress (X/3 posted), "Open →" link to `/agent/listings/:listingId/portals`.
- Photo status: "✓ Approved" (green) | "Pending" (yellow) | "Downloaded" (grey).
- Description status: "✓ Approved" (green) | "Pending" (yellow).
- HTMX-aware: full page on normal request, table partial on `HX-Request`.

### Portals page — photos section (`/agent/listings/:listingId/portals`)
- New photos panel rendered above the existing portal panels.
- **Photos present:** thumbnail grid (max 8 shown, cover badge on first) + photo count + "Download All & Delete" button.
- **Download:** `POST /agent/listings/:listingId/photos/download-all` — streams a ZIP, then deletes all photo files from disk and sets `listing.photos = Prisma.JsonNull`. Audited.
- **Photos already downloaded** (`photosApprovedAt` set, `photos` is null): panel shows "Photos downloaded and deleted on [date]" — no re-download possible.
- **Photos not yet approved** (`photosApprovedAt` is null, `photos` not null): panel shows "Awaiting photo approval".
- **No photos** (`photos` is null, `photosApprovedAt` is null): panel shows "No photos uploaded".
- Photo thumbnails served via the existing `/agent/listings/:listingId/photos/:photoId` endpoint in `portal.router.ts` (already auth-gated with ownership check via `photoService.getPhotoForAgent`).
- The portal router already includes `requireAuth`, `requireRole('agent','admin')`, `requireTwoFactor()` — download route uses the same auth chain.

### Listing card on seller-detail
- New "Listing" card added to `seller-detail.njk` (after the Seller Documents card).
- Only rendered when seller has an active listing.
- Shows: photos status (Approved N photos / Pending / Downloaded), description status (Approved / Pending), listing status, portals progress (X/3 posted).
- "Go to Portals →" button links to `/agent/listings/:listingId/portals`.

## Data Changes

No schema migrations needed. All required fields exist on `Listing`:
- `photos` (Json?) — photo array or null
- `photosApprovedAt` (DateTime?) — set when photos approved
- `descriptionApprovedAt` (DateTime?) — set when description approved

### `agent.repository.ts` — `getSellerDetail`
Add to the listing include:
```ts
listings: {
  take: 1,
  orderBy: { createdAt: 'desc' },
  select: {
    id: true,
    status: true,
    title: true,
    description: true,
    photos: true,
    photosApprovedAt: true,
    descriptionApprovedAt: true,
    portalListings: { select: { id: true, status: true } },
  },
},
```

### `agent.service.ts` — `getSellerDetail`
Extend the returned listing shape:
```ts
listing: property.listings[0]
  ? {
      id: property.listings[0].id,
      status: property.listings[0].status,
      title: property.listings[0].title,
      description: property.listings[0].description,
      photosApprovedAt: property.listings[0].photosApprovedAt,
      descriptionApprovedAt: property.listings[0].descriptionApprovedAt,
      photoCount: (() => {
        if (!property.listings[0].photos) return null;
        try {
          const parsed = JSON.parse(property.listings[0].photos as string);
          return Array.isArray(parsed) ? parsed.length : null;
        } catch {
          return null;
        }
      })(),
      portalsPostedCount: property.listings[0].portalListings.filter(
        (pl) => pl.status === 'posted',
      ).length,
    }
  : null,
```

## New Routes

### `GET /agent/portals` (portal.router.ts)
```
Auth: requireAuth + requireRole('agent','admin') + requireTwoFactor
Returns: pages/agent/portals-index.njk (full) or partials/agent/portals-index-table.njk (HTMX)
Data: portalService.getPortalIndex(agentFilter)
```

### `POST /agent/listings/:listingId/photos/download-all` (portal.router.ts)
```
Auth: requireAuth + requireRole('agent','admin') + requireTwoFactor
Action: stream ZIP of all photos, delete files from disk, set listing.photos = null, audit log
Response: application/zip — attachment; filename="photos-{listingId}.zip"
```

## New Service Functions

### `portal.service.ts` — `getPortalsReadyCount(agentId?: string): Promise<number>`
Lightweight count query: listings where `photosApprovedAt IS NOT NULL` AND `descriptionApprovedAt IS NOT NULL` AND `photos IS NOT NULL` AND at least one `portalListing.status != 'posted'`. Used by the sidebar badge middleware.

### `portal.service.ts` — `getPortalIndex(agentId?: string)`
Queries all listings (filtered by agent) with photos or description pending/approved. Returns shaped data for the index table.

### `portal.service.ts` — `downloadAndDeletePhotos(listingId, agentId)`
1. Find listing, parse `photos` JSON
2. Read each `photo.optimizedPath` via `localStorage.read()`
3. Build `{ buffer, filename }` array
4. Delete each file via `localStorage.delete()`
5. `prisma.listing.update({ data: { photos: Prisma.JsonNull } })`
6. Audit log: `listing_photos.downloaded_and_deleted`
7. Return `{ files, listingId }`

The router streams the ZIP using `archiver` (already imported) — same pattern as `POST /agent/sellers/:id/documents/download-all`.

## New/Modified Files

| Action | File |
|--------|------|
| Modify | `src/views/layouts/agent.njk` |
| Create | `src/views/pages/agent/portals-index.njk` |
| Create | `src/views/partials/agent/portals-index-table.njk` |
| Modify | `src/views/pages/agent/portals.njk` |
| Create | `src/views/partials/agent/portal-photos.njk` |
| Create | `src/views/partials/agent/seller-listing-card.njk` |
| Modify | `src/views/pages/agent/seller-detail.njk` |
| Modify | `src/domains/property/portal.router.ts` |
| Modify | `src/domains/property/portal.service.ts` |
| Create | `src/infra/http/middleware/portals-badge.ts` |
| Modify | `src/domains/agent/agent.repository.ts` |
| Modify | `src/domains/agent/agent.service.ts` |

## CSRF & Download Handling

`POST /agent/listings/:listingId/photos/download-all` requires CSRF. The router receives a standard POST (CSRF middleware validates it normally). However, the client side **must use `fetch`** to submit this action — not a plain `<form>` submit — so the browser can intercept the binary blob and trigger `a.click()` to save the ZIP file, then update the photos panel via HTMX to show the "downloaded" state. This is identical to the existing `POST /agent/sellers/:id/documents/download-all` pattern in `seller-detail.njk` (lines 236–268). The `x-csrf-token` header value is read from the hidden `_csrf` input inside the form.

## Testing

- `portal.service.ts` — unit test `downloadAndDeletePhotos`: verifies files read, disk deleted, `photos` set to null, audit logged
- `portal.service.ts` — unit test `getPortalIndex`: verifies agent filter applied, status fields mapped correctly
- `agent.service.ts` — unit test `getSellerDetail`: verifies `photoCount` and `portalsPostedCount` derived correctly
- No E2E for ZIP download (binary response — manual verification sufficient)
