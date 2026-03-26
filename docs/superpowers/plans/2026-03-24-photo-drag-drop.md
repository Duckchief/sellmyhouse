# Photo Drag-and-Drop Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire drag-and-drop event listeners to the `#drop-zone` element so dropped photos upload immediately via the existing HTMX form.

**Architecture:** All changes in `public/js/app.js`. On `drop`, assign the file to `#photo-input` via a `DataTransfer` object and call `form.requestSubmit()` — identical to the click path. An enter-counter on `dragenter`/`dragleave` prevents highlight flickering when the cursor moves over child elements.

**Tech Stack:** Vanilla JS (ES5-compatible, matching existing app.js style), HTMX (no changes), Tailwind CSS classes for visual state.

---

### Task 1: Add drag-and-drop handlers to app.js

**Files:**
- Modify: `public/js/app.js` (near existing `auto-submit` handler, around line 430)

**Context:** The existing `auto-submit` handler (line 430–434) is inside a `change` event listener. The drag-and-drop listeners should be added in the same initialisation block, after the `auto-submit` handler.

Find the end of the `auto-submit` block in `app.js` — it looks like:

```js
    // Photo upload area: auto-submit the enclosing form on file selection
    if (action === 'auto-submit') {
      var form = el.closest('form');
      if (form) form.requestSubmit();
    }
```

- [ ] **Step 1: Write the failing manual test checklist (no automated test needed)**

This feature has no unit-testable logic — it is pure DOM event wiring. The acceptance criteria are:

1. Drag a valid JPG over the drop zone → border turns blue, background turns light blue
2. Drag over child elements (SVG icon, text) → no flicker
3. Drag off without dropping → highlight is removed
4. Drop a valid JPG → photo uploads and grid refreshes (same as click path)
5. Drop with no file → nothing happens (no error)
6. Existing click-to-select path still works

Before coding, open the app in the browser at `/seller/photos` and confirm drag currently does nothing.

- [ ] **Step 2: Add the drag-and-drop block to app.js**

Locate the end of the `auto-submit` handler (around line 434 in `app.js`). Add the following block immediately after it, before the next comment/handler:

```js
    // Photo upload area: drag-and-drop onto #drop-zone
    var dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      var dragCounter = 0;

      dropZone.addEventListener('dragenter', function (e) {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
        dropZone.classList.remove('border-gray-300');
      });

      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });

      dropZone.addEventListener('dragleave', function () {
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          dropZone.classList.remove('border-blue-500', 'bg-blue-50');
          dropZone.classList.add('border-gray-300');
        }
      });

      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
        dropZone.classList.add('border-gray-300');

        var file = e.dataTransfer.files[0];
        if (!file) return;

        var input = document.getElementById('photo-input');
        var form = document.getElementById('photo-upload-form');
        if (!input || !form) return;

        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        form.requestSubmit();
      });
    }
```

- [ ] **Step 3: Verify manually in the browser**

Run `npm run dev` and navigate to `/seller/photos`. Work through the acceptance criteria from Step 1:

1. Drag a JPG over drop zone → border turns blue ✓
2. Hover over the SVG icon while dragging → no flicker ✓
3. Drag off → border returns to gray ✓
4. Drop a JPG → upload succeeds, grid shows new photo ✓
5. Drop nothing (empty drag) → nothing breaks ✓
6. Click "Choose Photo" → still works ✓

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: wire drag-and-drop upload to photo drop zone"
```
