# Phase 3: Agent & Admin Dashboards — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Overview

Phase 3 builds the agent dashboard, admin dashboard, review gates, compliance gates, analytics, and audit trail. Decomposed into 5 sub-projects, each with its own spec → plan → TDD cycle.

## Decomposition

| # | Sub-Project | New Domain | Depends On |
|---|------------|------------|------------|
| 1 | Agent Dashboard — Pipeline & Seller Detail | `src/domains/agent/` | Existing seller, property, notification |
| 2 | Review Gates & Compliance Gates | `src/domains/review/` | Sub-Project 1 |
| 3 | Admin — Team Management & System Settings | `src/domains/admin/` | Sub-Project 1 patterns |
| 4 | Admin — Analytics Dashboard | `src/domains/analytics/` | Sub-Projects 1-3 |
| 5 | Audit Log Viewer & Extended Audit Events | Extends `shared/audit.*` + `admin/` | Sub-Projects 1-4 |

---

## Sub-Project 1: Agent Dashboard — Pipeline & Seller Detail

### Domain Structure

```
src/domains/agent/
├── agent.types.ts          # Pipeline, seller detail, lead queue types
├── agent.service.ts        # Business logic for agent views
├── agent.repository.ts     # Queries for pipeline, seller detail, leads
├── agent.router.ts         # Routes under /agent/*
├── agent.validator.ts      # Input validation
├── agent.service.test.ts
└── agent.router.test.ts
```

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agent/dashboard` | Pipeline overview — sellers by stage with counts |
| GET | `/agent/leads` | Lead queue — new leads, time since submission |
| GET | `/agent/sellers` | All assigned sellers, filterable |
| GET | `/agent/sellers/:id` | Seller detail — full view |
| GET | `/agent/sellers/:id/timeline` | HTMX partial — timeline milestones |
| GET | `/agent/sellers/:id/compliance` | HTMX partial — CDD, consent, documents |
| GET | `/agent/sellers/:id/notifications` | HTMX partial — notification history |

All routes: `requireAuth()`, `requireRole('agent', 'admin')`, `requireTwoFactor()`.

### Seller List Filters

Both `/agent/sellers` and `/admin/sellers` accept the same filter query params:

```typescript
interface SellerListFilter {
  agentId?: string;        // admin only — agent sees only their own
  status?: SellerStatus;
  town?: string;
  dateFrom?: string;       // ISO date — seller createdAt
  dateTo?: string;
  leadSource?: LeadSource;
  search?: string;         // free text search on name, email, phone
  page?: number;
  limit?: number;          // default 25
}
```

### Pipeline Overview

Aggregates sellers by status with counts and total pipeline value (asking prices):

```typescript
interface PipelineOverview {
  stages: { status: SellerStatus; count: number; totalValue: number }[];
  recentActivity: ActivityItem[];  // last 10 actions across all sellers
  pendingReviewCount: number;      // badge count for review queue
}
```

### Seller Detail View

Single page with HTMX-loaded sections:
- **Overview:** Name, phone, email, status, agent, dates, property summary
- **Property:** Address, flat type, asking price, price history, listing status, photos
- **Financial:** Latest financial report with approval status
- **Viewings:** Upcoming/past viewings for this property
- **Compliance:** CDD status, EAA status, consent status, case flags
- **Notifications:** All notifications sent to this seller with delivery status
- **Timeline:** Visual milestone tracker (reuses `getTimelineMilestones`)

### RBAC Enforcement

- Agent sees only their own sellers (`WHERE agentId = currentUser.id`)
- Admin sees all sellers (no agent filter)
- Handled in repository layer with optional `agentId` parameter

### Lead Queue

Sellers with `status = 'lead'`. Shows time since creation, lead source, notification status. Agent clicks to view detail and begin engagement.

---

## Sub-Project 2: Review Gates & Compliance Gates

### Domain Structure

```
src/domains/review/
├── review.types.ts          # Review item types, state machine, compliance gate types
├── review.service.ts        # Review actions, state transitions, compliance checks
├── review.repository.ts     # Queries for reviewable items across domains
├── review.router.ts         # Routes under /agent/reviews/*
├── review.validator.ts
├── review.service.test.ts
└── review.router.test.ts
```

### Review Gate State Machine

```
draft → ai_generated → pending_review → approved → sent
                                       → rejected → ai_generated (regenerate)
