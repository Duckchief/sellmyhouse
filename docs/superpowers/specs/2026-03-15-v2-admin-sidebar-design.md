# V2 Admin Sidebar & Missing Pages Design

**Date:** 2026-03-15
**Status:** Approved
**Approach:** Add V1's sidebar structure + 5 new pages to V2's existing admin layout

## Overview

Port V1's admin sidebar navigation structure into V2. The V1 sidebar has two sections: Operations (pipeline, leads, reviews, compliance, notifications, content) and Admin (team, sellers, analytics, settings, audit, HDB, tutorials). V2 currently has a flat sidebar missing Pipeline, Leads, Review Queue, Notifications, and Audit Log pages.

## 1. Sidebar Layout

**File:** `src/views/layouts/admin.njk` — modify existing sidebar nav

Two sections with a divider, matching V1:

### Operations Section (no header, top of sidebar)
1. Pipeline → `/admin/pipeline`
2. Leads → `/admin/leads`
3. Review Queue → `/admin/review`
4. Compliance → `/admin/compliance/deletion-queue`
5. Notifications → `/admin/notifications`
6. Market Content → `/admin/content/market`
7. Testimonials → `/admin/content/testimonials`
8. Referrals → `/admin/content/referrals`

### Admin Section (header: "ADMIN", below divider)
1. Team → `/admin/team`
2. All Sellers → `/admin/sellers`
3. Analytics → `/admin/dashboard`
4. Settings → `/admin/settings`
5. Audit Log → `/admin/audit`
6. HDB Data → `/admin/hdb`
7. Tutorials → `/admin/tutorials`

### Active State
Use `text-accent` + left border highlight for active item. Determine active by matching `currentPath` variable set in each route handler.

### Sign Out
Red "Sign Out" link at bottom of sidebar → `/auth/logout`

## 2. Pipeline Page (New)

**Route:** `GET /admin/pipeline`
**Page:** `src/views/pages/admin/pipeline.njk`
**Partial:** `src/views/partials/admin/pipeline-table.njk` (HTMX target)

Admin view of ALL sellers grouped by status stage. Unlike the agent pipeline which filters by agent, admin sees everything.

### Layout
- Stage tabs/sections: Lead, Engaged, Active, Completed, Archived
- Each section shows count badge
- Table columns: Name | Phone | Town | Agent | Asking Price | Status | Actions
- "View" link → `/admin/sellers/{id}/assign-modal` or `/agent/sellers/{id}`
- Pagination per stage (25/page)

### Data Requirements
Reuse `agentService.getPipelineOverview(undefined)` (passing undefined = admin sees all). Enhance the existing pipeline seller data to include `agentName` and `town` fields.

Add to `agent.repository.ts`:
```typescript
// Enhance getPipelineStagesWithSellers to include agent name and town
sellers include: { properties: { select: { town: true } }, agent: { select: { name: true } } }
```

### HTMX
- `hx-get="/admin/pipeline"` with `HX-Request` → returns partial
- Stage filter as query param: `?stage=active`

## 3. Leads Page (New)

**Route:** `GET /admin/leads`
**Page:** `src/views/pages/admin/leads.njk`
**Partial:** `src/views/partials/admin/lead-list.njk` (HTMX target)

Unassigned sellers (status=lead, no agentId). Quick assignment workflow.

### Layout
- Header: "Unassigned Leads" with count badge
- Table columns: Name | Phone | Town | Lead Source | Created | Actions
- "Assign" button opens assign modal (reuse existing `/admin/sellers/:id/assign-modal`)
- Empty state: "No unassigned leads"
- Pagination (25/page)

### Data Requirements
Add to `admin.repository.ts`:
```typescript
export async function findUnassignedLeads(page = 1, limit = 25) {
  return prisma.seller.findMany({
    where: { status: 'lead', agentId: null },
    include: { properties: { take: 1, select: { town: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function countUnassignedLeads() {
  return prisma.seller.count({ where: { status: 'lead', agentId: null } });
}
```

