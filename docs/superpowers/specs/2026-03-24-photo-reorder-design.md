# Spec: Photo Drag-and-Drop Reordering

**Date:** 2026-03-24
**Status:** Approved

## Problem

Sellers cannot reorder photos once uploaded. The first photo is the cover image, so position matters — but there is no way to change it. Additionally, new uploads always receive `displayOrder: 0`, leaving the ordering undefined for multi-photo listings.

## Solution

Add SortableJS-powered drag-and-drop reordering to the photo grid. Supports both mouse and touch (mobile). On drop, the new order is sent to the already-implemented `PUT /seller/photos/reorder` endpoint. A one-line bug fix in the router ensures new uploads receive a correct `displayOrder`.

## Behaviour

- Seller drags any photo card to a new position in the grid
- While dragging, a ghost placeholder shows where the card will land (SortableJS default)
- On drop, the new order is persisted immediately via `PUT /seller/photos/reorder`
- The "Cover" badge moves to whichever card is now first
- Works on desktop (mouse) and mobile (touch)
- Grid stays sortable after every photo upload, delete, and reorder (SortableJS re-initialised after each HTMX swap into `#photo-grid-container`)

## Implementation

### 1. Base layout — scripts extension point

**File:** `src/views/layouts/base.njk`

Add `{% block scripts %}{% endblock %}` after the `app.js` script tag, before `</body>`:

```njk
  <script src="/js/app.js" nonce="{{ cspNonce }}"></script>
  {% block scripts %}{% endblock %}
</body>
```

### 2. Photos page — load SortableJS from CDN

**File:** `src/views/pages/seller/photos.njk`

Add at the bottom of the file:

```njk
{% block scripts %}
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}
```

SortableJS is only needed on the photos page, so it is scoped here rather than the layout.

### 3. Photo cards — drag cursor

**File:** `src/views/partials/seller/photo-grid.njk`

Add `cursor-grab` to the photo card `div` so the grab handle is visually obvious:

```njk
<div class="relative group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden cursor-grab"
  data-photo-id="{{ photo.id }}">
```

### 4. Client-side drag-and-drop reorder

**File:** `public/js/app.js`

**Location:** Inside the existing outer IIFE. Add an `initSortable` function and wire it to `DOMContentLoaded` and to the existing `htmx:afterSwap` listener.

#### `initSortable` function

```js
  // ── Photo grid: drag-and-drop reorder ────────────────────────
  function initSortable() {
    var grid = document.getElementById('photo-grid');
    if (!grid || typeof Sortable === 'undefined') return;

    Sortable.create(grid, {
      animation: 150,
      ghostClass: 'opacity-40',
      onEnd: function () {
        var cards = grid.querySelectorAll('[data-photo-id]');
        var photoIds = Array.from(cards).map(function (el) {
          return el.getAttribute('data-photo-id');
        });

        var csrfToken = '';
        var hxHeaders = document.querySelector('body').getAttribute('hx-headers');
        if (hxHeaders) {
          try { csrfToken = JSON.parse(hxHeaders)['x-csrf-token'] || ''; } catch (e) {}
        }

        fetch('/seller/photos/reorder', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ photoIds: photoIds }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error('reorder failed: ' + r.status);
            return r.text();
          })
          .then(function (html) {
            var container = document.getElementById('photo-grid-container');
            if (!container) return;
            container.innerHTML = html;
            htmx.process(container);
            initSortable();
          })
          .catch(function () {
            // On failure restore server order by reloading the grid.
            // htmx.ajax sets HX-Request: true, which the router requires to return
            // the partial instead of the full page.
            htmx.ajax('GET', '/seller/photos', { target: '#photo-grid-container', swap: 'innerHTML' });
          });
      },
    });
  }

  document.addEventListener('DOMContentLoaded', initSortable);
```

#### Wire into the existing `htmx:afterSwap` listener

In the existing `htmx:afterSwap` handler that checks for `photo-grid-container` (the auto-dismiss error handler added previously), add a call to `initSortable()` at the start before the alert check:

```js
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
    initSortable();  // Re-attach SortableJS after any grid swap

    var alertEl = e.detail.target.querySelector('[role="alert"]');
    if (!alertEl) return;
    // ... existing fade-and-refresh logic unchanged ...
  });
```

**Note:** `initSortable` is safe at all three call sites because each call follows a DOM node replacement (`innerHTML` swap or HTMX swap), so it always operates on a fresh `#photo-grid` element. Do NOT call `initSortable` twice on the same live node — SortableJS is not idempotent and a double-attach would cause each `onEnd` to fire twice, sending duplicate reorder requests.

### 5. Bug fix — displayOrder on upload

**File:** `src/domains/property/photo.service.ts`

In `addPhotoToListing`, assign `displayOrder: photos.length` to the incoming photo before appending it. This fix lives in the service (not the router) because the service already reads `photos` from the listing — no extra DB round-trip needed:

```ts
export async function addPhotoToListing(
  propertyId: string,
  photo: PhotoRecord,
): Promise<PhotoRecord[]> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    throw new NotFoundError('Listing', propertyId);
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[])
    : [];

  if (photos.length >= MAX_PHOTOS) {
    throw new ValidationError(`Maximum of ${MAX_PHOTOS} photos allowed per listing`);
  }

  const photoWithOrder = { ...photo, displayOrder: photos.length };
  const updatedPhotos = [...photos, photoWithOrder];
  await propertyRepo.updateListingPhotos(listing.id, updatedPhotos);

  return updatedPhotos;
}
```

The router does not need to change. The `displayOrder: 0` already set in the router is overridden here.

**Why:** Every upload currently sets `displayOrder: 0`. The `getPhotosForProperty` service sorts by `displayOrder`, so with all photos at 0 the order is undefined. Assigning `photos.length` places each new photo at the end.

## CSRF

The `PUT /seller/photos/reorder` route is protected by CSRF middleware. The `fetch` call reads the CSRF token from the `hx-headers` attribute on `<body>` (set by the base layout), which already contains `{"x-csrf-token": "..."}`.

## Scope

- Modify: `src/views/layouts/base.njk` (add `{% block scripts %}`)
- Modify: `src/views/pages/seller/photos.njk` (CDN script tag)
- Modify: `src/views/partials/seller/photo-grid.njk` (`cursor-grab`)
- Modify: `public/js/app.js` (`initSortable`, `onEnd` handler, wire to `htmx:afterSwap`)
- Modify: `src/domains/property/photo.service.ts` (`displayOrder` fix in `addPhotoToListing`)
- No new routes, no schema changes, no migration

## Testing

- Upload 3 photos, drag the third to first position → "Cover" badge moves to it ✓
- Drag on mobile/touch → reorder works ✓
- Upload a 4th photo after reordering → it appends at the end, existing order preserved ✓
- Delete a photo → grid refreshes, remaining photos stay sortable ✓
- Reorder with only 1 photo → no-op (nothing to sort) ✓