```

Typed transition map:

```typescript
const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ['ai_generated', 'pending_review'],
  ai_generated: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: ['ai_generated', 'pending_review'],
  sent: [],
};
```

Invalid transitions throw `ValidationError`.

### Reviewable Item Types

Unified interface across entity types:

```typescript
interface ReviewItem {
  id: string;
  entityType: 'financial_report' | 'listing_description' | 'listing_photos' | 'weekly_update' | 'document_checklist' | 'market_content';
  entityId: string;
  sellerId: string;
  sellerName: string;
  propertyAddress: string;
  currentStatus: ReviewStatus;
  submittedAt: Date;
  priority: number;  // older items = higher priority
}
```

Repository queries across `FinancialReport`, `Listing` (description + photos separately), `MarketContent`, weekly updates, and document checklists to build unified queue. Weekly updates and document checklists follow the same review state machine as other entity types.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agent/reviews` | Review queue — all pending items, priority sorted |
| POST | `/agent/reviews/:entityType/:entityId/approve` | Approve item |
| POST | `/agent/reviews/:entityType/:entityId/reject` | Reject with notes |

HTMX: approve/reject swaps row in-place.

### Approve Flow

1. Validate transition allowed
2. Update entity: status, `reviewedByAgentId`, `reviewedAt`, `approvedAt`
3. Audit log
4. Return updated row partial

### Reject Flow

1. Validate transition allowed
2. Update entity: status to `rejected`, store `reviewNotes`
3. Audit log with rejection reason
4. Notify seller if applicable
5. Return updated row partial

### 4 Mandatory Compliance Gates

Guard functions called from relevant services:

| Gate | Prerequisite | Blocks |
|------|-------------|--------|
| CDD complete | `CddRecord` with `identityVerified = true` for seller | Estate Agency Agreement signing |
| EAA signed | `EstateAgencyAgreement` with `status = 'signed'` or `'active'` | Listing going `live` |
| Counterparty CDD | `CddRecord` with `subjectType = 'counterparty'` and `identityVerified = true` | OTP issuance (unrepresented buyers) |
| Agent OTP review | `Otp` with `agentReviewedAt` set | OTP issued to buyer |

```typescript
export async function checkComplianceGate(
  gate: ComplianceGate,
  sellerId: string,
  context?: { buyerRepresented?: boolean }
): Promise<{ passed: boolean; reason?: string }>
```

Compliance gate failures throw `ComplianceError` directly rather than returning a pass/fail result. This ensures enforcement without relying on every caller to check and throw. The calling service does not need to handle the error — it propagates to the error middleware which returns a structured response.

These are utility functions — not routes. Called from property, transaction, and OTP services.

### Compliance Dashboard (per seller)

Part of seller detail view compliance tab:
- CDD status: verified / pending / not started
- EAA status: signed / sent / draft / not started
- Counterparty CDD status per offer/transaction
- Consent: service/marketing status, withdrawal date
- Case flags: active flags with status

---

## Sub-Project 3: Admin — Team Management & System Settings

### Domain Structure

```
src/domains/admin/
├── admin.types.ts          # Team, settings, HDB management types
├── admin.service.ts        # Team CRUD, settings management, HDB sync
├── admin.repository.ts     # Admin-specific queries
├── admin.router.ts         # Routes under /admin/*
├── admin.validator.ts
├── admin.service.test.ts
└── admin.router.test.ts
```

