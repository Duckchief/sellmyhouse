# Lead Queue — Unassigned Grouping Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

The agent dashboard displays "X new leads awaiting assignment" (sellers with `status='lead' AND agentId=null`). Clicking "View Leads" navigates to the Lead Queue, but the queue shows all leads with `status='lead'` in a flat list with no indication of which are the unassigned ones the dashboard was referring to.

## Goal

When unassigned leads exist, group the Lead Queue into two sections:

1. **Unassigned Leads** — sellers with `agentId=null`, at the top
2. **All Leads** — all leads (unassigned + assigned), below

When no unassigned leads exist, the page renders exactly as today (flat list, no section headings).

## Data Layer

### `LeadQueueItem` (agent.types.ts)

Add one field:

```typescript
agentId: string | null;
```

### `getLeadQueue` service (agent.service.ts)

Change return type from `LeadQueueItem[]` to a `LeadQueueResult` interface:

```typescript
interface LeadQueueResult {
  unassigned: LeadQueueItem[]; // sellers with agentId === null
  all: LeadQueueItem[];        // all leads in createdAt ASC order
}
```

The repository already selects `agentId`. The service partitions the mapped array:

- `unassigned`: items where `agentId === null`
- `all`: the full mapped array (both unassigned and assigned), preserving repo order

`all` is used for the "All Leads" section, which shows every lead regardless of assignment.

### Router (agent.router.ts)

Pass both arrays to the template:

```typescript
res.render('pages/agent/leads', { unassigned, all });
```

Or for the HTMX partial:

```typescript
res.render('partials/agent/lead-queue', { unassigned, all });
```

## Template Layer (`lead-queue.njk`)

**When `unassigned` is non-empty:**

```
[ Unassigned Leads ]
<table of unassigned rows>

[ All Leads ]
<table of all rows (unassigned + assigned, by createdAt ASC)>
```

**When `unassigned` is empty:**

```
<flat table, no section headings — same as today>
```

**When both arrays are empty:**

```
"No new leads" empty state — same as today
```

Table columns are identical in both sections: Name, Phone, Source, Time, Notified.

## Out of Scope

- Filtering the queue to only unassigned leads
- Any new columns or row-level visual treatment (badges, colours)
- Pagination changes
