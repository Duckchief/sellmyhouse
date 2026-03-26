# Photo Error Auto-Dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-dismiss photo upload error messages after 2 seconds (300ms CSS fade), then refresh the photo grid.

**Architecture:** Two file changes — a Nunjucks template change adds `role="alert"` to explicit error renders in `photo-grid.njk`, and a vanilla JS `htmx:afterSwap` listener in `app.js` detects that sentinel, fades it out, then reloads the grid via `htmx.ajax`. No backend changes.

**Tech Stack:** Nunjucks templates, vanilla JS (ES5-compatible), HTMX (`htmx.ajax`).

---

### Task 1: Add error rendering to photo-grid.njk

**Files:**
- Modify: `src/views/partials/seller/photo-grid.njk`

**Context:** The router passes an `error` string to this template for validation failures (no file, wrong type, too large). The template currently ignores it — sellers never see these errors. The fix adds a `role="alert"` div at the top so the JS listener can detect it and the spec's Path 2 error flow works.

- [ ] **Step 1: Open the file**

Read `src/views/partials/seller/photo-grid.njk`. Confirm line 1 is `{% if photos and photos.length > 0 %}` with no error block above it.

- [ ] **Step 2: Add the error block**

Insert the following at the very top of the file, before line 1:

```njk
{% if error %}
<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
  {{ error }}
</div>
{% endif %}
```

The `role="alert"` attribute is the sentinel the JS listener uses — do not omit it.

**Note:** Do NOT use `{% include "partials/error-message.njk" %}` here. That partial uses a `message` variable; this template uses `error`. Use the inline div above.

- [ ] **Step 3: Verify the file looks correct**

After editing, the top of the file should read:

```njk
{% if error %}
<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
  {{ error }}
</div>
{% endif %}
{% if photos and photos.length > 0 %}
...
```

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/seller/photo-grid.njk
git commit -m "feat: render error message in photo-grid with role=alert"
```

---

### Task 2: Add htmx:afterSwap auto-dismiss listener to app.js

**Files:**
- Modify: `public/js/app.js`

**Context:** The outer IIFE in `app.js` has HTMX event listeners grouped together. The `htmx:beforeOnLoad` listener is at line ~874. Add the new photo grid auto-dismiss listener immediately after it (after the closing `});` of `htmx:beforeOnLoad`).

The listener detects when an error is swapped into `#photo-grid-container`, waits 1700ms, starts a 300ms CSS opacity fade, then calls `htmx.ajax` to reload the grid (2000ms total). This handles both error paths:
- **Path 1 (exception errors):** `htmx:beforeOnLoad` forces 4xx responses to swap into `#photo-grid-container` using `partials/error-message.njk` which already has `role="alert"`.
- **Path 2 (explicit validation errors):** Router renders `photo-grid.njk` with an `error` variable — the template change in Task 1 adds `role="alert"`.

- [ ] **Step 1: Locate the insertion point**

In `public/js/app.js`, search for `htmx:beforeOnLoad`. It appears around line 874. Find its closing `});` (around line 880). The new listener goes immediately after that line.

- [ ] **Step 2: Insert the listener**

After the closing `});` of the `htmx:beforeOnLoad` listener, add:

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

**Important:** This is the second `htmx:afterSwap` listener in the file. The existing one (around line 670) targets `#report-results` — it is unrelated and must not be removed or modified.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors. If lint complains about `alert` shadowing a global, rename the variable to `alertEl`.

- [ ] **Step 4: Manual verification**

Run `npm run dev` and navigate to `/seller/photos`. Test:

1. Upload a duplicate photo → error "This photo has already been uploaded." appears, fades out after ~2s, grid refreshes showing existing photos ✓
2. Upload a photo with the wrong file type (e.g. a `.txt` file) → error appears, fades and refreshes ✓
3. Upload a valid new photo → no fade timer fires (no `[role="alert"]` in the swap) ✓

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js
git commit -m "feat: auto-dismiss photo error after 2s and refresh grid"
```
