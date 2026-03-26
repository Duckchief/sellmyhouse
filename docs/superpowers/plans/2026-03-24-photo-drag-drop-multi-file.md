# Multi-File Drag-and-Drop Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file drop path with a queue-based sequential upload so all dropped photos upload one by one via the existing HTMX form.

**Architecture:** All changes are inside the drag-and-drop IIFE in `public/js/app.js`. On drop, all files are pushed into an `uploadQueue` array. `processNextUpload()` uploads one file at a time; a `htmx:afterRequest` listener on the form advances the queue after each response and removes itself when the queue is empty.

**Tech Stack:** Vanilla JS (ES5-compatible style), HTMX events (`htmx:afterRequest`).

---

### Task 1: Replace single-file drop logic with queue-based sequential upload

**Files:**
- Modify: `public/js/app.js` — inside the drag-and-drop IIFE (search for `drag-and-drop onto #drop-zone`)

**Context:** The current drop handler ends with this block (around line 480–497 after the two drag-drop commits):

```js
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
```

Replace only the section after the highlight-reset lines (i.e. from `var file = ...` to `form.requestSubmit();`) with the queue logic below.

- [ ] **Step 1: Locate the drop handler in app.js**

Search for `drag-and-drop onto #drop-zone` in `public/js/app.js`. Confirm the drop handler ends with `form.requestSubmit();` and that the single-file section starts with `var file = e.dataTransfer.files[0];`.

- [ ] **Step 2: Replace the single-file section with queue logic**

Replace from `var file = e.dataTransfer.files[0];` to the closing `form.requestSubmit();` (inclusive) with:

```js
        var input = document.getElementById('photo-input');
        var form = document.getElementById('photo-upload-form');
        if (!input || !form) return;

        var uploadQueue = Array.from(e.dataTransfer.files);
        if (uploadQueue.length === 0) return;

        function processNextUpload() {
          var next = uploadQueue.shift();
          if (!next) return;
          var dt = new DataTransfer();
          dt.items.add(next);
          input.files = dt.files;
          form.requestSubmit();
        }

        function onAfterRequest() {
          if (uploadQueue.length === 0) {
            form.removeEventListener('htmx:afterRequest', onAfterRequest);
            return;
          }
          processNextUpload();
        }

        form.addEventListener('htmx:afterRequest', onAfterRequest);
        processNextUpload();
```

The highlight-reset lines (`dragCounter = 0; dropZone.classList...`) stay unchanged above this block.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings related to your change.

- [ ] **Step 4: Verify manually in the browser**

Run `npm run dev` and navigate to `/seller/photos`. Test each acceptance criterion:

1. Drop 3 valid JPGs at once → all 3 appear in the grid sequentially (grid refreshes after each) ✓
2. Drop 1 valid JPG → uploads as before ✓
3. Drop an oversized file (>5MB) alongside a valid file → error renders for the bad one, valid file still uploads ✓
4. Drop with no files (empty drag) → nothing happens ✓
5. Click "Choose Photo" path → still works ✓
6. Drop a batch, then immediately drop another batch → second batch queues correctly (no stale listeners) ✓

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js
git commit -m "feat: queue-based sequential upload for multi-file drag-and-drop"
```
