# Admin Unassigned Sellers Filter — Design

**Date:** 2026-03-23

## Problem

The admin seller list at `/admin/sellers` has no way to filter by agent assignment. Admins need to quickly find unassigned sellers and filter by specific agents.

## Design

### UI: Smart dropdown in filter form

A `<select>` dropdown added to the existing filter form in `sellers.njk`, positioned after the search input and before the "Filter" button:

```
[Search bar] [Assignment: All ▾] [Filter]
```

**Dropdown options:**
- **All** (default, value `""`) — no agent filter
- **Unassigned** (value `"unassigned"`) — sellers with no agent
- **--- separator ---** (disabled option)
- **Agent Name 1** (value = agent UUID)
- **Agent Name 2** (value = agent UUID)
- ... (only active agents, sorted alphabetically by name)

The dropdown preserves its selected value across filter submissions via the existing HTMX `hx-get` form pattern.

### Backend changes

**Router** (`admin.router.ts`):
- Pass `agentId` query param through to `findAllSellers()`
- Pass list of active agents to the template for populating the dropdown

**Repository** (`admin.repository.ts`):
- In `findAllSellers()`, when `agentId === "unassigned"`, set `where.agentId = null` (Prisma `null` matches rows with no agent)
- Otherwise, existing `agentId` string filter works as-is

**Data for dropdown**: Fetch active agents (existing query) and pass to the sellers template.

### No schema changes needed

The `agentId` field on Seller is already nullable and indexed with `@@index([agentId, status])`.

## Alternatives considered

1. **Inline toggle + dropdown (side by side)** — Toggle and dropdown mutually exclusive. Rejected: wider row, mutual-exclusion JS logic.
2. **Pill toggle + dropdown (hybrid)** — Mini pill toggle for All/Unassigned + separate agent dropdown. Rejected: more complex interaction logic for marginal UX benefit.

Approach B (single smart dropdown) was chosen for compactness, zero mutual-exclusion logic, and consistency with existing dropdown patterns in the admin UI.
