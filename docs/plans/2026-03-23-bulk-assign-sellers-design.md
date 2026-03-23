# Bulk Select & Assign Sellers — Design

**Date:** 2026-03-23

## Problem

Admins must assign/reassign sellers one at a time via individual modals. For bulk operations (e.g., assigning all unassigned sellers to an agent), this is tedious.

## Design

### Checkboxes in seller table (`seller-list.njk`)

- **Header row:** "Select all" checkbox as first `<th>`, toggles all row checkboxes via inline `onclick`
- **Each row:** Checkbox as first `<td>` with `value="{{ seller.id }}"` and class `seller-checkbox`

### Bulk action bar

A `<div>` above the table inside `seller-list.njk` (included in HTMX refreshes), hidden by default. Inline `<script>` listens for checkbox `change` events via event delegation on `#seller-list`, shows/hides bar based on checked count. Bar contains an "Assign" button that loads the bulk-assign modal.

### Bulk assign modal (`assign-bulk-modal.njk`)

Similar to existing `assign-modal.njk`:
- Title: "Assign X sellers"
- Active-agent dropdown
- Hidden inputs for selected seller IDs (passed as query params when loading modal)
- Posts to `POST /admin/sellers/bulk-assign`

### New backend routes

**GET `/admin/sellers/bulk-assign-modal`**
- Query: `sellerIds=id1,id2,...`
- Renders `assign-bulk-modal.njk` with active agents and seller count

**POST `/admin/sellers/bulk-assign`**
- Body: `{ sellerIds: string[], agentId: string }`
- Per seller: calls existing `assignSeller` or `reassignSeller` based on whether seller already has an agent
- Try/catch per seller — one failure doesn't block the rest
- Returns success with count, triggers `sellerAssigned` to refresh list

### No new service methods

Bulk endpoint reuses existing `assignSeller`/`reassignSeller` service methods — all validation, notification, and audit logic preserved.