All routes: `requireAuth()`, `requireRole('admin')`, `requireTwoFactor()`.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard` | Admin overview (superset of agent dashboard) |
| GET | `/admin/team` | Team list — all agents |
| POST | `/admin/team` | Create agent account |
| POST | `/admin/team/:id/deactivate` | Deactivate agent |
| POST | `/admin/team/:id/reactivate` | Reactivate agent |
| POST | `/admin/team/:id/anonymise` | Anonymise (remove) agent |
| GET | `/admin/team/:id/pipeline` | View specific agent's pipeline |
| GET | `/admin/sellers` | All sellers across all agents, filterable |
| POST | `/admin/sellers/:id/assign` | Assign unassigned lead to an agent |
| POST | `/admin/sellers/:id/reassign` | Reassign seller to different agent |
| GET | `/admin/settings` | System settings panel |
| POST | `/admin/settings/:key` | Update a setting |
| GET | `/admin/hdb` | HDB data management |
| POST | `/admin/hdb/sync` | Trigger manual HDB sync |
| POST | `/admin/hdb/upload` | Upload CSV manually |

### Team Management

**Create agent:** Input (name, email, phone, CEA reg). Generate temp password, bcrypt(12), create Agent record, send credentials via email. Audit: `agent.created`.

**Deactivate:** Guard — no sellers with status other than `completed`/`archived`. Sets `isActive: false`. Audit: `agent.deactivated`.

**Reactivate:** Sets `isActive: true`. Audit: `agent.reactivated`.

**Anonymise:** Guard — same as deactivate. `name → "Former Agent [ID]"`, `email → anonymised-{id}@deleted.local`, `phone → null`, `isActive: false`. Irreversible, confirm via HTMX modal. Audit: `agent.anonymised`.

**Note on email anonymisation:** The business doc says `email → null`, CLAUDE.md says `email → anonymised-{id}@deleted.local`. We use `anonymised-{id}@deleted.local` because it preserves a unique, non-personal identifier for audit log referential integrity while still being fully anonymised. The `phone` field is set to `null` as it has no referential integrity requirement.

**Reassign seller:** Update `seller.agentId`, notify both agents, audit: `lead.reassigned`.

### System Settings Panel

Settings by category (Pricing, OTP & Transaction, Notifications, Data & Sync, Platform). Each setting validated before save:

```typescript
// Exhaustive validator map — every setting key must have a validator
const SETTING_VALIDATORS: Record<string, (value: string) => boolean> = {
  // Pricing
  commission_amount: (v) => !isNaN(Number(v)) && Number(v) > 0,
  gst_rate: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) < 1,
  display_price: (v) => !isNaN(Number(v)) && Number(v) > 0,
  // OTP & Transaction
  otp_exercise_days: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  // Notifications
  whatsapp_enabled: (v) => v === 'true' || v === 'false',
  email_enabled: (v) => v === 'true' || v === 'false',
  reminder_schedule: (v) => { try { const arr = JSON.parse(v); return Array.isArray(arr) && arr.every((n: unknown) => typeof n === 'number'); } catch { return false; } },
  post_completion_thankyou_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_testimonial_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_buyer_followup_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  // Data & Sync
  hdb_sync_schedule: (v) => /^[\d*,\-\/\s]+$/.test(v),  // basic cron validation
  lead_retention_months: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  transaction_retention_years: (v) => Number.isInteger(Number(v)) && Number(v) >= 5,  // min 5 per AML/CFT
  // AI
  ai_provider: (v) => ['anthropic', 'openai', 'google'].includes(v),
  ai_model: (v) => v.length > 0,
  ai_max_tokens: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  ai_temperature: (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 2,
  // Platform
  viewing_slot_duration: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  viewing_max_group_size: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  maintenance_mode: (v) => v === 'true' || v === 'false',
};
```

On update: validate → read old value → update record + `updatedByAgentId` → audit: `setting.changed` → return HTMX partial.

### HDB Data Management

- Status view: total records, date range, last sync (from `HdbTransaction` + `HdbDataSync`)
- Manual sync: calls existing `hdb.sync.service`. Audit: `hdb_sync.triggered_manually`
- Sync history: last 20 `HdbDataSync` records
- CSV upload: validate format, pass to existing ingestion logic

### Admin Layout

`views/layouts/admin.njk` extends `base.njk`. Sidebar: Dashboard, Team, Sellers, Settings, HDB Data, Analytics, Audit Log.

---

## Sub-Project 4: Admin — Analytics Dashboard

### Domain Structure

```
src/domains/analytics/
├── analytics.types.ts          # Metric types, filter types, chart data shapes
├── analytics.service.ts        # Aggregation logic, metric calculations
├── analytics.repository.ts     # Prisma queries + raw SQL for aggregations
├── analytics.router.ts         # Routes under /admin/analytics/*
├── analytics.service.test.ts
└── analytics.router.test.ts
```

All routes: `requireAuth()`, `requireRole('admin')`, `requireTwoFactor()`.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/analytics` | Main page (shell with HTMX-loaded sections) |
| GET | `/admin/analytics/revenue` | HTMX partial — revenue metrics |
| GET | `/admin/analytics/transactions` | HTMX partial — transaction volume/funnel |
| GET | `/admin/analytics/time-to-close` | HTMX partial — time-to-close metrics |
| GET | `/admin/analytics/leads` | HTMX partial — lead source analysis |
| GET | `/admin/analytics/viewings` | HTMX partial — viewing analytics |
| GET | `/admin/analytics/export/:section` | CSV export for a section |

