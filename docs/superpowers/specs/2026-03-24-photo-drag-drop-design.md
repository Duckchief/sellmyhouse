# Spec: Photo Drag-and-Drop Upload

**Date:** 2026-03-24
**Status:** Approved

## Problem

The `/seller/photos` drop zone shows "Drag and drop photos here, or click to select" but has no drag event listeners. Dropping files does nothing. The click-to-select path works correctly via the existing `auto-submit` handler in `app.js`.

## Solution

Add drag-and-drop event handlers to `app.js`, co-located with the existing `auto-submit` handler. No template or backend changes required.

## Behaviour

- Dragging a file over `#drop-zone` highlights it (blue border + light blue background) to signal it's a valid drop target
- Dropping a file triggers the same upload path as click-to-select: file is assigned to `#photo-input` and `form.requestSubmit()` is called, which fires the existing HTMX `hx-post="/seller/photos"` handler
- Only the first file is used if multiple are dropped (consistent with the single-file input)
- Highlight is managed with an enter-counter (incremented on `dragenter`, decremented on `dragleave`) to prevent flickering when the cursor moves over child elements (SVG icon, text nodes)

## Implementation

**File:** `public/js/app.js`
**Change:** ~25 lines added in the `data-action` handler block

Event listeners attached once on `DOMContentLoaded` (or within the existing init block) targeting `#drop-zone`:

| Event | Action |
|-------|--------|
| `dragenter` | `preventDefault()`, increment counter, add active classes |
| `dragover` | `preventDefault()` + `stopPropagation()` (required to enable drop) |
| `dragleave` | Decrement counter; remove active classes when counter reaches 0 |
| `drop` | `preventDefault()`, reset counter, remove active classes, assign `files[0]` to `#photo-input` via `DataTransfer`, call `form.requestSubmit()` |

**Active classes:** `border-blue-500 bg-blue-50` (replacing `border-gray-300`)

## Scope

- No changes to Nunjucks templates
- No changes to backend / photo service
- No new files

## Testing

- Manual: drag a valid JPG/PNG onto the drop zone → uploads and grid refreshes
- Manual: drag over child elements (icon, text) → no highlight flicker
- Manual: drag off without dropping → highlight removed
- Existing click-to-select path unaffected
