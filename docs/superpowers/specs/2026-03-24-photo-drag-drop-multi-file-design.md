# Spec: Multi-File Drag-and-Drop Upload

**Date:** 2026-03-24
**Status:** Approved
**Extends:** `2026-03-24-photo-drag-drop-design.md`

## Problem

The existing drag-and-drop implementation (commit `5efbebc`) only uploads `files[0]` — the first file in the drop. Dropping multiple photos at once silently discards all but the first.

## Solution

Replace the single-file drop path with a queue-based sequential upload in the existing drag-and-drop IIFE in `public/js/app.js`. No template or backend changes required.

## Behaviour

- Dropping multiple files queues all of them for sequential upload
- `processNextUpload()` uploads one file at a time via the existing HTMX form path
- After each HTMX response (`htmx:afterRequest` on `#photo-upload-form`), the next file in the queue is uploaded
- The grid refreshes after each individual upload — photos appear progressively
- If a file fails server-side validation, the error renders in the grid as today; the queue advances to the next file regardless
- When the queue empties the `htmx:afterRequest` listener removes itself
- Dropping a single file continues to work identically to today (queue of length 1)

## Implementation

**File:** `public/js/app.js`
**Change:** Inside the existing drag-and-drop IIFE, replace the single-file drop logic (~5 lines) with queue logic (~20 lines)

### Drop handler change

**Remove:**
```js
var file = e.dataTransfer.files[0];
if (!file) return;

var input = document.getElementById('photo-input');
var form = document.getElementById('photo-upload-form');
if (!input || !form) return;

var dt = new DataTransfer();
dt.items.add(file);
input.files = dt.files;
form.requestSubmit();
```

**Replace with:**
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

## Scope

- No changes to Nunjucks templates
- No changes to backend / photo service / router
- No new files

## Testing

- Drop 3 valid photos → all 3 appear in the grid sequentially
- Drop 1 valid photo → works as before
- Drop a mix of valid and invalid (oversized) photos → invalid shows error in grid, valid photos still upload
- Click "Choose Photo" path unaffected
- Highlight (blue border) clears after drop as before