Each partial accepts query params: `dateFrom`, `dateTo`, `agentId`. Defaults: last 30 days, all agents.

### HTMX Pattern

Main page loads shell with tabs. Each section uses `hx-get` with `hx-trigger="load"` for lazy loading. Filter changes re-trigger relevant section.

### Decimal Conversion Policy

All monetary fields in Prisma use `Decimal`. Analytics service converts `Decimal` to `number` at the service boundary (after all calculations are complete) for JSON serialization. Intermediate calculations within the service/repository layer must use `Decimal` or integer arithmetic to avoid floating-point errors. The interfaces below use `number` because they represent the serialized output shape.

### Revenue Metrics

```typescript
interface RevenueMetrics {
  totalRevenue: number;              // completed transactions x commission total
  revenueByMonth: { month: string; amount: number }[];
  revenueByAgent: { agentId: string; agentName: string; amount: number }[];
  pipelineProjection: number;        // active transactions x commission total
  pendingInvoices: { count: number; total: number };
}
```

Revenue = `completedTransactionCount x commission total` from SystemSetting. Never summed from invoice records.

### Transaction Volume / Funnel

```typescript
interface TransactionFunnel {
  stages: { stage: string; count: number; conversionRate: number }[];
  byTown: { town: string; count: number }[];
  currentVsLast: { current: number; lastMonth: number; lastYear: number };
}
```

Conversion rate at each stage = count at stage N / count at stage N-1.

### Time-to-Close

```typescript
interface TimeToCloseMetrics {
  overallAvgDays: number;
  byAgent: { agentId: string; agentName: string; avgDays: number }[];
  avgDaysByStage: { stage: string; avgDays: number }[];
  byFlatType: { flatType: string; avgDays: number }[];
  trend: { month: string; avgDays: number }[];
}
```

Computed from completed transactions only.

### Lead Sources

```typescript
interface LeadSourceMetrics {
  bySource: { source: string; count: number; conversionRate: number }[];
  trendBySource: { month: string; source: string; count: number }[];
}
```

Conversion rate = sellers reaching `completed` / total leads from source.

### Viewing Analytics

```typescript
interface ViewingMetrics {
  totalThisMonth: number;
  totalLastMonth: number;
  byListing: { propertyId: string; address: string; count: number }[];
  funnel: { stage: string; count: number; rate: number }[];
  avgViewingsBeforeOffer: number;
  busiestDays: { dayOfWeek: string; count: number }[];
  busiestSlots: { hour: number; dayOfWeek: string; count: number }[];
  viewerTypeBreakdown: { type: string; count: number; percentage: number }[];
  noShowRate: { overall: number; byListing: { propertyId: string; rate: number }[] };
  repeatViewers: { viewerId: string; name: string; phone: string; propertiesViewed: number; lastViewingDate: Date }[];
  avgDaysToFirstOffer: number;
  cancellationRate: number;
}
```

### Repository Approach

Analytics queries are read-only and cross-domain. Uses Prisma `groupBy`, `aggregate`, and `$queryRaw` for complex aggregations. Acceptable because analytics repository encapsulates all DB access.

### CSV Export

Each section exportable to CSV. PDPA-safe: no NRIC in analytics CSVs at all. NRIC masked to `SXXXX567A` only where it appears in audit log detail fields. Each export logged: `data.exported`.

