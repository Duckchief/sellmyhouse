# Photo Drag-and-Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sellers drag-and-drop photos to reorder them (including on mobile), with the first photo becoming the cover, persisted via the existing `PUT /seller/photos/reorder` endpoint.

**Architecture:** Four changes: (1) fix `displayOrder` assignment in `addPhotoToListing` so uploads land in correct order; (2) add a `{% block scripts %}` extension point to `base.njk` and load SortableJS from CDN on the photos page; (3) add `cursor-grab` to photo cards; (4) wire `initSortable()` in `app.js` — called on `DOMContentLoaded` and after every HTMX swap into `#photo-grid-container`, with an `onEnd` handler that PUTs the new order and updates the DOM.

**Tech Stack:** SortableJS 1.15.6 (CDN), vanilla ES5-compatible JS, Nunjucks, existing `PUT /seller/photos/reorder` endpoint.

---

### Task 1: Fix displayOrder in addPhotoToListing (TDD)

**Files:**
- Modify: `src/domains/property/photo.service.ts` (lines 155–176)
- Test: `src/domains/property/__tests__/photo.service.test.ts`

**Context:** Every photo upload currently gets `displayOrder: 0` (set in the router). `addPhotoToListing` has `photos.length` in scope before appending — the fix overrides whatever `displayOrder` the router passed by assigning `photos.length` here. The test file uses `makePhotoRecord(overrides)` and `makeListing(photos[])` helpers.

- [ ] **Step 1: Write a failing test**

In `src/domains/property/__tests__/photo.service.test.ts`, find the `describe('addPhotoToListing', ...)` block (around line 353). Add a new test inside it:

```ts
it('overrides displayOrder to equal existing photos count', async () => {
  const existing0 = makePhotoRecord({ id: 'p0', displayOrder: 0 });
  const existing1 = makePhotoRecord({ id: 'p1', displayOrder: 1 });
  const listing = makeListing([existing0, existing1]);
  mockedRepo.findActiveListingForProperty.mockResolvedValue(
    listing as unknown as Listing,
  );
  mockedRepo.updateListingPhotos.mockResolvedValue(listing as unknown as Listing);

  // Router always passes displayOrder: 0 — service must override it
  const newPhoto = makePhotoRecord({ id: 'p2', displayOrder: 0 });
  const result = await photoService.addPhotoToListing('prop-1', newPhoto);

  expect(result).toHaveLength(3);
  expect(result[2].id).toBe('p2');
  expect(result[2].displayOrder).toBe(2); // overridden to photos.length
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
npm test -- --testPathPattern="photo.service" --testNamePattern="overrides displayOrder" 2>&1 | tail -15
```

Expected: FAIL — `expect(result[2].displayOrder).toBe(2)` fails because the service currently returns `0`.

- [ ] **Step 3: Implement the fix**

In `src/domains/property/photo.service.ts`, find `addPhotoToListing` (line 155). Change the line that reads:

```ts
const updatedPhotos = [...photos, photo];
```

to:

```ts
const photoWithOrder = { ...photo, displayOrder: photos.length };
const updatedPhotos = [...photos, photoWithOrder];
```

- [ ] **Step 4: Run all photo.service tests to confirm they pass**

```bash
npm test -- --testPathPattern="photo.service" 2>&1 | tail -15
```

Expected: all tests PASS (including the new one and all pre-existing `addPhotoToListing` tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/photo.service.ts src/domains/property/__tests__/photo.service.test.ts
git commit -m "fix: assign correct displayOrder in addPhotoToListing"
```

---

### Task 2: Template changes — scripts block, CDN, cursor

**Files:**
- Modify: `src/views/layouts/base.njk` (line 24)
- Modify: `src/views/pages/seller/photos.njk` (after line 17)
- Modify: `src/views/partials/seller/photo-grid.njk` (line 6, photo card div)

**Context:** `base.njk` currently ends the body with `<script src="/js/app.js" ...></script>` at line 24, then `</body>`. There is no scripts extension block. `photos.njk` currently has no `{% block scripts %}` and extends `layouts/seller.njk` which extends `layouts/base.njk`. `photo-grid.njk` card div (line 6) has classes `relative group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden`.

No automated tests for template changes — verify manually with `npm run build` (compiles Tailwind + TypeScript; confirms no Nunjucks syntax errors at startup).

- [ ] **Step 1: Add scripts extension block to base.njk**

In `src/views/layouts/base.njk`, change line 24–25 from:

```njk
  <script src="/js/app.js" nonce="{{ cspNonce }}"></script>
</body>
```

to:

```njk
  <script src="/js/app.js" nonce="{{ cspNonce }}"></script>
  {% block scripts %}{% endblock %}
</body>
```

- [ ] **Step 2: Add SortableJS CDN script to photos.njk**

In `src/views/pages/seller/photos.njk`, add after the closing `{% endblock %}` on line 17:

```njk
{% block scripts %}
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}
```

The file should now look like:

```njk
{% extends "layouts/seller.njk" %}

