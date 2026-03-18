# Design: Testimonial Town Combobox

**Date:** 2026-03-18
**Feature:** Replace free-text Town input in the Add Testimonial admin drawer with a searchable combobox

## Problem

The Town field in `/admin/content/testimonials` → Add Testimonial drawer is a free-text `<input>`. This allows invalid or inconsistent town values to be entered. The HDB town list is fixed (26 towns), so it should be constrained to valid options with a search-friendly UI.

## Approach

Custom combobox using vanilla JS inline in the Nunjucks partial — a styled text input for search, a hidden input for form submission, and a server-rendered dropdown list.

## Components

### 1. `admin.router.ts`

The GET `/admin/content/testimonials/new` route currently passes no template variables. It must be updated to pass `towns: HDB_TOWNS` (imported from `property.types.ts`). The 422 re-render on POST must also pass `towns: HDB_TOWNS`.

### 2. `testimonial-add-drawer.njk`

Replace the existing `<input type="text" name="clientTown">` with a combobox block:

- **Search input** — visible, text input with a search icon and chevron. Triggers filtering on `oninput`, opens dropdown on `onfocus`, closes on `onblur` (with 150ms delay to allow `mousedown` on list items to fire first).
- **Hidden input** — `<input type="hidden" name="clientTown">` — holds the selected value for form submission.
- **Dropdown list** — absolutely positioned below the input, max-height ~180px with scroll, rendered from the Nunjucks `towns` variable. Filtered client-side via substring match.
- **Inline `<script>`** — ~40 lines of vanilla JS for `filter`, `show`, `hide`, `select` functions. Scoped to the drawer (no global namespace conflicts needed — only one combobox on the page at a time).
- **Pre-fill on re-render** — when `values.clientTown` is set (validation error), the search input and hidden input are pre-populated using Nunjucks.

## Behaviour

1. Click/focus → full 26-town list appears
2. Type → case-insensitive substring filter
3. Click a town → search input shows town name, hidden input stores value, dropdown closes
4. Click away → dropdown closes
5. No match → "No towns found" message
6. Form submission → hidden input value sent as `clientTown`; server validator unchanged

## What Does NOT Change

- Backend validator — `clientTown` is already validated as a string; no enum enforcement needed at the API layer (admin-only form)
- `testimonial-detail-drawer.njk` — read-only view, no change needed
- Database schema, service, or repository layers

## Files Changed

| File | Change |
|---|---|
| `src/domains/admin/admin.router.ts` | Import `HDB_TOWNS`; pass `towns` to GET new + POST 422 re-renders |
| `src/views/partials/admin/testimonial-add-drawer.njk` | Replace `<input type="text">` with combobox markup + inline script |
