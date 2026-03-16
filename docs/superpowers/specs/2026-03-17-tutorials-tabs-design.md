# Video Tutorials Page — Tab Redesign

**Date:** 2026-03-17
**Page:** `/admin/tutorials`
**Status:** Approved

## Summary

Redesign the Video Tutorials admin page to use underline tabs (one per category) instead of stacking all four categories vertically. Tab switching is URL-based (`?tab=photography`) with HTMX swapping only the `#tutorial-list` container.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tab style | Underline (border-bottom highlight) | Consistent with existing agent/reviews page pattern |
| Tab switching | URL-based + HTMX | Shareable URL, survives refresh, matches agent/reviews |
| HTMX swap target | `#tutorial-list` only | Minimal DOM churn; reorder already targets this element |

## Tab Categories

Four tabs, one per `VideoCategory`:
- Photography
- Forms
- Process
- Financial

Default tab: `photography` (when no `?tab=` param present).

Each tab shows a count badge (tutorial count for that category).

## What Changes

### `src/views/pages/admin/tutorials.njk`
- Add underline tab bar above `#tutorial-list`
- Active tab styled with `border-indigo-600 text-indigo-600`; inactive tabs `text-gray-500 hover:text-gray-700`
- Each tab: `<a href="?tab=key" hx-get="/admin/tutorials?tab=key" hx-target="#tutorial-list" hx-push-url="true">`
- Count badge on each tab
- `+ Add Tutorial` button links to `/admin/tutorials/new?category=<activeTab>` to pre-select the category

### `src/views/partials/admin/tutorial-list.njk`
- Was: iterates all categories, renders each as a stacked section with h2 heading
- Now: renders only the active category's table (no h2 heading needed — tab bar provides the label)
- Empty state: "No tutorials in this category yet."

### `src/domains/admin/admin.router.ts` — `GET /admin/tutorials`
- Read `req.query.tab`, default to `'photography'`
- Validate tab value is one of the four valid categories; fall back to `'photography'` if invalid
- Pass to template: `activeTab`, `tabCounts` (object with count per category)
- HTMX requests return `partials/admin/tutorial-list` partial only (existing behaviour preserved)

### Reorder forms (`src/views/partials/admin/tutorial-row.njk`)
- Add hidden input or append `?tab=<activeTab>` to the `hx-post` action so reorder responses re-render the correct category

### `tutorial-form.njk`
- Pre-select the category dropdown when `?category=` query param is present (new behaviour)
- No structural changes

## What Stays the Same

- `tutorial-row.njk` structure — unchanged
- All POST/DELETE routes — unchanged
- `contentService.getTutorialsGrouped()` — unchanged (still returns all categories; router filters)
- `validateTutorialCreate` / `validateTutorialUpdate` — unchanged

## URL Behaviour

| URL | Behaviour |
|-----|-----------|
| `/admin/tutorials` | Redirects to or renders with `tab=photography` |
| `/admin/tutorials?tab=forms` | Shows Forms tab active |
| `/admin/tutorials?tab=invalid` | Falls back to photography |
| HTMX tab click | `hx-push-url="true"` updates address bar |

## Tests

- Router unit test: `activeTab` defaults to `photography`; respects valid `?tab=` values; ignores invalid values
- Router unit test: HTMX request returns partial only
- View: no new server-side logic to test in partials