{% block content %}
<div class="max-w-4xl mx-auto">
  ...
</div>
{% endblock %}

{% block scripts %}
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js" nonce="{{ cspNonce }}"></script>
{% endblock %}
```

- [ ] **Step 3: Add cursor-grab to photo cards**

In `src/views/partials/seller/photo-grid.njk`, find the photo card div (line 6). Add `cursor-grab` to its class list:

```njk
<div class="relative group bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden cursor-grab"
  data-photo-id="{{ photo.id }}">
```

- [ ] **Step 4: Build to confirm no errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | grep -v "node_modules"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/layouts/base.njk src/views/pages/seller/photos.njk src/views/partials/seller/photo-grid.njk
git commit -m "feat: add scripts block, SortableJS CDN, cursor-grab on photo cards"
```

---

### Task 3: Wire SortableJS in app.js

**Files:**
- Modify: `public/js/app.js` (around lines 880–895)

**Context:** The file is ES5-compatible vanilla JS inside a single outer IIFE. The relevant section:

```
line 874: document.addEventListener('htmx:beforeOnLoad', ...)
line 880: }); // closes htmx:beforeOnLoad
line 881: (blank)
line 882: // ── Photo grid: auto-dismiss error and refresh after 2s ─────────
line 883: document.addEventListener('htmx:afterSwap', function (e) {
line 884:   if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
line 885:   var alertEl = e.detail.target.querySelector('[role="alert"]');
line 886:   if (!alertEl) return;
...
line 895: });
```

The `initSortable` function will be added before the `htmx:afterSwap` listener (after line 880). The `htmx:afterSwap` listener will be modified to call `initSortable()` at the start.

No automated tests — verify with lint + manual browser test.

- [ ] **Step 1: Insert initSortable function and DOMContentLoaded hook**

After the closing `});` of `htmx:beforeOnLoad` (line 880) and before the `// ── Photo grid: auto-dismiss error` comment (line 882), insert:

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

**Important:** Do NOT call `initSortable` twice on the same live `#photo-grid` node. All three call sites (DOMContentLoaded, htmx:afterSwap, and the fetch `.then()`) always follow a DOM replacement, so each call operates on a fresh element.

- [ ] **Step 2: Modify the existing htmx:afterSwap handler**

Find the existing `htmx:afterSwap` handler (around line 882 after your insertion — it will now be a few lines further down). It currently reads:

```js
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
    var alertEl = e.detail.target.querySelector('[role="alert"]');
```

Change it to add `initSortable()` after the early-return guard:

```js
  document.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'photo-grid-container') return;
    initSortable();
    var alertEl = e.detail.target.querySelector('[role="alert"]');
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors. If lint complains about `Sortable` being undefined (no-undef), add `/* global Sortable */` as a comment at the top of the `initSortable` function.

- [ ] **Step 4: Manual verification**

Run `npm run dev` and navigate to `/seller/photos`. Test:

1. With 2+ photos: drag any card to a new position → order updates and the "Cover" badge moves to the first card ✓
2. Simulate mobile (Chrome DevTools → toggle device toolbar): touch-drag a photo to reorder ✓
3. Upload a new photo → grid refreshes, new photo appears at end, remaining order is preserved, grid stays draggable ✓
4. Delete a photo → grid refreshes, remaining photos stay draggable ✓
5. With 0 photos: no JS error on the page (SortableJS not attached, no `#photo-grid` to find) ✓

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js
git commit -m "feat: drag-and-drop photo reorder with SortableJS"
```
