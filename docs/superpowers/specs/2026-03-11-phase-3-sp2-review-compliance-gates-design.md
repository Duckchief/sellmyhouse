# Phase 3 SP2: Review Gates & Compliance Gates — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Branch:** feat/phase-3-sp2-review-compliance-gates
**Depends on:** Phase 3 SP1 (Agent Dashboard)

---

## Overview

SP2 builds the unified agent review queue and compliance gate enforcement. Agents review AI-generated content (financial reports, listing descriptions, photos, market content, weekly updates, document checklists) through a tabbed queue with a slide-out detail panel. Compliance gates enforce prerequisite checks at key workflow transitions.

---

## Domain Structure

```
src/domains/review/
├── review.types.ts
├── review.service.ts        # Review actions, state machine, compliance gates
├── review.repository.ts     # Unified queue queries across 6 entity types
├── review.router.ts         # Routes under /agent/reviews/*
├── review.validator.ts
└── __tests__/
    ├── review.service.test.ts
    └── review.router.test.ts
```

---

## Schema Changes

All in one migration.

### 1. `FinancialReportStatus` enum (new)

```prisma
enum FinancialReportStatus {
  draft
  ai_generated
  pending_review
  approved
  rejected
  sent
}
```

Added as `status` field to `FinancialReport` model with `@default(draft) @map("status")`. Existing timestamp fields (`reviewedAt`, `approvedAt`, `sentToSellerAt`) are kept — they remain the source of truth; the enum enables efficient querying. Existing `approveReport()` in `property/financial.service.ts` updated to also set `status = 'approved'`.

The master design spec shows `checkComplianceGate` returning `Promise<{ passed: boolean; reason?: string }>` but its own narrative contradicts this: "Compliance gate failures throw `ComplianceError` directly rather than returning a pass/fail result." SP2 adopts `Promise<void>` (throw-only), consistent with CLAUDE.md architecture rules. The master spec's type signature is superseded.

Similarly, the master spec transition map allows `draft → pending_review`. SP2 restricts this to `draft → ai_generated` only — content must go through AI generation before review. This is the correct constraint.

### 2. Back-relations on existing models

The new `WeeklyUpdate` and `DocumentChecklist` models require back-relation fields on `Agent`, `Seller`, and `Property`. These must be added to the migration:

```prisma
// Agent model — add:
weeklyUpdatesReviewed      WeeklyUpdate[]
documentChecklistsReviewed DocumentChecklist[]

// Seller model — add:
weeklyUpdates      WeeklyUpdate[]
documentChecklists DocumentChecklist[]

// Property model — add:
weeklyUpdates      WeeklyUpdate[]
documentChecklists DocumentChecklist[]
```

### 3. `WeeklyUpdate` model (new)

AI-generated weekly progress update sent to seller. Follows the full review state machine including `sent`.

```prisma
model WeeklyUpdate {
  id                String                @id
  sellerId          String                @map("seller_id")
  seller            Seller                @relation(fields: [sellerId], references: [id])
  propertyId        String                @map("property_id")
  property          Property              @relation(fields: [propertyId], references: [id])
  weekOf            DateTime              @map("week_of")
  content           String?
  aiNarrative       String?               @map("ai_narrative")
  aiProvider        String?               @map("ai_provider")
  aiModel           String?               @map("ai_model")
  status            FinancialReportStatus @default(draft) @map("status")
  reviewedByAgentId String?               @map("reviewed_by_agent_id")
  reviewedByAgent   Agent?                @relation(fields: [reviewedByAgentId], references: [id])
  reviewedAt        DateTime?             @map("reviewed_at")
  reviewNotes       String?               @map("review_notes")
  approvedAt        DateTime?             @map("approved_at")
  sentToSellerAt    DateTime?             @map("sent_to_seller_at")
  createdAt         DateTime              @default(now()) @map("created_at")

  @@map("weekly_updates")
}
```

### 4. `DocumentChecklist` model (new)

Required documents checklist for the HDB resale process. No sending step — `approved` is the terminal state. The `sent` value from `FinancialReportStatus` is valid in the enum but the review service enforces that `document_checklist` items cannot transition to `sent` (guard in `validateTransition()`).

