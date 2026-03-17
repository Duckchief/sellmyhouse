# Review Panel Click-Outside to Close — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking anywhere outside the `/agent/reviews` right sidebar closes it.

**Architecture:** Add an invisible full-screen backdrop div (`z-[39]`) that sits just behind the panel (`z-40`). It uses the existing `data-action="close-review-panel"` delegation, and is toggled alongside the panel in three existing locations in `app.js`.

**Tech Stack:** Nunjucks, Tailwind CSS, vanilla JS (app.js)

---

## Chunk 1: All changes

**Files:**
- Modify: `src/views/pages/agent/reviews.njk:44` — add backdrop div before the panel div
- Modify: `public/js/app.js:143–148` — hide backdrop on explicit close
- Modify: `public/js/app.js:253–256` — show backdrop when panel opens
- Modify: `public/js/app.js:258–261` — hide backdrop after approve/reject

---

### Task 1: Add the backdrop div to reviews.njk

- [ ] **Step 1: Add backdrop div**

  In `src/views/pages/agent/reviews.njk`, insert this line immediately before the `{# Right: slide-out detail panel #}` comment (line 43):

  ```html
  {# Invisible click-outside backdrop — closes review panel when open #}
  <div id="review-detail-backdrop" class="hidden fixed inset-0 z-[39]" data-action="close-review-panel"></div>
  ```

  The file should look like this around lines 42–45:

  ```html
  </div>

  {# Invisible click-outside backdrop — closes review panel when open #}
  <div id="review-detail-backdrop" class="hidden fixed inset-0 z-[39]" data-action="close-review-panel"></div>

  {# Right: slide-out detail panel (fixed overlay — does not affect table width) #}
  <div id="review-detail-panel" class="fixed inset-y-0 right-0 w-96 ...
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/views/pages/agent/reviews.njk
  git commit -m "feat: add invisible backdrop div for review panel click-outside"
  ```

---

### Task 2: Wire backdrop toggling in app.js

- [ ] **Step 1: Hide backdrop in the explicit close handler (lines 143–148)**

  Current:
  ```js
  if (action === 'close-review-panel') {
    var reviewPanel = document.getElementById('review-detail-panel');
    if (reviewPanel) {
      reviewPanel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
      reviewPanel.setAttribute('aria-hidden', 'true');
    }
  }
  ```

  Replace with:
  ```js
  if (action === 'close-review-panel') {
    var reviewPanel = document.getElementById('review-detail-panel');
    var reviewBackdrop = document.getElementById('review-detail-backdrop');
    if (reviewPanel) {
      reviewPanel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
      reviewPanel.setAttribute('aria-hidden', 'true');
    }
    if (reviewBackdrop) {
      reviewBackdrop.classList.add('hidden');
    }
  }
  ```

- [ ] **Step 2: Show backdrop when panel opens (lines 253–256)**

  Current:
  ```js
  if (e.detail.target && e.detail.target.id === 'review-detail-content' && e.detail.successful) {
    panel.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
    panel.removeAttribute('aria-hidden');
  }
  ```

  Replace with:
  ```js
  if (e.detail.target && e.detail.target.id === 'review-detail-content' && e.detail.successful) {
    panel.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
    panel.removeAttribute('aria-hidden');
    var backdrop = document.getElementById('review-detail-backdrop');
    if (backdrop) backdrop.classList.remove('hidden');
  }
  ```

- [ ] **Step 3: Hide backdrop after approve/reject (lines 258–261)**

  Current:
  ```js
  if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#review-detail-panel') && e.detail.successful) {
    panel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
    panel.setAttribute('aria-hidden', 'true');
  }
  ```

  Replace with:
  ```js
  if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#review-detail-panel') && e.detail.successful) {
    panel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
    panel.setAttribute('aria-hidden', 'true');
    var backdrop2 = document.getElementById('review-detail-backdrop');
    if (backdrop2) backdrop2.classList.add('hidden');
  }
  ```

- [ ] **Step 4: Verify manually**

  ```bash
  npm run dev
  ```

  Open `/agent/reviews` in the browser:
  1. Click a queue row — panel slides in
  2. Click anywhere on the queue/left side — panel slides out ✓
  3. Click a row, then click the X button — panel slides out ✓
  4. Click a row, approve/reject — panel slides out ✓
  5. Click a row, then click a different row — panel stays open and updates content ✓ (backdrop stays visible)

- [ ] **Step 5: Commit**

  ```bash
  git add public/js/app.js
  git commit -m "feat: close review panel on click outside via invisible backdrop"
  ```
