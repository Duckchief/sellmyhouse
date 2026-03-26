# Spec: Photo Error Auto-Dismiss

**Date:** 2026-03-24
**Status:** Approved

## Problem

When a photo upload fails (e.g. duplicate detection, validation error), the error message rendered into `#photo-grid-container` stays indefinitely. The seller must manually act to see the photo grid again.

## Solution

Add a `htmx:afterSwap` listener in `public/js/app.js` that detects when an error is swapped into `#photo-grid-container`, waits 2 seconds (with a CSS fade in the last 300ms), then reloads the photo grid via an HTMX GET.

## Behaviour

- When `htmx:afterSwap` fires with `event.detail.target.id === 'photo-grid-container'` and the container contains a `[role="alert"]` element, start the dismiss sequence
- After 1,700ms: set `transition: opacity 0.3s` and `opacity: 0` on the alert element (begins 300ms fade)
- After another 300ms (2,000ms total): call `htmx.ajax('GET', '/seller/photos', { target: '#photo-grid-container', swap: 'innerHTML' })` — the server's HTMX branch returns `partials/seller/photo-grid` with the current photos
- If another swap fires while the timer is pending (user uploads again), the new swap event handles itself independently; the old timer fires harmlessly (another grid refresh)

## Why `role="alert"`

The `partials/error-message.njk` template already has `role="alert"` on its root div. This is a stable semantic selector that won't break if CSS classes change.

## Two error paths — both produce `[role="alert"]` in `#photo-grid-container`

**Path 1 — Exception errors (e.g. duplicate detection):** `processAndSavePhoto` throws `ValidationError` → `next(err)` → global error handler renders `partials/error-message.njk` (which has `role="alert"`) → the existing `htmx:beforeOnLoad` listener in `app.js` forces the 4xx response to swap into `#photo-grid-container`. No router or template change needed for this path.

**Path 2 — Explicit error renders (e.g. no file, wrong type, too large):** The router calls `res.render('partials/seller/photo-grid', { error: '...' })`. `photo-grid.njk` currently ignores the `error` variable — the template change adds the `role="alert"` div so this path is also handled.

Both paths produce a `[role="alert"]` element in `#photo-grid-container`, which the JS listener detects.

## Implementation

**File:** `public/js/app.js`
**Location:** Inside the existing outer IIFE, after the drag-and-drop IIFE, in the same section as the other `htmx:*` listeners

```js
  // ── Photo grid: auto-dismiss error and refresh after 2s ─────────
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
    var alert = e.detail.target.querySelector('[role="alert"]');
    if (!alert) return;

    setTimeout(function () {
      alert.style.transition = 'opacity 0.3s';
      alert.style.opacity = '0';
      setTimeout(function () {
        htmx.ajax('GET', '/seller/photos', { target: '#photo-grid-container', swap: 'innerHTML' });
      }, 300);
    }, 1700);
  });
```

## Scope

- Modify: `public/js/app.js` (~10 lines)
- Modify: `src/views/partials/seller/photo-grid.njk` — add error rendering at the top
- No router or backend changes

## Template change

`photo-grid.njk` currently ignores the `error` variable passed by the router. Add an error block at the very top of the file, before the photos grid:

```njk
{% if error %}
<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
  {{ error }}
</div>
{% endif %}
```

This gives the JS listener a `[role="alert"]` element to detect in `#photo-grid-container`. The inline div is used (not `{% include "partials/error-message.njk" %}`) because the partial uses a `message` variable while the grid uses `error`.

## Testing

- Upload a duplicate photo → error appears, fades out after ~2s, grid refreshes with existing photos
- Upload an invalid photo (wrong type / too large) → same dismiss behaviour
- Upload a valid photo → no dismiss timer fires (no `[role="alert"]` in the swap)