```prisma
model DocumentChecklist {
  id                String                @id
  sellerId          String                @map("seller_id")
  seller            Seller                @relation(fields: [sellerId], references: [id])
  propertyId        String                @map("property_id")
  property          Property              @relation(fields: [propertyId], references: [id])
  // items: [{label: string, required: boolean, uploadedAt: string|null, filePath: string|null}]
  items             Json                  @default("[]")
  status            FinancialReportStatus @default(draft) @map("status")
  reviewedByAgentId String?               @map("reviewed_by_agent_id")
  reviewedByAgent   Agent?                @relation(fields: [reviewedByAgentId], references: [id])
  reviewedAt        DateTime?             @map("reviewed_at")
  reviewNotes       String?               @map("review_notes")
  approvedAt        DateTime?             @map("approved_at")
  createdAt         DateTime              @default(now()) @map("created_at")

  @@map("document_checklists")
}
```

---

## Routes

All routes: `requireAuth()`, `requireRole('agent', 'admin')`, `requireTwoFactor()`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agent/reviews` | Review queue — tabbed by entity type, pending items |
| GET | `/agent/reviews/:entityType/:entityId/detail` | HTMX partial — slide-out panel content |
| POST | `/agent/reviews/:entityType/:entityId/approve` | Approve item — returns updated row partial |
| POST | `/agent/reviews/:entityType/:entityId/reject` | Reject with notes — returns updated row partial |

**Valid `entityType` values:** `financial_report`, `listing_description`, `listing_photos`, `weekly_update`, `market_content`, `document_checklist`

---

## Review Queue UI

**Layout:** Tabbed by entity type. Tabs: All · Financial Reports · Listing Descriptions · Photos · Market Content · Weekly Updates · Document Checklists. Each tab shows count badge. HTMX-driven tab switching (`hx-get` on tab click).

**Row click:** Opens slide-out detail panel on the right via `hx-get="/agent/reviews/:entityType/:entityId/detail"`. Panel is swapped into a fixed right-side slot.

**Detail panel content by type:**
- `financial_report` — AI narrative text
- `listing_description` — listing description text
- `listing_photos` — photo grid
- `market_content` — content body
- `weekly_update` — week summary narrative
- `document_checklist` — items list with upload status

**Approve flow:** Button in panel → `hx-post` to approve endpoint → returns updated row HTML → row swaps in-place, panel closes.

**Reject flow:** Textarea in panel → `hx-post` to reject endpoint → `reviewNotes` required (400 if empty) → row swaps, panel closes.

---

## State Machine

```
draft → ai_generated → pending_review → approved → sent
                                      → rejected → ai_generated (regenerate)
                                                 → pending_review (re-review)
```

Typed transition map:

```typescript
const REVIEW_TRANSITIONS: Record<FinancialReportStatus, FinancialReportStatus[]> = {
  draft:          ['ai_generated'],
  ai_generated:   ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved:       ['sent'],
  rejected:       ['ai_generated', 'pending_review'],
  sent:           [],
};
```

**`document_checklist` exception:** `approved → sent` is blocked for this entity type. The `validateTransition()` function takes `entityType` as a second parameter and throws `ValidationError` if a `document_checklist` attempts to transition to `sent`.

Invalid transitions throw `ValidationError`. The review service validates the transition then dispatches to the relevant domain service (e.g. approving a `financial_report` calls the existing `financialService.approveReport()`).

---

## Unified `ReviewItem` Interface

```typescript
interface ReviewItem {
  id: string;
  entityType: 'financial_report' | 'listing_description' | 'listing_photos'
            | 'weekly_update' | 'market_content' | 'document_checklist';
  entityId: string;
  sellerId: string;
  sellerName: string;
  propertyAddress: string;
  currentStatus: FinancialReportStatus;
  submittedAt: Date;     // when item entered pending_review
  priority: number;      // ms since submittedAt — higher = older = more urgent
}
```

**Repository query strategy:** Six separate Prisma `findMany` queries (one per entity type), scoped by `agentId` (agents see only their sellers; admin sees all). Results merged in-memory and sorted by `priority` descending.

**Per-type query conditions:**

| Type | Prisma model | "Pending review" condition |
|------|-------------|---------------------------|
| `financial_report` | `FinancialReport` | `status = 'pending_review'` |
| `listing_description` | `Listing` | `description IS NOT NULL AND descriptionApprovedAt IS NULL` |
| `listing_photos` | `Listing` | `photos IS NOT NULL AND photosApprovedAt IS NULL` |
| `weekly_update` | `WeeklyUpdate` | `status = 'pending_review'` |
| `market_content` | `MarketContent` | `status = 'pending_review'` |
| `document_checklist` | `DocumentChecklist` | `status = 'pending_review'` |

**Note on listing types:** `Listing` has no per-content-type status enum — description and photo approval are tracked via separate timestamp fields. The repository derives "pending review" from null approval timestamps. The `currentStatus` in `ReviewItem` is set to `pending_review` for these types.

**Note on `MarketContent`:** Its existing enum (`MarketContentStatus`) differs from `FinancialReportStatus` — it uses `published` where SP2 uses `sent`, and has no `draft` state. The repository maps `published → sent` when building `ReviewItem.currentStatus`. Items in `ai_generated` state are shown as `ai_generated`. No `draft` items appear in the queue (they start at `ai_generated`).

---

## Compliance Gates

Four utility functions in `review.service.ts`. All throw `ComplianceError` on failure — callers do not need to check the return value.

```typescript
type ComplianceGate = 'cdd_complete' | 'eaa_signed' | 'counterparty_cdd' | 'agent_otp_review';

