# Agent Sellers Search Fix

**Date:** 2026-03-17
**Status:** Approved

## Problem

The search function on `/agent/sellers` does nothing when the user types in the search box. Root cause: the form uses `hx-trigger="keyup changed delay:300ms from:find input[name=search]"` which does not fire in HTMX 2.0.4. Pagination links also drop all filter state (search, status, town) when navigating pages.

## Design

### Form (`src/views/pages/agent/sellers.njk`)

- Add `id="seller-filter-form"` to the form element
- Replace `hx-trigger="change, keyup changed delay:300ms from:find input[name=search]"` with `hx-trigger="submit"`
- Add a Search submit button at the end of the form

### Pagination (`src/views/partials/agent/seller-list.njk`)

- Add `hx-include="#seller-filter-form"` to each pagination `<a>` element so HTMX merges current filter values (search, status, town, etc.) with the page number from the URL

### No backend changes required.

## Behaviour After Fix

- User fills in any combination of filters, clicks Search → form submits, `#seller-list` updates via HTMX
- Pagination carries filter state forward
- Consistent with the admin sellers page which uses the same submit pattern
