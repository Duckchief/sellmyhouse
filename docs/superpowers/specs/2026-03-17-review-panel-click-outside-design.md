# Review Panel Click-Outside to Close

**Date:** 2026-03-17
**Status:** Approved

## Problem

The `/agent/reviews` right sidebar panel has only one close mechanism: the explicit X button. Clicking outside the panel does nothing, which feels unnatural.

## Solution

Add an invisible backdrop div behind the panel that captures outside clicks and closes the panel.

## Design

### Approach: Invisible backdrop (z-39)

Add `<div id="review-detail-backdrop">` to `reviews.njk`:
- `fixed inset-0 z-39` — full screen, just below the panel (`z-40`)
- No background colour — invisible, purely a click-capture layer
- `hidden` by default

### Toggling

Toggle `hidden` on the backdrop in the same three places in `app.js` where the panel is already shown/hidden:

1. **`htmx:afterRequest` — panel shown:** remove `hidden` from backdrop
2. **`close-review-panel` action — panel hidden:** add `hidden` to backdrop
3. **Post-approve/reject — panel hidden:** add `hidden` to backdrop

### Click handler

The backdrop uses `data-action="close-review-panel"` — the existing delegated click handler already handles this, closing the panel and hiding the backdrop in one action. No new handler needed.

### Edge cases

- **Row click while panel open:** HTMX fires a new detail request; `htmx:afterRequest` re-shows the panel and the backdrop is already visible. No extra handling needed.
- **Approve/reject inside panel:** Forms fire from within `#review-detail-panel` so they are above the backdrop — clicks reach the buttons normally.

## Files Changed

| File | Change |
|------|--------|
| `src/views/pages/agent/reviews.njk` | Add `#review-detail-backdrop` div before or after the panel div |
| `public/js/app.js` | Toggle `hidden` on backdrop in 3 existing panel show/hide locations |