export async function checkComplianceGate(
  gate: ComplianceGate,
  sellerId: string,
  context?: { buyerRepresented?: boolean }
): Promise<void>  // throws ComplianceError if gate fails
```

| Gate | Check | Throws if |
|------|-------|-----------|
| `cdd_complete` | `CddRecord` where `subjectType='seller'`, `subjectId=sellerId`, `identityVerified=true` | No verified CDD |
| `eaa_signed` | `EstateAgencyAgreement` where `sellerId` matches, `status IN ('signed','active')` | No signed/active EAA |
| `counterparty_cdd` | `CddRecord` where `subjectType='counterparty'`, `identityVerified=true`, linked to transaction | No verified counterparty CDD |
| `agent_otp_review` | `Otp` where `agentReviewedAt IS NOT NULL` for this transaction | OTP not yet agent-reviewed |

**Wiring this SP:** Gate 2 (`eaa_signed`) wired into `property.service.ts` — called before any `Listing.status` transition to `live`.

**Wiring future SPs:** Gates 1, 3, 4 wired when CDD management, OTP, and transaction services are built.

**Error propagation:** `ComplianceError` propagates to existing error middleware:
```json
{ "error": "ComplianceError", "message": "EAA must be signed before listing can go live" }
```

---

## Audit Events

| Action | Trigger |
|--------|---------|
| `financial_report.reviewed` | Approve or reject financial report |
| `listing.reviewed` | Approve or reject listing description or photos |
| `market_content.reviewed` | Approve or reject market content |
| `weekly_update.reviewed` | Approve or reject weekly update |
| `document_checklist.reviewed` | Approve or reject document checklist |

**Note:** `weekly_update.reviewed` and `document_checklist.reviewed` are not yet in the master spec's `AuditAction` union type (defined in Sub-Project 5). These actions will be added to the union when SP5 is built.

---

## Test Coverage

### Unit Tests (`review.service.test.ts`)

- State machine: all valid transitions succeed; all invalid transitions throw `ValidationError`
- State machine: `sent → anything` always throws (terminal state)
- State machine: `document_checklist` attempting `approved → sent` throws `ValidationError`
- Compliance gate `eaa_signed`: passes with `signed`, passes with `active`, throws with `draft` / `sent_to_seller` / `terminated` / `expired`
- Compliance gate `cdd_complete`: passes with `identityVerified=true`, throws with `false`
- Review service: approving `financial_report` delegates to `financialService.approveReport()`
- Review service: rejecting any entity type without `reviewNotes` throws `ValidationError`
- RBAC: repository filters by `agentId` for agent role; no filter for admin

### Integration Tests (`review.router.test.ts`)

- Agent approves financial report → status becomes `approved` → audit log entry created
- Agent rejects listing description → status becomes `rejected` → `reviewNotes` stored → audit logged
- Agent rejects with empty notes → 400 returned
- Compliance gate: attempt to set listing `live` without signed EAA → 422 `ComplianceError`
- Approve endpoint: invalid `entityType` param → 400
- Agent cannot access another agent's review items → 403
- Detail panel route returns correct partial for each entity type
- Tab counts match actual `pending_review` counts in DB
- `document_checklist` approve → status `approved`; attempt to then transition to `sent` → 400
