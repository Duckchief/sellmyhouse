# Reactive Seller Filters — Design

**Date:** 2026-03-23

## Problem

The admin sellers page requires clicking a "Filter" button to apply search and dropdown filters. This adds friction — the filters should be reactive.

## Design

Remove the Filter button. Make search and dropdown trigger independently via HTMX.

### Search input
- `hx-get="/admin/sellers"`
- `hx-trigger="input changed delay:300ms"` — debounce 300ms
- `hx-target="#seller-list"`
- `hx-include="[name=status],[name=agentId]"` — include other filter values

### Agent dropdown
- `hx-get="/admin/sellers"`
- `hx-trigger="change"` — fires immediately on selection
- `hx-target="#seller-list"`
- `hx-include="[name=status],[name=search]"` — include other filter values

### Form wrapper
Keep the `<form>` for structure/accessibility but remove `hx-trigger="submit"` and the submit button.

### No backend changes
Router already reads `agentId`, `search`, and `status` from query params.

### Status pills
Already work independently — no change needed.