---

## Sub-Project 5: Audit Log Viewer & Extended Audit Events

### Structure

Extends existing `src/domains/shared/audit.*` and adds routes to `src/domains/admin/admin.router.ts`.

### Routes (added to admin router)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/audit` | Audit log viewer page |
| GET | `/admin/audit/entries` | HTMX partial — paginated, filtered entries |
| GET | `/admin/audit/export` | CSV export of filtered entries |

### Audit Log Viewer

Searchable, filterable, paginated table:

```typescript
interface AuditLogFilter {
  dateFrom?: Date;
  dateTo?: Date;
  agentId?: string;
  sellerId?: string;         // cross-entity filter — finds all audit events related to a seller
  action?: string;
  entityType?: string;
  entityId?: string;
  searchTerm?: string;       // free text search in details JSON
}
```

The `sellerId` filter queries across entity types: it matches events where `entityType = 'seller' AND entityId = sellerId`, plus events on related entities (properties, listings, transactions belonging to that seller). This requires a join or subquery in the repository layer.

Pagination: 50 per page, cursor-based (`createdAt` + `id`). HTMX infinite scroll or "Load more".

Each entry: timestamp, actor (name or "System"), action (human-readable), entity type + link, details (collapsed/expandable).

### Typed Audit Actions

All 73 actions as a union type:

```typescript
type AuditAction =
  // Lead & Seller Lifecycle
  | 'lead.created' | 'lead.assigned' | 'lead.reassigned'
  | 'seller.status_changed' | 'seller.archived' | 'seller.deleted'
  // Consent & PDPA
  | 'consent.service_granted' | 'consent.marketing_granted'
  | 'consent.marketing_withdrawn' | 'consent.service_withdrawn'
  | 'data_access.requested' | 'data_access.fulfilled'
  | 'data_correction.requested' | 'data_correction.applied'
  | 'data_retention.flagged' | 'data_deletion.approved' | 'data_deletion.executed'
  // Property & Listing
  | 'property.created' | 'property.updated' | 'property.status_changed'
  | 'photos.uploaded' | 'photos.reviewed'
  | 'listing.ai_generated' | 'listing.reviewed' | 'listing.regenerated'
  | 'portal_content.generated' | 'portal_listing.posted'
  | 'listing.paused' | 'listing.closed'
  // Compliance
  | 'cdd.created' | 'cdd.identity_verified' | 'cdd.risk_assessed' | 'cdd.documents_uploaded'
  | 'counterparty_cdd.created' | 'counterparty_cdd.verified'
  // Financial
  | 'financial_report.generated' | 'financial_report.reviewed'
  | 'financial_report.sent' | 'financial_report.regenerated'
  // Offers
  | 'offer.received' | 'offer.analysis_generated'
  | 'offer.analysis_reviewed' | 'offer.status_changed'
  // OTP
  | 'otp.created' | 'otp.status_changed' | 'otp.scanned_copy_uploaded'
  | 'otp.agent_review_confirmed' | 'otp.reminder_sent'
  // Transaction
  | 'transaction.created' | 'transaction.status_changed'
  | 'hdb_application.submitted' | 'hdb_appointment.scheduled'
  // Invoice
  | 'invoice.uploaded' | 'invoice.sent' | 'invoice.payment_recorded'
  // Notifications
  | 'notification.sent' | 'notification.delivered' | 'notification.failed'
  // Auth
  | 'auth.login' | 'auth.logout' | 'auth.login_failed'
  | 'auth.password_changed' | 'auth.password_reset_requested'
  // Agent Management
  | 'agent.created' | 'agent.deactivated' | 'agent.reactivated' | 'agent.anonymised'
  // System Settings
  | 'setting.changed' | 'hdb_sync.triggered_manually' | 'hdb_sync.completed'
  // Viewings
  | 'viewing.scheduled' | 'viewing.cancelled' | 'viewing.feedback_recorded'
  // Content
  | 'video.created' | 'video.updated' | 'video.deleted'
  | 'market_content.generated' | 'market_content.reviewed'
  // Export
  | 'data.exported';
```

