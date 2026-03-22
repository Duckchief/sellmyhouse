# Design: Replace /admin/pipeline with Enhanced /admin/sellers

**Date:** 2026-03-22
**Status:** Approved

## Problem

`/admin/pipeline` and `/admin/sellers` are largely duplicate pages. Pipeline is a read-only grouped overview with no search, no actions, and 5 separate count queries. Sellers now has status pills with counts, search, and assign/reassign actions. Pipeline's only unique features were tooltips on the stage cards and showing Phone/Town/Asking Price — both easy to add to sellers. Keeping both creates maintenance drift.

## Goal

Make `/admin/sellers` the single admin sellers management page. Redirect `/admin/pipeline` for backward compatibility. Delete all pipeline-specific code. Also add tooltips to `/agent/sellers` pills for consistency with the agent dashboard.

## Visual Changes

### Pills (both `/agent/sellers` and `/admin/sellers`)
Add a `?` hover tooltip to each pill, matching the pattern used on `/admin/pipeline` and `/agent/dashboard`. Tooltip text:
- All: "All sellers currently in your pipeline"
- Lead: "New enquiry received. Not yet contacted or assigned to an agent"
- Engaged: "In active consultation. EAA being prepared or signed"
- Active: "Property listed and transaction in progress. Viewings, offers, OTP"
- Completed: "Transaction closed. Commission paid"
- Archived: "Case closed without a completed transaction, or past retention period"

The `pillList` in `seller-status-pills.njk` gains a `tooltip` field per entry. The `?` bubble sits `absolute top-2 right-2` inside each pill button (same markup as pipeline cards). Each pill button needs `relative` added to its class.

### Admin seller list columns
Current: Name+Email, Agent, Status badge, Actions
New: Name+Email, Phone, Town, Agent, Asking Price, Status badge, Actions

Status badge stays — useful when viewing "All", harmless when filtered by status.

### Nav sidebar
Remove the "Pipeline" entry from `src/views/layouts/admin.njk`. "Sellers" already exists in the nav and remains unchanged.

## Backend Changes

### `admin.repository.ts` — `findAllSellers`
Add `properties: { take: 1, select: { town: true, askingPrice: true } }` to the Prisma select. Map `town` and `askingPrice` through the return value.

### `admin.router.ts` — `/admin/pipeline` route
Replace the full handler with `res.redirect('/admin/sellers')`. No data fetching, no rendering.

### Agent sellers
No backend changes — `getSellerList` in `agent.repository.ts` already fetches `town` and `askingPrice` via the `properties` relation. Only template and pills partial change.

## Deletions

### Service functions (admin.service.ts)
- `getAdminPipeline`
- `getAdminPipelineCounts`

### Repository functions (admin.repository.ts)
- `getPipelineForAdmin`
- `countPipelineStage`

### Types (admin.types.ts)
- `AdminPipelineResult`
- `AdminPipelineStage`

### Tests
- `getAdminPipeline` describe block in `admin.service.test.ts`
- Any pipeline-specific route tests in `admin.router.test.ts`

### Views
- `src/views/pages/admin/pipeline.njk`
- `src/views/partials/admin/pipeline-table.njk`

## What Is Not Changing

- `/agent/dashboard` — left alone; it's a live command centre with auto-refresh and pipeline value metrics, not a duplicate of sellers
- Agent seller list columns — already has town and asking price in the data layer; template update is out of scope for this change (sellers page is agent-facing operational list, not an overview)
- Pagination, search, HTMX behaviour — unchanged
- Assign/Reassign actions — unchanged