Add to `admin.service.ts`:
```typescript
export async function getUnassignedLeads(page?: number) {
  const [leads, total] = await Promise.all([
    adminRepo.findUnassignedLeads(page),
    adminRepo.countUnassignedLeads(),
  ]);
  return { leads, total, page: page ?? 1, limit: 25, totalPages: Math.ceil(total / 25) };
}
```

## 4. Review Queue Page (New)

**Route:** `GET /admin/review`
**Page:** `src/views/pages/admin/review-queue.njk`
**Partial:** `src/views/partials/admin/review-list.njk` (HTMX target)

Pending content requiring admin/agent review before publication.

### Review Items (from V1)
1. **Listing descriptions** — Properties with `status = 'pending_review'` where description needs approval
2. **Listing photos** — Photos awaiting approval
3. **Financial reports** — Reports with AI narrative but no `approvedAt`

### Layout
- Table columns: Type (badge) | Seller | Property | Submitted | Actions
- Type badges: "Listing" (blue), "Photos" (green), "Report" (purple)
- "Review" link → appropriate detail page
- Empty state: "No items pending review"

### Data Requirements
Add to `admin.repository.ts`:
```typescript
export async function getReviewQueue() {
  const [pendingListings, pendingReports] = await Promise.all([
    prisma.property.findMany({
      where: { status: 'pending_review' },
      include: { seller: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.financialReport.findMany({
      where: { approvedAt: null, aiNarrative: { not: null } },
      include: {
        transaction: {
          include: {
            seller: { select: { id: true, name: true } },
            property: { select: { block: true, street: true } },
          },
        },
      },
      orderBy: { generatedAt: 'asc' },
    }),
  ]);
  return { pendingListings, pendingReports };
}
```

Add to `admin.service.ts`:
```typescript
export async function getReviewQueue() {
  const { pendingListings, pendingReports } = await adminRepo.getReviewQueue();
  // Transform into unified review items
  return [
    ...pendingListings.map(p => ({
      type: 'listing' as const,
      sellerId: p.seller?.id,
      sellerName: p.seller?.name,
      property: `${p.block} ${p.street}`,
      submittedAt: p.updatedAt,
      reviewUrl: `/agent/sellers/${p.seller?.id}`,
    })),
    ...pendingReports.map(r => ({
      type: 'report' as const,
      sellerId: r.transaction?.seller?.id,
      sellerName: r.transaction?.seller?.name,
      property: `${r.transaction?.property?.block} ${r.transaction?.property?.street}`,
      submittedAt: r.generatedAt,
      reviewUrl: `/agent/sellers/${r.transaction?.seller?.id}`,
    })),
  ].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}
```

## 5. Notifications Page (New)

**Route:** `GET /admin/notifications`
**Page:** `src/views/pages/admin/notifications.njk`
**Partial:** `src/views/partials/admin/notification-list.njk` (HTMX target)

Admin notification history viewer with channel/status filters (matching V1 screenshot).

### Layout
- Filter bar: Channel dropdown (All/WhatsApp/Email/In-App) + Status dropdown (All/Pending/Sent/Delivered/Failed) + Filter button
- Table columns: Channel | Template | Recipient | Status (color badge) | Date
- Status badges: pending=gray, sent=blue, delivered=green, failed=red, read=purple
- Pagination: 50/page with prev/next
- Empty state: "No notifications found."

### Data Requirements
Add to `notification.repository.ts`:
```typescript
export async function findMany(filter: {
  channel?: NotificationChannel;
  status?: NotificationStatus;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const where: Prisma.NotificationWhereInput = {};
  if (filter.channel) where.channel = filter.channel;
  if (filter.status) where.status = filter.status;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = filter.dateFrom;
    if (filter.dateTo) where.createdAt.lte = filter.dateTo;
  }

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total, page, limit, totalPages: Math.ceil(total / limit) };
}
```

Add to `admin.service.ts`:
```typescript
export async function getNotifications(filter: NotificationFilter) {
  return notificationRepo.findMany(filter);
}
```