Existing `auditService.log()` signature unchanged — `action` parameter gets typed.

### Schema Change

```prisma
model AuditLog {
  id         String   @id
  actorType  String?  @map("actor_type")    // NEW: seller|agent|admin|system
  actorId    String?  @map("actor_id")      // NEW: generic actor ID
  agentId    String?  @map("agent_id")      // KEEP: backward compatible
  action     String
  entityType String   @map("entity_type")
  entityId   String   @map("entity_id")
  details    Json
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")    // NEW
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([actorType, actorId])             // NEW
  @@index([entityType, entityId])
  @@index([action])
  @@index([createdAt])
}
```

### Weaving Audit Events Into Existing Code

Every service that performs an auditable action gets touched. Domain by domain:

- `auth` — login, logout, login_failed, password_changed, password_reset_requested
- `lead` — created, assigned, reassigned
- `seller` — status_changed, archived, deleted
- `property` — created, updated, status_changed, photos.uploaded, photos.reviewed
- `review` — listing.ai_generated, listing.reviewed, listing.regenerated, listing.paused, listing.closed
- `notification` — sent, delivered, failed
- `admin` — agent.created, agent.deactivated, agent.reactivated, setting.changed, hdb_sync.*
- `viewing` — scheduled, feedback_recorded
- Consent, CDD, financial reports, offers, OTP, transaction, invoice, portal, video, market content

Each domain tested after modification.

### CSV Export

Same approach as analytics: filters applied, NRIC masked in details JSON, export logged in audit trail. Read-only, append-only — no delete/modify UI.

---

## Test Coverage

### Unit Tests

- Review gate state machine: all valid transitions succeed, all invalid transitions throw `ValidationError`
- RBAC: agent repository filters by `agentId`, returns only assigned sellers
- RBAC: admin repository returns all agents and all sellers (no filter)
- RBAC: agent cannot access admin routes (settings, team management, full audit log) — returns `ForbiddenError`
- Compliance gates: listing blocked without CDD throws `ComplianceError`, OTP blocked without counterparty CDD
- Settings service: validates setting values before saving (positive number, boolean, cron, JSON array)
- Settings service: rejects invalid values (negative commission, invalid cron, non-boolean toggle)
- Analytics: revenue calculation = completed transactions x $1,633.91 (from SystemSetting)
- Analytics: conversion rate = stage N count / stage N-1 count, handles zero division
- Analytics: time-to-close = completionDate - lead createdAt in days
- Agent deactivation guard: rejects deactivation when agent has active sellers, returns count

### Integration Tests

- Agent approves financial report → status changes to `approved` → audit log entry created
- Agent rejects listing → status changes to `rejected` → seller notified → audit logged
- Compliance gate enforcement: attempt to make listing live without CDD → `ComplianceError`
- Compliance gate enforcement: attempt to issue OTP without counterparty CDD → `ComplianceError`
- Admin creates agent account → agent receives credentials → can log in
- Admin deactivates agent → agent cannot log in → sellers remain assigned
- Admin reassigns seller → `agentId` updated → both agents notified → audit logged
- Admin assigns unassigned lead → `agentId` set → agent notified → audit logged
- Admin updates system setting → old/new values logged in audit → setting takes effect
- Admin views analytics → correct aggregations returned
- Admin views audit log → sees all entries across all agents
- Admin filters audit log by sellerId → returns cross-entity events for that seller
- Admin triggers HDB sync → job runs → sync logged → data updated
- Regular agent cannot access admin settings endpoint → 403
- Regular agent cannot access team management endpoint → 403
- Regular agent cannot access full audit log endpoint → 403

### E2E Tests

- Full flow: lead → engagement → photos → listing → approval
- Reject and regenerate flow
- Admin: create agent → assign lead → agent sees lead in their pipeline
- Admin: reassign seller from agent A to agent B → agent B sees seller
- Admin: change commission amount in settings → financial calculator uses new amount
- Admin: analytics dashboard loads with correct data

### i18n Reminder

All user-facing strings in Nunjucks templates for agent and admin views must be wrapped in `{{ "string" | t }}` filter per project convention.
