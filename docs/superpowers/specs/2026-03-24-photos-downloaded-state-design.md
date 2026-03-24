# Spec: Photos Downloaded State on Seller Photos Page

**Date:** 2026-03-24
**Status:** Approved

## Problem

When an agent downloads and deletes listing photos, the seller's `/seller/photos` page falls through to the generic "No photos uploaded yet" empty state. This is confusing — the seller hasn't failed to upload, their photos were successfully received by the agent.

Additionally, there is no way for the agent to reinstate the seller's upload capability if more photos are needed.

## Solution

Two changes:

1. **Seller page:** Replace both the upload box and the photo grid with a green success banner when photos have been downloaded.
2. **Agent portal:** Add a "Reinstate seller photo upload" button to the portal-photos panel when in the downloaded state.

## Downloaded State Detection

The downloaded state is: `photosApprovedAt !== null AND photos is null/empty`.

This mirrors the existing logic in `portal.service.ts:getPortalIndex` which uses the same condition to set `photosStatus = 'downloaded'`.

---

## Seller Side

### `photo.service.ts` — `getPhotosForProperty`

Change return type from `Promise<PhotoRecord[]>` to `Promise<{ photos: PhotoRecord[], photosDownloaded: boolean }>`.

`photosDownloaded` is true when the listing has `photosApprovedAt !== null` and `photos` is null or empty. If no listing exists, `photosDownloaded` is false.

**Breaking change — all call sites must be updated:**

1. `property.router.ts` — GET `/seller/photos` (full page render and HTMX partial path): destructure `{ photos, photosDownloaded }` from the result.
2. `property.router.ts` — GET `/seller/photos/:id/thumbnail`: calls `getPhotosForProperty` and chains `.find()` directly on the result. Must be updated to destructure `{ photos }` first, then call `photos.find(...)`.
3. `property.router.ts` — POST `/seller/photos` (upload handler, validation-failure branch only): the no-file branch (lines 193–199) hardcodes `photos: []` and does not call `getPhotosForProperty` — no change needed there. The validation-failure branch calls `getPhotosForProperty` and passes the result directly as `photos` to the template. Must be updated to destructure `{ photos }` first. The render target stays as `partials/seller/photo-grid` in this branch (upload in the downloaded state is impossible in practice, but the destructure must be correct to compile).
4. `photo.service.test.ts`: unit tests for `getPhotosForProperty` must be updated to expect `{ photos, photosDownloaded }` return shape. Add two new test cases: (a) listing with `photosApprovedAt` set and empty/null photos → `{ photos: [], photosDownloaded: true }`; (b) listing with `photosApprovedAt` set and non-empty photos → `{ photos: [...], photosDownloaded: false }`.
5. `property.router.test.ts`: tests mock `getPhotosForProperty` returning a bare array. All mocks must be updated to return `{ photos: [], photosDownloaded: false }` (or the appropriate shape per test case).
6. `portal.service.test.ts`: add tests for the new `reinstatePhotoUpload` function covering: success path, ForbiddenError when agent does not own the listing, and audit log written.
7. `portal.router.test.ts`: add a test for `POST /agent/listings/:listingId/photos/reinstate` covering the success path and the forbidden case.
8. `portal.repository.ts` — `reinstateListingPhotos` is a simple single-field Prisma update. It is covered by service-layer mocks in `portal.service.test.ts` and does not need a standalone repository unit test.

### `property.router.ts` — GET `/seller/photos`

Destructure `{ photos, photosDownloaded }`. Pass all three (`photos`, `photoCount`, `photosDownloaded`) to the template. In the downloaded state `photos` will be an empty array and `photoCount` will be 0 — this is correct and intentional; the downloaded banner does not display `photoCount`.

**HTMX partial path:** The existing HTMX branch renders `partials/seller/photo-grid`, which only swaps `#photo-grid-container`. In the downloaded state the upload container is also hidden, so this partial is not the right target. Update the HTMX branch to render `partials/seller/photo-page-body` (a new partial — see below) which covers both containers, targeting `#photo-page-body`.

### New partial: `partials/seller/photo-page-body.njk`