### HTMX
- Filter form: `hx-get="/admin/notifications"` with `hx-target="#notification-list"` `hx-include="[name]"`
- Returns partial on HX-Request

## 6. Audit Log Page (New)

**Route:** `GET /admin/audit`
**Route:** `GET /admin/audit/export` (CSV download)
**Page:** `src/views/pages/admin/audit-log.njk`
**Partial:** `src/views/partials/admin/audit-list.njk` (HTMX target)

Append-only audit trail viewer with filtering and CSV export.

### Layout
- Filter bar: Action (text input) + Entity Type (text input) + Date From/To + Filter button
- Export CSV button (top right)
- Table columns: Timestamp | Action | Entity | Agent | IP | Details
- Details column: truncated JSON, expandable on click
- Pagination: 50/page with prev/next + total count display

### Data Requirements
Add to `audit.repository.ts`:
```typescript
export async function findMany(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' };
  if (filter.entityType) where.entityType = { contains: filter.entityType, mode: 'insensitive' };
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = filter.dateFrom;
    if (filter.dateTo) where.createdAt.lte = filter.dateTo;
  }

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function exportCsv(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' };
  if (filter.entityType) where.entityType = { contains: filter.entityType, mode: 'insensitive' };
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = filter.dateFrom;
    if (filter.dateTo) where.createdAt.lte = filter.dateTo;
  }

  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
}
```

Add to `admin.service.ts`:
```typescript
export async function getAuditLog(filter: AuditLogFilter) {
  return auditRepo.findMany(filter);
}

export async function exportAuditLogCsv(filter: AuditLogFilter, adminId: string) {
  const entries = await auditRepo.exportCsv(filter);
  // Log the export action itself
  await auditService.log({
    agentId: adminId,
    action: 'audit_log.exported',
    entityType: 'AuditLog',
    entityId: 'bulk',
    details: { filter, entryCount: entries.length },
  });
  return entries;
}
```

### CSV Export
- `GET /admin/audit/export?action=...&entityType=...&dateFrom=...&dateTo=...`
- Returns `text/csv` with headers: Timestamp, Action, Entity Type, Entity ID, Agent ID, IP Address, Details
- Filename: `audit-log-YYYY-MM-DD.csv`

## 7. Types

Add to `admin.types.ts`:
```typescript
export interface NotificationFilter {
  channel?: 'whatsapp' | 'email' | 'in_app';
  status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface AuditLogFilter {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface ReviewItem {
  type: 'listing' | 'report';
  sellerId: string | undefined;
  sellerName: string | undefined;
  property: string;
  submittedAt: Date;
  reviewUrl: string;
}

export interface LeadListResult {
  leads: Array<{
    id: string;
    name: string;
    phone: string;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

## 8. Files to Create/Modify

### New files:
- `src/views/pages/admin/pipeline.njk`
- `src/views/pages/admin/leads.njk`
- `src/views/pages/admin/review-queue.njk`
- `src/views/pages/admin/notifications.njk`
- `src/views/pages/admin/audit-log.njk`
- `src/views/partials/admin/pipeline-table.njk`
- `src/views/partials/admin/lead-list.njk`
- `src/views/partials/admin/review-list.njk`
- `src/views/partials/admin/notification-list.njk`
- `src/views/partials/admin/audit-list.njk`

### Modified files:
- `src/views/layouts/admin.njk` — new two-section sidebar
- `src/domains/admin/admin.router.ts` — 6 new routes (pipeline, leads, review, notifications, audit, audit/export)
- `src/domains/admin/admin.service.ts` — 5 new methods
- `src/domains/admin/admin.repository.ts` — review queue + leads queries
- `src/domains/admin/admin.types.ts` — new filter/result types
- `src/domains/notification/notification.repository.ts` — findMany method
- `src/domains/shared/audit.repository.ts` — findMany + exportCsv methods

## Dependencies

No new dependencies. All functionality uses existing Prisma models and Express/Nunjucks stack.
