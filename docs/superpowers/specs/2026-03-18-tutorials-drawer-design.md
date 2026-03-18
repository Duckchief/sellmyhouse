# Tutorials Admin Drawer — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Add a right-side slide-in drawer to `/admin/tutorials` so that clicking a table row opens an inline edit form, and the "New Tutorial" button opens an inline create form. This mirrors the existing testimonials drawer pattern exactly.

## Scope

- Row click → drawer with pre-filled edit form
- "New Tutorial" button → drawer with empty create form
- Reorder (↑↓) and Delete buttons are unaffected
- No changes to business logic, routing POST handlers, or data model

---

## 1. New Partial — `tutorial-form-drawer.njk`

Single partial handles both create and edit. No layout wrapper (rendered as HTMX fragment).

**Fields:**
- Title (text input, required, max 150 chars)
- Slug (auto-generated from title via inline script, editable)
- YouTube URL (text input, required)
- Category (select: Photography / Forms / Process / Financial, required)
- Description (textarea, optional)

Display order is not in the drawer — managed by the ↑↓ reorder buttons only.

**Header:** "New Tutorial" or "Edit Tutorial" depending on context (passed via template variable).

**Actions:**
- `×` close button (top right) — dismisses drawer
- "Save Changes" / "Create Tutorial" submit button — POST via HTMX
- "Cancel" button — dismisses drawer

**Form submission:**
- Create: `hx-post="/admin/tutorials"` targeting `#tutorial-list`
- Edit: `hx-post="/admin/tutorials/{{ tutorial.id }}"` targeting `#tutorial-list`
- On success: drawer auto-closes, list refreshes
- On validation error: drawer stays open, errors shown inline beneath fields

**Slug generation:** Inline `<script>` in the partial generates slug from title on `input` event (same logic as current `tutorial-form.njk`). Pre-filled for edit, editable in both modes.

---

## 2. Page Changes

### `tutorials.njk`

Add drawer scaffold (mirrors `testimonials.njk`):

```html
<!-- Backdrop -->
<div id="tutorial-drawer-backdrop"
     class="hidden fixed inset-0 z-[39]"
     data-action="close-tutorial-drawer"></div>

<!-- Panel -->
<div id="tutorial-drawer-panel"
     class="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-40
            translate-x-full opacity-0 pointer-events-none
            transition-all duration-300 ease-out overflow-y-auto"
     aria-hidden="true">
  <div id="tutorial-drawer-content"></div>
</div>
```

Change "New Tutorial" button:
```html
<!-- Before -->
<a href="/admin/tutorials/new">New Tutorial</a>

<!-- After -->
<button hx-get="/admin/tutorials/new"
        hx-target="#tutorial-drawer-content">New Tutorial</button>
```

### `tutorial-list.njk`

Add to each `<tr>`:
```html
data-action="open-tutorial-drawer"
data-tutorial-url="/admin/tutorials/{{ tutorial.id }}/drawer"
```

Add `no-row-click` class to:
- ↑ reorder button form
- ↓ reorder button form
- Delete button / form

### `admin.router.ts`

Two new routes (HTMX fragment only):

| Method | Route | Handler |
|--------|-------|---------|
| `GET` | `/admin/tutorials/new` | Returns `tutorial-form-drawer.njk` (empty) as fragment |
| `GET` | `/admin/tutorials/:id/drawer` | Returns `tutorial-form-drawer.njk` pre-filled as fragment |

Existing routes unchanged:
- `POST /admin/tutorials` — create (drawer POSTs here with HTMX headers)
- `POST /admin/tutorials/:id` — update (drawer POSTs here with HTMX headers)
- `GET /admin/tutorials/:id/edit` — full-page edit form (still accessible directly)

The `GET /admin/tutorials/new` route must be registered **before** `GET /admin/tutorials/:id/drawer` to avoid `:id` capturing `"new"`.

### `public/js/app.js`

Add tutorial drawer handlers mirroring the testimonials handlers:

**Click actions:**
- `open-tutorial-drawer` — reads `data-tutorial-url`, triggers HTMX GET into `#tutorial-drawer-content`
- `close-tutorial-drawer` — adds `translate-x-full opacity-0 pointer-events-none` back; sets `aria-hidden="true"`; hides backdrop

**HTMX events:**
- `htmx:afterRequest` on `#tutorial-drawer-content` — shows panel (removes hide classes) + backdrop
- `htmx:afterRequest` when POST from `#tutorial-drawer-panel` targets `#tutorial-list` — hides drawer on success (status 200)

---

## 3. Error Handling & Edge Cases

- **Validation errors:** Server re-renders `tutorial-form-drawer.njk` with errors. Drawer stays open.
- **Reorder buttons:** `no-row-click` class prevents drawer. HTMX reorder still works as before.
- **Delete button:** `no-row-click` class prevents drawer. Confirm-dialog and redirect unchanged.
- **Tab state:** List refresh after save targets `#tutorial-list` — existing tab content already correct; no change needed.

---

## Files Touched

| File | Change |
|------|--------|
| `src/views/pages/admin/tutorials.njk` | Add drawer scaffold; change New button |
| `src/views/partials/admin/tutorial-list.njk` | Add row data-action; add no-row-click to buttons |
| `src/views/partials/admin/tutorial-form-drawer.njk` | **New file** |
| `src/domains/admin/admin.router.ts` | Add 2 new GET routes |
| `public/js/app.js` | Add tutorial drawer JS handlers |