Extract the two `{% include %}` calls (upload area + grid) and the downloaded banner into a single partial. The page template (`pages/seller/photos.njk`) includes this partial once; the HTMX branch also renders this partial.

Content:

```nunjucks
{% if photosDownloaded %}
  {# Green success banner #}
  <div class="...">
    {# checkmark icon + heading + body text #}
  </div>
{% else %}
  <div id="photo-upload-container">
    {% include "partials/seller/photo-upload-area.njk" %}
  </div>
  <div id="photo-grid-container" class="mt-8">
    {% include "partials/seller/photo-grid.njk" %}
  </div>
{% endif %}
```

This ensures both the upload area and grid are hidden together when `photosDownloaded` is true, whether the page is loaded fresh or re-rendered via HTMX.

### `pages/seller/photos.njk`

Replace the two inline `{% include %}` blocks with a single wrapper div `<div id="photo-page-body">` that includes `partials/seller/photo-page-body.njk`. The HTMX swap target becomes `#photo-page-body`.

### Downloaded banner design

```
✓  Photos received by your agent
   Your agent has downloaded your photos and will use them to market your property.
```

Styling: `bg-green-50`, `border border-green-200`, rounded, padded. Green filled circle with white checkmark icon. Heading in `text-green-800 font-semibold`, body in `text-green-700 text-sm`. All strings wrapped in `| t`.

### `photo-upload-area.njk` and `photo-grid.njk`

Not modified. Both partials contain HTMX attributes targeting `#photo-grid-container` (the upload form targets it for post-upload re-render; the delete button targets it for post-delete re-render). That target still exists inside the `{% else %}` branch of `photo-page-body.njk`, so these targets remain valid. Because the downloaded state hides the entire `photo-page-body`, these partials are never rendered when `photosDownloaded` is true — no targeting conflict can arise.

---

## Agent Side

### `portal-photos.njk`

In the existing downloaded branch, add a reinstate form below the italic message. HTMX attributes go on the `<form>` element (consistent with the existing download form pattern — not on the `<button>`):

```html
<p class="text-sm text-gray-500 italic">{{ "Photos have been downloaded and deleted." | t }}</p>
<form hx-post="/agent/listings/{{ listingData.id }}/photos/reinstate"
      hx-target="#portal-photos-panel"
      hx-swap="outerHTML"
      class="mt-3">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
  <button type="submit"
          class="w-full bg-white border border-gray-300 text-gray-700 py-2 rounded text-sm hover:bg-gray-50">
    {{ "↩ Reinstate seller photo upload" | t }}
  </button>
</form>
```

### `portal.service.ts` — `reinstatePhotoUpload`

New function: `reinstatePhotoUpload(listingId, callerAgentId, callerRole)`.

- Auth guard: same as `downloadAndDeletePhotos` — agent must own the listing (or be admin). Throw `ForbiddenError` if not.
- Calls `portalRepo.reinstateListingPhotos(listingId)`.
- Writes audit log: action `listing_photos.upload_reinstated`, entityType `listing`, entityId `listingId`.

### `portal.repository.ts` — `reinstateListingPhotos`

New function: sets `photosApprovedAt = null` on the listing. Does **not** touch `photos` — it is already null after download and should remain null (the seller uploads fresh photos after reinstatement).

```ts
export async function reinstateListingPhotos(listingId: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { photosApprovedAt: null },
  });
}
```

### `portal.router.ts` — POST `/agent/listings/:listingId/photos/reinstate`

New route with `...agentAuth`. After calling `reinstatePhotoUpload`, re-fetch the listing via `portalService.getListingForPortalsPage(listingId, callerAgentId, callerRole)` to get the updated `listingData` shape (same object the portals page already uses), then render `partials/agent/portal-photos` with `{ listingData }`. Do not pass `csrfToken` explicitly — it is injected into `res.locals` globally by the CSRF middleware and is available in every template automatically.

---

## Out of Scope

- No database schema changes (no new columns)
- No changes to the download flow itself
- No seller notification when reinstate happens
- The seller photo upload rate limits are unchanged
