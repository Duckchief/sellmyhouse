# Design Spec: Market Report — Town-Filtered Flat Type Dropdown + Slider Default

**Date:** 2026-03-17
**Status:** Approved

## Overview

Two improvements to the `/market-report` HDB Market Report page:

1. When the user selects a Town, query available Flat Types for that town and repopulate the Flat Type dropdown accordingly (resetting it to "Select type").
2. Change the Date Range slider default from 2 Years to 1 Year.

## Data Layer

### New repository method
`getDistinctFlatTypesByTown(town: string): Promise<string[]>`

Prisma `findMany` with `distinct: ['flatType']`, `where: { town }`, `orderBy: { flatType: 'asc' }`. Returns a sorted list of flat types available in the given town.

### New service method
`getDistinctFlatTypesByTown(town: string): Promise<string[]>`

Thin wrapper around the repository method, following the same pattern as the existing `getDistinctFlatTypes()`.

## New Endpoint

`GET /api/hdb/flat-types?town=X`

- Protected by the existing `hdbRateLimiter`
- If `town` is present: calls `hdbService.getDistinctFlatTypesByTown(town)`
- If `town` is missing: falls back to `hdbService.getDistinctFlatTypes()` (all flat types)
- Renders `partials/public/flat-type-options.njk`

## New Partial Template

**File:** `src/views/partials/public/flat-type-options.njk`

```nunjucks
<option value="">{{ "Select type" | t }}</option>
{% for ft in flatTypes %}
<option value="{{ ft }}">{{ ft }}</option>
{% endfor %}

<select id="storey-range-select" hx-swap-oob="innerHTML">
  <option value="">{{ "All storeys" | t }}</option>
</select>
```

The primary content (flat-type options) is swapped into the `#flatType` select via `hx-swap="innerHTML"` — HTMX replacing a select's innerHTML with option elements is valid. The OOB `<select>` (must match the tag of the target element) simultaneously resets the storey-range select to "All storeys", since flat type has been cleared and storey filtering is no longer meaningful.

If `getDistinctFlatTypesByTown` returns an empty array (town has no data), the dropdown renders only the "Select type" placeholder — no error state, no disabled state. An unrecognised `town` value will return an empty list from Prisma; no additional server-side validation is required.

## Template Changes (`market-report.njk`)

### Town select — replace existing HTMX attributes

Before:
```html
hx-get="/api/hdb/storey-ranges"
hx-include="#market-report-form"
hx-target="#storey-range-select"
hx-trigger="change"
```

After:
```html
hx-get="/api/hdb/flat-types"
hx-target="#flatType"
hx-swap="innerHTML"
hx-trigger="change"
```

The storey-range reset is handled by the OOB element in the `flat-type-options.njk` response. No `hx-include` is needed: HTMX automatically includes the triggering element's own `name`/`value` in the request, so the `<select name="town">` sends `town=<value>` without any extra configuration.

### Flat Type select — no changes

Retains existing `hx-get="/api/hdb/storey-ranges" hx-include="#market-report-form" hx-trigger="change"` to filter storey ranges when flat type is chosen. The `hx-include` must be retained here so that `/api/hdb/storey-ranges` continues to receive both `town` and `flatType` for accurate filtering.

### Slider default — change to 1 Year

```diff
- <span id="months-label">2 Years</span>
+ <span id="months-label">1 Year</span>

- <input type="range" id="months-slider" min="0" max="6" step="1" value="3" ...>
+ <input type="range" id="months-slider" min="0" max="6" step="1" value="1" ...>

- <input type="hidden" id="months-value" name="months" value="24">
+ <input type="hidden" id="months-value" name="months" value="12">
```

Note: the current template has `value="3"` on the range input but "2 Years"/"24" on the label/hidden — a pre-existing mismatch. This change corrects all three to be consistent at step 1 (1 Year / 12 months).

The full step-to-months mapping (from `app.js`) for reference:

| Slider step | Label | Months value |
|---|---|---|
| 0 | 6 Months | 6 |
| **1** | **1 Year** | **12** ← new default |
| 2 | 2 Years | 24 |
| 3 | 5 Years | 60 |
| 4 | 10 Years | 120 |
| 5 | 20 Years | 240 |
| 6 | All Time | 0 |

## Behaviour Summary

| User action | Result |
|---|---|
| Selects Town | Flat Type dropdown repopulates with types available in that town; resets to "Select type"; Storey Range resets to "All storeys" |
| Selects Flat Type | Storey Range dropdown filters by town+flatType (existing behaviour unchanged) |
| Page load | Slider defaults to 1 Year; URL-param restoration still works correctly |

## No JS Changes Required

`app.js` slider sync and URL-param restoration logic operates off the hidden `months-value` input — no changes needed.

## Tests

- Unit: `hdbRepo.getDistinctFlatTypesByTown` — verify filtered results and empty-town fallback
- Unit: `hdbService.getDistinctFlatTypesByTown` — verify delegation to repo
- Integration: `GET /api/hdb/flat-types?town=BISHAN` — verify partial HTML response contains correct options and OOB storey-range reset
- Integration: `GET /api/hdb/flat-types` (no town param) — verify fallback to all flat types
