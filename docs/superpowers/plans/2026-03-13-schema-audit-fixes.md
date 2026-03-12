# Schema Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all P0–P3 schema audit fixes across four migration groups, keeping `npm test`, `npx prisma validate`, and `npx tsc --noEmit` green after every group.

**Architecture:** Four sequential Prisma migrations, each followed by TypeScript and test fixes. Schema changes are additive or enum-replacing; no destructive data changes. The review domain (WeeklyUpdate/DocumentChecklist) is the highest-risk refactor because it currently uses `FinancialReportStatus` as a catch-all — new dedicated enums require careful type plumbing across review.types, review.repository, and review.service.

**Tech Stack:** Prisma ORM, PostgreSQL, TypeScript, Jest (unit tests with mocks), `@paralleldrive/cuid2` for IDs.

---

## Pre-flight Checks

- [ ] Verify clean state: `npm test` passes
- [ ] Verify: `npx prisma validate` passes
- [ ] Verify: `npx tsc --noEmit` passes
- [ ] Note current test count so you can confirm nothing is dropped after each group

---

## Chunk 1: Group 1 — P0 Critical Fixes

### Task 1: Fix 1A — ConsentRecord FK Bug

**Problem:** `ConsentRecord.seller` uses `subjectId` as FK → `sellers.id` for ALL records, including buyer-type records. A buyer consent record would have `subjectId = buyerId` (which doesn't exist in sellers) causing a FK violation.

**Current schema (bad):**
```prisma
model ConsentRecord {
  subjectId  String  @map("subject_id")
  seller     Seller? @relation(fields: [subjectId], references: [id])
}
```

**Files to modify:**
- `prisma/schema.prisma`
- `src/domains/lead/lead.repository.ts`
- `src/domains/compliance/compliance.repository.ts`

**Files to modify (back-relations):**
- Back-relation already exists on `Seller` as `consentRecords ConsentRecord[]` — but it currently relies on the broken `subjectId` FK. After this fix the relation uses `sellerId` instead.
- `Buyer` model needs a new `consentRecords ConsentRecord[]` back-relation.

- [ ] **Step 1: Update `prisma/schema.prisma` — ConsentRecord model**

Find the `ConsentRecord` model. Remove the `seller` relation that references `subjectId`. Add two new nullable FK columns:

```prisma
model ConsentRecord {
  id                 String             @id
  subjectType        ConsentSubjectType @map("subject_type")
  subjectId          String             @map("subject_id")
  purposeService     Boolean            @default(false) @map("purpose_service")
  purposeMarketing   Boolean            @default(false) @map("purpose_marketing")
  consentGivenAt     DateTime           @default(now()) @map("consent_given_at")
  consentWithdrawnAt DateTime?          @map("consent_withdrawn_at")
  withdrawalChannel  String?            @map("withdrawal_channel")
  ipAddress          String?            @map("ip_address")
  userAgent          String?            @map("user_agent")
  sellerId           String?            @map("seller_id")
  seller             Seller?            @relation(fields: [sellerId], references: [id])
  buyerId            String?            @map("buyer_id")
  buyer              Buyer?             @relation(fields: [buyerId], references: [id])
  createdAt          DateTime           @default(now()) @map("created_at")

  @@index([subjectType, subjectId])
  @@map("consent_records")
}
```

- [ ] **Step 2: Update `Seller` model back-relation**

In the `Seller` model, find:
```prisma
consentRecords  ConsentRecord[]
```
This line stays unchanged — Prisma will now correctly use the `sellerId` FK for it.

- [ ] **Step 3: Add back-relation to `Buyer` model**

In the `Buyer` model, add:
```prisma
consentRecords  ConsentRecord[]
```

- [ ] **Step 4: Verify schema — `npx prisma validate`**

Expected: no errors.

- [ ] **Step 5: Update `src/domains/lead/lead.repository.ts` — `createConsentRecord`**

Change from setting `subjectId` (which drove the FK) to now also setting `sellerId` explicitly. `subjectId` stays for existing query patterns (`findMany({ where: { subjectType, subjectId } })`).

```typescript
export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      sellerId: data.subjectId,   // ← add this
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}
```

- [ ] **Step 6: Update `src/domains/compliance/compliance.repository.ts` — `createConsentRecord`**

Same change — seller-type consent records must set `sellerId`:

```typescript
export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentWithdrawnAt?: Date;
  withdrawalChannel?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<ConsentRecord> {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      sellerId: data.subjectId,   // ← add this
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      consentWithdrawnAt: data.consentWithdrawnAt ?? null,
      withdrawalChannel: data.withdrawalChannel ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors on ConsentRecord-related files.

---

### Task 2: Fix 1B — Gate 5: HDB Application Structured Tracking

**Problem:** `Transaction.hdbApplicationStatus` is `String?` — nullable, free-form, no timestamps, no agent ID. Gate 5 is unauditable.

**Files to modify:**
- `prisma/schema.prisma`
- `src/domains/transaction/transaction.repository.ts`
- `src/domains/transaction/transaction.service.ts`
- `src/domains/transaction/transaction.types.ts`
- `src/domains/transaction/transaction.validator.ts`
- `src/domains/transaction/__tests__/transaction.service.test.ts`

- [ ] **Step 1: Add `HdbApplicationStatus` enum to `prisma/schema.prisma`**

Add near the other enums (after `TransactionStatus`):

```prisma
enum HdbApplicationStatus {
  not_submitted
  submitted
  endorsed
  approved
  rejected
}
```

- [ ] **Step 2: Update `Transaction` model in schema**

Replace:
```prisma
hdbApplicationStatus String?           @map("hdb_application_status")
hdbAppointmentDate   DateTime?         @map("hdb_appointment_date")
```

With:
```prisma
hdbApplicationStatus      HdbApplicationStatus @default(not_submitted) @map("hdb_application_status")
hdbAppSubmittedAt         DateTime?            @map("hdb_app_submitted_at")
hdbAppSubmittedByAgentId  String?              @map("hdb_app_submitted_by_agent_id")
hdbAppSubmittedByAgent    Agent?               @relation("HdbSubmitter", fields: [hdbAppSubmittedByAgentId], references: [id])
hdbAppApprovedAt          DateTime?            @map("hdb_app_approved_at")
hdbAppointmentDate        DateTime?            @map("hdb_appointment_date")
```

- [ ] **Step 3: Add back-relation to `Agent` model**

In the `Agent` model, add:
```prisma
hdbSubmissions  Transaction[]  @relation("HdbSubmitter")
```

- [ ] **Step 4: Validate schema**

```bash
npx prisma validate
```

Expected: no errors.

- [ ] **Step 5: Update `src/domains/transaction/transaction.types.ts`**

Add import and new types:

```typescript
import type { TransactionStatus, OtpStatus, InvoiceStatus, HdbApplicationStatus } from '@prisma/client';

export type { TransactionStatus, OtpStatus, InvoiceStatus, HdbApplicationStatus };

// ... existing types unchanged ...

// Replace the hdbApplicationStatus field in any input interfaces:
// updateHdbTracking now takes a typed enum value

export interface UpdateHdbTrackingInput {
  transactionId: string;
  hdbApplicationStatus?: HdbApplicationStatus;
  hdbAppointmentDate?: Date | null;
  agentId: string;
}
```

- [ ] **Step 6: Update `src/domains/transaction/transaction.repository.ts` — `updateHdbTracking`**

```typescript
import type { TransactionStatus, OtpStatus, HdbApplicationStatus } from '@prisma/client';

export async function updateHdbTracking(
  id: string,
  data: { hdbApplicationStatus?: HdbApplicationStatus; hdbAppointmentDate?: Date | null },
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      hdbApplicationStatus: data.hdbApplicationStatus,
      hdbAppointmentDate: data.hdbAppointmentDate,
    },
  });
}
```

- [ ] **Step 7: Update `src/domains/transaction/transaction.service.ts` — `updateHdbTracking`**

Replace the `hdbApplicationStatus?: string` parameter with the typed enum. Also add new structured fields:

```typescript
export async function updateHdbTracking(input: {
  transactionId: string;
  hdbApplicationStatus?: HdbApplicationStatus;
  hdbAppSubmittedAt?: Date;
  hdbAppSubmittedByAgentId?: string;
  hdbAppApprovedAt?: Date;
  hdbAppointmentDate?: Date | null;
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const updated = await txRepo.updateHdbTracking(input.transactionId, {
    hdbApplicationStatus: input.hdbApplicationStatus,
    hdbAppointmentDate: input.hdbAppointmentDate,
    ...(input.hdbAppSubmittedAt ? { hdbAppSubmittedAt: input.hdbAppSubmittedAt } : {}),
    ...(input.hdbAppSubmittedByAgentId ? { hdbAppSubmittedByAgentId: input.hdbAppSubmittedByAgentId } : {}),
    ...(input.hdbAppApprovedAt ? { hdbAppApprovedAt: input.hdbAppApprovedAt } : {}),
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.hdb_updated',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { hdbApplicationStatus: input.hdbApplicationStatus },
  });

  return updated;
}
```

Also add `HdbApplicationStatus` to the import at the top of `transaction.service.ts`:
```typescript
import type { HdbApplicationStatus } from './transaction.types';
```

- [ ] **Step 8: Update `src/domains/transaction/transaction.repository.ts` — `updateHdbTracking` signature**

```typescript
export async function updateHdbTracking(
  id: string,
  data: {
    hdbApplicationStatus?: HdbApplicationStatus;
    hdbAppointmentDate?: Date | null;
    hdbAppSubmittedAt?: Date;
    hdbAppSubmittedByAgentId?: string;
    hdbAppApprovedAt?: Date;
  },
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      hdbApplicationStatus: data.hdbApplicationStatus,
      hdbAppointmentDate: data.hdbAppointmentDate,
      ...(data.hdbAppSubmittedAt ? { hdbAppSubmittedAt: data.hdbAppSubmittedAt } : {}),
      ...(data.hdbAppSubmittedByAgentId ? { hdbAppSubmittedByAgentId: data.hdbAppSubmittedByAgentId } : {}),
      ...(data.hdbAppApprovedAt ? { hdbAppApprovedAt: data.hdbAppApprovedAt } : {}),
    },
  });
}
```

- [ ] **Step 9: Update `src/domains/transaction/transaction.validator.ts` — `validateUpdateHdb`**

Find the validator for the HDB update route and add enum validation:

```typescript
// In validateUpdateHdb array, update the hdbApplicationStatus validator:
body('hdbApplicationStatus')
  .optional()
  .isIn(['not_submitted', 'submitted', 'endorsed', 'approved', 'rejected'])
  .withMessage('Invalid HDB application status'),
```

- [ ] **Step 10: Update `src/domains/transaction/transaction.router.ts` — `PATCH /agent/transactions/:id/hdb`**

Pass the new typed fields from request body to service:

```typescript
const tx = await txService.updateHdbTracking({
  transactionId: req.params['id'] as string,
  hdbApplicationStatus: req.body.hdbApplicationStatus as HdbApplicationStatus | undefined,
  hdbAppointmentDate: req.body.hdbAppointmentDate
    ? new Date(req.body.hdbAppointmentDate as string)
    : undefined,
  agentId: user.id,
});
```

Add import at top of router:
```typescript
import type { HdbApplicationStatus } from './transaction.types';
```

- [ ] **Step 11: Update transaction service test — `makeTransaction` factory**

In `src/domains/transaction/__tests__/transaction.service.test.ts`, update `makeTransaction`:

```typescript
function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    agreedPrice: '600000',
    status: 'option_issued' as const,
    hdbApplicationStatus: 'not_submitted' as const,  // ← was string | null
    completionDate: null,
    exerciseDeadline: null,
    otp: null,
    commissionInvoice: null,
    ...overrides,
  };
}
```

- [ ] **Step 12: TypeScript check**

```bash
npx tsc --noEmit
```

Fix any remaining type errors (there may be `as string` casts in tests or router that need updating to `as HdbApplicationStatus`).

---

### Task 3: Fix 1C — OTP Missing `agentReviewedByAgentId`

**Problem:** `Otp.agentReviewedAt` records WHEN, but not WHO reviewed the OTP. Gate 4 audit trail is incomplete.

**Files to modify:**
- `prisma/schema.prisma`
- `src/domains/transaction/transaction.repository.ts`
- `src/domains/transaction/transaction.service.ts`
- `src/domains/transaction/__tests__/transaction.service.test.ts`

- [ ] **Step 1: Update `Otp` model in `prisma/schema.prisma`**

Add after `agentReviewedAt`:
```prisma
agentReviewedByAgentId  String?  @map("agent_reviewed_by_agent_id")
agentReviewedByAgent    Agent?   @relation("OtpReviewer", fields: [agentReviewedByAgentId], references: [id])
```

- [ ] **Step 2: Add back-relation to `Agent` model**

```prisma
otpsReviewed  Otp[]  @relation("OtpReviewer")
```

- [ ] **Step 3: Validate schema**

```bash
npx prisma validate
```

- [ ] **Step 4: Update `src/domains/transaction/transaction.repository.ts` — `updateOtpReview`**

```typescript
export async function updateOtpReview(
  id: string,
  reviewedAt: Date,
  agentId: string,
  notes?: string,
) {
  return prisma.otp.update({
    where: { id },
    data: {
      agentReviewedAt: reviewedAt,
      agentReviewedByAgentId: agentId,   // ← add this
      agentReviewNotes: notes ?? null,
    },
  });
}
```

- [ ] **Step 5: Update `src/domains/transaction/transaction.service.ts` — `markOtpReviewed`**

Pass `agentId` to the repo call:

```typescript
const updated = await txRepo.updateOtpReview(otp.id, new Date(), input.agentId, input.notes);
```

- [ ] **Step 6: Update `makeOtp` factory in tests**

In `src/domains/transaction/__tests__/transaction.service.test.ts`:

```typescript
function makeOtp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    transactionId: 'tx-1',
    hdbSerialNumber: 'SN-001',
    status: 'prepared' as const,
    issuedAt: null,
    agentReviewedAt: null,
    agentReviewedByAgentId: null,   // ← add this
    scannedCopyPathSeller: null,
    scannedCopyPathReturned: null,
    ...overrides,
  };
}
```

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

---

### Task 4: Fix 1D — CDD Records Not Linked to Transaction

**Problem:** `CddRecord` uses a polymorphic `subjectId` (no FK). There is no FK from `Transaction` to the seller's CDD record or the counterparty's CDD record.

**Files to modify:**
- `prisma/schema.prisma`

(No service/repo changes needed — these are nullable FKs. Existing code continues to work. A future ticket can wire up the linkage when the agent assigns a CDD record to a transaction.)

- [ ] **Step 1: Update `Transaction` model in `prisma/schema.prisma`**

Add after `estateAgencyAgreementId` (which comes in Group 2):
```prisma
sellerCddRecordId        String?    @map("seller_cdd_record_id")
sellerCddRecord          CddRecord? @relation("SellerCdd", fields: [sellerCddRecordId], references: [id])
counterpartyCddRecordId  String?    @map("counterparty_cdd_record_id")
counterpartyCddRecord    CddRecord? @relation("CounterpartyCdd", fields: [counterpartyCddRecordId], references: [id])
```

- [ ] **Step 2: Add named back-relations to `CddRecord` model**

```prisma
model CddRecord {
  // ... existing fields ...
  sellerTransactions       Transaction[] @relation("SellerCdd")
  counterpartyTransactions Transaction[] @relation("CounterpartyCdd")
}
```

- [ ] **Step 3: Validate schema**

```bash
npx prisma validate
```

---

### Task 5: Run Group 1 Migration

- [ ] **Step 1: Create and apply the migration**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2
npx prisma migrate dev --name fix_p0_schema_audit
```

Prisma will generate SQL for:
- `ALTER TABLE consent_records ADD COLUMN seller_id TEXT REFERENCES sellers(id), ADD COLUMN buyer_id TEXT REFERENCES buyers(id)`
- New index on `(subject_type, subject_id)` for consent_records
- `ALTER TABLE transactions ALTER COLUMN hdb_application_status TYPE ...` (replacing String? with enum)
- `ALTER TABLE transactions ADD COLUMN hdb_app_submitted_at TIMESTAMP, hdb_app_submitted_by_agent_id TEXT, hdb_app_approved_at TIMESTAMP`
- `ALTER TABLE otps ADD COLUMN agent_reviewed_by_agent_id TEXT REFERENCES agents(id)`
- `ALTER TABLE transactions ADD COLUMN seller_cdd_record_id TEXT, counterparty_cdd_record_id TEXT`

Watch the output. If Prisma asks about the existing `hdb_application_status` data (type change String? → enum), inspect the generated SQL. It will cast existing NULL values to `not_submitted` enum default automatically.

- [ ] **Step 2: Verify migration applied cleanly**

```bash
npx prisma migrate status
```

Expected: all migrations applied, no pending.

- [ ] **Step 3: Final Group 1 verification**

```bash
npx prisma validate
npx tsc --noEmit
npm test
```

All three must pass. Record the test count. Do not proceed to Group 2 until all three pass.

---

## Chunk 2: Group 2 — P1 Fixes

> ⚠️ **High-risk task:** Fix 2B and 2C (WeeklyUpdate/DocumentChecklist enum split) cascade through `review.types.ts`, `review.repository.ts`, and `review.service.ts`. The review system currently uses `FinancialReportStatus` as a unified status type for ALL entity types including WeeklyUpdate and DocumentChecklist. Splitting to dedicated enums requires careful type bridging.

### Task 6: Fix 2A — EAA Not Linked to Transaction

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Update `Transaction` model**

Add:
```prisma
estateAgencyAgreementId  String?               @map("estate_agency_agreement_id")
estateAgencyAgreement    EstateAgencyAgreement? @relation(fields: [estateAgencyAgreementId], references: [id])
```

- [ ] **Step 2: Add back-relation to `EstateAgencyAgreement` model**

```prisma
transactions  Transaction[]
```

- [ ] **Step 3: Validate**

```bash
npx prisma validate
```

---

### Task 7: Fix 2B — WeeklyUpdate Status Enum Split

**Background:** `WeeklyUpdate.status` currently uses `FinancialReportStatus` (which includes `rejected` and `sent`). The review domain (`review.repository.ts`, `review.service.ts`, `review.types.ts`) uses `FinancialReportStatus` as the universal status type. Splitting to `WeeklyUpdateStatus` requires plumbing changes throughout the review domain.

**Files to modify:**
- `prisma/schema.prisma`
- `src/domains/review/review.types.ts`
- `src/domains/review/review.repository.ts`
- `src/domains/review/review.service.ts`
- `src/domains/review/__tests__/review.router.test.ts`
- `src/domains/seller/seller.types.ts` (may reference WeeklyUpdate status)
- `src/domains/seller/seller.service.ts` (may reference WeeklyUpdate status)

- [ ] **Step 1: Add `WeeklyUpdateStatus` enum to `prisma/schema.prisma`**

```prisma
enum WeeklyUpdateStatus {
  draft
  ai_generated
  pending_review
  approved
  sent
}
```

- [ ] **Step 2: Update `WeeklyUpdate` model**

Replace:
```prisma
status  FinancialReportStatus @default(draft) @map("status")
```
With:
```prisma
status  WeeklyUpdateStatus @default(draft) @map("status")
```

- [ ] **Step 3: Validate schema**

```bash
npx prisma validate
```

- [ ] **Step 4: Update `src/domains/review/review.types.ts`**

The `ReviewItem.currentStatus` field currently types to `FinancialReportStatus`. We need a union type that covers both:

```typescript
import { FinancialReportStatus, WeeklyUpdateStatus, DocumentChecklistStatus } from '@prisma/client';

export type ReviewStatus = FinancialReportStatus | WeeklyUpdateStatus | DocumentChecklistStatus;

export interface ReviewItem {
  id: string;
  entityType: EntityType;
  entityId: string;
  sellerId: string;
  sellerName: string;
  propertyAddress: string;
  currentStatus: ReviewStatus;
  submittedAt: Date;
  priority: number;
}

// Keep REVIEW_TRANSITIONS keyed on FinancialReportStatus for financial_report,
// market_content; weekly_update and document_checklist use their own transition maps.
export const WEEKLY_UPDATE_TRANSITIONS: Record<WeeklyUpdateStatus, WeeklyUpdateStatus[]> = {
  draft: ['ai_generated'],
  ai_generated: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: ['ai_generated', 'pending_review'],
  sent: [],
};

export const DOCUMENT_CHECKLIST_TRANSITIONS: Record<DocumentChecklistStatus, DocumentChecklistStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: [],
  rejected: ['pending_review'],
};
```

Wait — `DocumentChecklistStatus` doesn't exist yet (that's Fix 2C). Add it as a placeholder here using `string` union, or do Fix 2C first. Since the schema migration happens once at the end of Group 2, do Fix 2C's enum addition to the schema simultaneously with Fix 2B (Step 1), then update the types together.

**Revised Step 1:** Add BOTH enums to schema at once:

```prisma
enum WeeklyUpdateStatus {
  draft
  ai_generated
  pending_review
  approved
  sent
}

enum DocumentChecklistStatus {
  draft
  pending_review
  approved
  rejected
}
```

Now `review.types.ts` can import both.

- [ ] **Step 5: Update `review.types.ts` — `validateTransition` adaptor**

The `validateTransition(from, to, entityType)` function currently takes `FinancialReportStatus` args and uses `REVIEW_TRANSITIONS`. We need to generalize it. The cleanest approach is to keep the function signature flexible and dispatch to the correct map:

```typescript
import {
  FinancialReportStatus,
  WeeklyUpdateStatus,
  DocumentChecklistStatus,
} from '@prisma/client';

export type ReviewStatus = FinancialReportStatus | WeeklyUpdateStatus | DocumentChecklistStatus;

export const REVIEW_TRANSITIONS: Record<FinancialReportStatus, FinancialReportStatus[]> = {
  draft: ['ai_generated'],
  ai_generated: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: ['ai_generated', 'pending_review'],
  sent: [],
};

export const WEEKLY_UPDATE_TRANSITIONS: Record<WeeklyUpdateStatus, WeeklyUpdateStatus[]> = {
  draft: ['ai_generated'],
  ai_generated: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: ['ai_generated', 'pending_review'],
  sent: [],
};

export const DOCUMENT_CHECKLIST_TRANSITIONS: Record<DocumentChecklistStatus, DocumentChecklistStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: [],
  rejected: ['pending_review'],
};
```

- [ ] **Step 6: Update `src/domains/review/review.service.ts` — `validateTransition`**

The current function takes `FinancialReportStatus`. Generalize it:

```typescript
import {
  REVIEW_TRANSITIONS,
  WEEKLY_UPDATE_TRANSITIONS,
  DOCUMENT_CHECKLIST_TRANSITIONS,
} from './review.types';
import type { EntityType, ReviewStatus } from './review.types';
import type { FinancialReportStatus, WeeklyUpdateStatus, DocumentChecklistStatus } from '@prisma/client';

export function validateTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  entityType: EntityType,
): void {
  // Route to the correct transition map based on entity type
  if (entityType === 'weekly_update') {
    const allowed = WEEKLY_UPDATE_TRANSITIONS[from as WeeklyUpdateStatus];
    if (!allowed?.includes(to as WeeklyUpdateStatus)) {
      throw new ValidationError(`Cannot transition weekly_update from '${from}' to '${to}'`);
    }
    return;
  }

  if (entityType === 'document_checklist') {
    const allowed = DOCUMENT_CHECKLIST_TRANSITIONS[from as DocumentChecklistStatus];
    if (!allowed?.includes(to as DocumentChecklistStatus)) {
      throw new ValidationError(`Cannot transition document_checklist from '${from}' to '${to}'`);
    }
    return;
  }

  // Default: FinancialReportStatus transitions (financial_report, listing_*, market_content)
  const allowed = REVIEW_TRANSITIONS[from as FinancialReportStatus];
  if (!allowed?.includes(to as FinancialReportStatus)) {
    throw new ValidationError(`Cannot transition from '${from}' to '${to}'`);
  }
  if (entityType === 'document_checklist' && to === 'sent') {
    throw new ValidationError(`Document checklists do not have a 'sent' step`);
  }
}
```

- [ ] **Step 7: Update `getCurrentStatus` in `review.service.ts`**

This function currently returns `FinancialReportStatus`. Update to return `ReviewStatus`:

```typescript
async function getCurrentStatus(
  entityType: EntityType,
  entityId: string,
): Promise<ReviewStatus> {
  if (entityType === 'listing_description' || entityType === 'listing_photos') {
    return 'pending_review';
  }
  const detail = await reviewRepo.getDetailForReview(entityType, entityId);
  if (!detail) throw new NotFoundError(entityType, entityId);
  return (detail as { status: ReviewStatus }).status;
}
```

- [ ] **Step 8: Update `approveItem` and `rejectItem` in `review.service.ts`**

Change `validateTransition` call args:
```typescript
const currentStatus = await getCurrentStatus(entityType, entityId);
validateTransition(currentStatus, 'approved', entityType);
```
These calls pass `'approved'` and `'rejected'` as strings — TypeScript will accept these since they exist in all three enums. No change needed.

- [ ] **Step 9: Update `src/domains/review/review.repository.ts`**

The `getPendingQueue` function currently builds `ReviewItem` with `currentStatus: w.status` for WeeklyUpdate. Since `w.status` is now `WeeklyUpdateStatus` (from Prisma), not `FinancialReportStatus`, the `ReviewItem.currentStatus: ReviewStatus` union type handles this correctly. No cast needed.

The `approveWeeklyUpdate` and `rejectWeeklyUpdate` functions pass `status: 'approved'` and `status: 'rejected'` to Prisma. Prisma expects `WeeklyUpdateStatus` enum values. Since `'approved'` and `'rejected'` are valid `WeeklyUpdateStatus` values, no change is needed — TypeScript will accept the string literals.

Check `mapMcsToFrs` — it maps `MarketContentStatus` → `FinancialReportStatus` for display in the review queue. Since `ReviewItem.currentStatus` is now `ReviewStatus` (a union), we can keep the return type as `FinancialReportStatus` for market content since those values are a subset of the union.

- [ ] **Step 10: Update `review.types.ts` — `ComplianceGate` type (no change needed)**

The `ComplianceGate` type doesn't involve status enums. No change needed.

- [ ] **Step 11: Check `src/domains/seller/` for WeeklyUpdate status references**

```bash
grep -n "WeeklyUpdate\|weekly_update\|FinancialReportStatus" \
  src/domains/seller/seller.types.ts \
  src/domains/seller/seller.service.ts \
  src/domains/seller/seller.router.ts
```

If any file references `WeeklyUpdate.status` typed as `FinancialReportStatus`, update those references to `WeeklyUpdateStatus`.

- [ ] **Step 12: TypeScript check**

```bash
npx tsc --noEmit
```

Fix any remaining type errors before proceeding.

---

### Task 8: Fix 2C — DocumentChecklist Status Enum Split

(Schema enum was added in Task 7 Step 1. TypeScript plumbing was also done in Task 7.)

**Files to modify:**
- `prisma/schema.prisma` ← already done in Task 7 Step 1
- `src/domains/review/review.types.ts` ← already done in Task 7
- `src/domains/review/review.service.ts` ← already done in Task 7
- `src/domains/review/review.repository.ts` ← verify

- [ ] **Step 1: Update `DocumentChecklist` model in schema**

Replace:
```prisma
status  FinancialReportStatus @default(draft) @map("status")
```
With:
```prisma
status  DocumentChecklistStatus @default(draft) @map("status")
```

- [ ] **Step 2: Verify `rejectDocumentChecklist` in review.repository.ts**

The function sets `status: 'rejected'`. This is a valid `DocumentChecklistStatus` value. Prisma will accept it. No change needed.

- [ ] **Step 3: Verify FinancialReportStatus is still used**

After removing it from WeeklyUpdate and DocumentChecklist, confirm `FinancialReportStatus` is still imported and used in:
- `FinancialReport.status` (schema)
- `review.types.ts` `REVIEW_TRANSITIONS`
- `review.repository.ts` `mapMcsToFrs`

It is still used. Do NOT remove it.

- [ ] **Step 4: Validate schema**

```bash
npx prisma validate
```

---

### Task 9: Fix 2D — Listing AI Description Draft Status Fields

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Update `Listing` model**

Add after `photosApprovedAt`:
```prisma
aiDescription             String?   @map("ai_description")
aiDescriptionProvider     String?   @map("ai_description_provider")
aiDescriptionModel        String?   @map("ai_description_model")
aiDescriptionStatus       String?   @map("ai_description_status")
aiDescriptionGeneratedAt  DateTime? @map("ai_description_generated_at")
```

Also add index:
```prisma
@@index([propertyId, status])
```

- [ ] **Step 2: Validate schema**

```bash
npx prisma validate
```

---

### Task 10: Run Group 2 Migration

- [ ] **Step 1: Create and apply the migration**

```bash
npx prisma migrate dev --name fix_p1_schema_audit
```

Prisma will generate SQL for:
- `ALTER TABLE transactions ADD COLUMN estate_agency_agreement_id TEXT REFERENCES estate_agency_agreements(id)`
- `CREATE TYPE "WeeklyUpdateStatus" AS ENUM (...)` + `ALTER TABLE weekly_updates ALTER COLUMN status TYPE "WeeklyUpdateStatus" USING status::text::"WeeklyUpdateStatus"`
- `CREATE TYPE "DocumentChecklistStatus" AS ENUM (...)` + `ALTER TABLE document_checklists ALTER COLUMN status TYPE "DocumentChecklistStatus" USING status::text::"DocumentChecklistStatus"`
- `ALTER TABLE listings ADD COLUMN ai_description TEXT, ai_description_provider TEXT, ai_description_model TEXT, ai_description_status TEXT, ai_description_generated_at TIMESTAMPTZ`
- New index on `(property_id, status)` for listings

⚠️ The enum type change for WeeklyUpdate and DocumentChecklist will CAST existing data. If existing rows have status values like `'sent'` (which is not in DocumentChecklistStatus), the CAST will fail. Before running, check:

```bash
# Connect to dev DB and verify no incompatible status values exist:
npx prisma db execute --stdin <<'SQL'
SELECT status, COUNT(*) FROM weekly_updates GROUP BY status;
SELECT status, COUNT(*) FROM document_checklists GROUP BY status;
SQL
```

Expected: only values `draft`, `pending_review`, `approved`, `rejected` exist. If `sent` is present in document_checklists, you must null/reset those rows first.

- [ ] **Step 2: Final Group 2 verification**

```bash
npx prisma validate
npx tsc --noEmit
npm test
```

All three must pass before Group 3.

---

## Chunk 3: Group 3 — P2 Fixes

### Task 11: Fix 3A — Missing Indexes

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Add indexes to `Property` model**

```prisma
@@index([sellerId, status])
```

- [ ] **Step 2: Add indexes to `CddRecord` model**

```prisma
@@index([subjectType, subjectId])
```

- [ ] **Step 3: Add indexes to `FinancialReport` model**

```prisma
@@index([sellerId, status])
```

- [ ] **Step 4: Add indexes to `Transaction` model**

```prisma
@@index([propertyId])
@@index([status])
```

(Note: `@@index([sellerId, status])` already exists on Transaction. The new ones are `propertyId` alone and `status` alone.)

- [ ] **Step 5: Validate schema**

```bash
npx prisma validate
```

---

### Task 12: Fix 3B — `consultationCompletedAt` on Seller

**Files to modify:**
- `prisma/schema.prisma`
- Agent seller-status update service/router (wherever `Seller.status → engaged` is set)

- [ ] **Step 1: Add field to `Seller` model**

```prisma
consultationCompletedAt  DateTime?  @map("consultation_completed_at")
```

- [ ] **Step 2: Find where Seller status is set to `engaged`**

```bash
grep -rn "status.*engaged\|engaged.*status" src/ --include="*.ts" | grep -v test
```

The search in Task 4 above found no direct `status = 'engaged'` setter outside of tests. The agent dashboard likely sets this via a general `updateSellerStatus` endpoint. Search the agent router and service:

```bash
grep -n "engaged\|updateSeller\|sellerStatus" \
  src/domains/agent/agent.service.ts \
  src/domains/agent/agent.router.ts \
  src/domains/agent/agent.repository.ts
```

- [ ] **Step 3: Update the status transition to set `consultationCompletedAt`**

When the agent sets `status = 'engaged'`, also set `consultationCompletedAt = new Date()`. Find the relevant service method and update:

```typescript
// In the relevant service method that sets status to 'engaged':
if (newStatus === 'engaged' && seller.status === 'lead') {
  data.consultationCompletedAt = new Date();
}
```

If there is no dedicated service method (i.e., it's done via a generic update), add logic to the agent service's seller status update path.

- [ ] **Step 4: Validate and type-check**

```bash
npx prisma validate
npx tsc --noEmit
```

---

### Task 13: Fix 3C — `disclaimerAcknowledgedAt` on FinancialReport

**Files to modify:**
- `prisma/schema.prisma`

No service changes needed — this is a new nullable field. Future work: the financial report service should set it when the seller acknowledges the disclaimer in the UI.

- [ ] **Step 1: Add field to `FinancialReport` model**

```prisma
disclaimerAcknowledgedAt  DateTime?  @map("disclaimer_acknowledged_at")
```

- [ ] **Step 2: Validate**

```bash
npx prisma validate
```

---

### Task 14: Fix 3D — CommissionInvoice Hardcoded Defaults

**Problem:** Schema has `@default(1499)`, `@default(134.91)`, `@default(1633.91)` on amount fields. If a future developer forgets to pass amounts explicitly, the schema defaults silently override SystemSetting values.

**Files to modify:**
- `prisma/schema.prisma`
- `src/domains/transaction/transaction.repository.ts` — make amounts non-optional
- `src/domains/transaction/__tests__/transaction.service.test.ts` — add assertion test

- [ ] **Step 1: Update `CommissionInvoice` model — remove defaults**

Replace:
```prisma
amount      Decimal @default(1499) @db.Decimal(12, 2)
gstAmount   Decimal @default(134.91) @map("gst_amount") @db.Decimal(12, 2)
totalAmount Decimal @default(1633.91) @map("total_amount") @db.Decimal(12, 2)
```
With:
```prisma
amount      Decimal @map("amount") @db.Decimal(12, 2)
gstAmount   Decimal @map("gst_amount") @db.Decimal(12, 2)
totalAmount Decimal @map("total_amount") @db.Decimal(12, 2)
```

- [ ] **Step 2: Verify `createCommissionInvoice` always passes amounts**

In `src/domains/transaction/transaction.repository.ts`, confirm `createCommissionInvoice` requires `amount`, `gstAmount`, `totalAmount` as non-optional:

```typescript
interface CreateCommissionInvoiceData {
  id?: string;
  transactionId: string;
  invoiceFilePath: string;
  invoiceNumber: string;
  amount: number;       // ← required, no default
  gstAmount: number;    // ← required, no default
  totalAmount: number;  // ← required, no default
}
```

This is already the case. No change needed to the interface. But confirm `transaction.service.ts` `uploadInvoice` always reads from SystemSetting before calling the repo — it already does.

- [ ] **Step 3: Add unit test asserting SystemSetting is called**

In `src/domains/transaction/__tests__/transaction.service.test.ts`, add inside `describe('uploadInvoice')`:

```typescript
it('reads amount, gstAmount, and totalAmount from SystemSetting — not schema defaults', async () => {
  const tx = makeTransaction();
  mockTxRepo.findById.mockResolvedValue(tx as never);
  mockTxRepo.findInvoiceByTransactionId.mockResolvedValue(null);
  mockSettings.getNumber
    .mockResolvedValueOnce(1499)   // commission_amount
    .mockResolvedValueOnce(0.09);  // gst_rate

  const mockInvoice = { id: 'invoice-1', amount: '1499', gstAmount: '134.91', totalAmount: '1633.91' };
  mockTxRepo.createCommissionInvoice.mockResolvedValue(mockInvoice as never);

  await txService.uploadInvoice({
    transactionId: 'tx-1',
    fileBuffer: Buffer.from('pdf'),
    originalFilename: 'invoice.pdf',
    invoiceNumber: 'INV-001',
    agentId: 'agent-1',
  });

  // Assert that SystemSetting was queried — not hardcoded schema defaults
  expect(mockSettings.getNumber).toHaveBeenCalledWith('commission_amount', 1499);
  expect(mockSettings.getNumber).toHaveBeenCalledWith('gst_rate', 0.09);

  // Assert that createCommissionInvoice received explicit amounts (not undefined)
  const createCall = mockTxRepo.createCommissionInvoice.mock.calls[0][0];
  expect(createCall.amount).toBe(1499);
  expect(createCall.gstAmount).toBe(134.91);
  expect(createCall.totalAmount).toBe(1633.91);
});
```

- [ ] **Step 4: Run the new test to confirm it passes**

```bash
npx jest transaction.service.test --no-coverage
```

- [ ] **Step 5: Validate schema**

```bash
npx prisma validate
```

---

### Task 15: Run Group 3 Migration

- [ ] **Step 1: Create and apply the migration**

```bash
npx prisma migrate dev --name fix_p2_schema_audit
```

Prisma will generate SQL for:
- New indexes on Property, CddRecord, FinancialReport, Transaction
- `ALTER TABLE sellers ADD COLUMN consultation_completed_at TIMESTAMPTZ`
- `ALTER TABLE financial_reports ADD COLUMN disclaimer_acknowledged_at TIMESTAMPTZ`
- `ALTER TABLE commission_invoices ALTER COLUMN amount DROP DEFAULT, ALTER COLUMN gst_amount DROP DEFAULT, ALTER COLUMN total_amount DROP DEFAULT`

The `DROP DEFAULT` on commission_invoices is a safe operation — existing rows already have explicit values.

- [ ] **Step 2: Final Group 3 verification**

```bash
npx prisma validate
npx tsc --noEmit
npm test
```

All three must pass.

---

## Chunk 4: Group 4 — P3 PDPA Completeness Fixes

### Task 16: Fix 4A — `retentionExpiresAt` on PII-Holding Models

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Add field to `Seller` model**

```prisma
retentionExpiresAt  DateTime?  @map("retention_expires_at")
```

- [ ] **Step 2: Add field to `CddRecord` model**

```prisma
retentionExpiresAt  DateTime?  @map("retention_expires_at")
```

- [ ] **Step 3: Validate**

```bash
npx prisma validate
```

---

### Task 17: Fix 4B — VerifiedViewer Consent Tracking

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Add fields to `VerifiedViewer` model**

```prisma
consentTimestamp   DateTime?  @map("consent_timestamp")
consentIpAddress   String?    @map("consent_ip_address")
consentUserAgent   String?    @map("consent_user_agent")
```

- [ ] **Step 2: Validate**

```bash
npx prisma validate
```

---

### Task 18: Fix 4C — Offer Buyer PII Retention

**Files to modify:**
- `prisma/schema.prisma`

- [ ] **Step 1: Add field to `Offer` model with documentation comment**

```prisma
model Offer {
  // buyerName and buyerPhone are PII. retentionExpiresAt must be set
  // by the service layer on offer creation. On transaction fallthrough,
  // the anonymisation job must null these fields after retentionExpiresAt.
  retentionExpiresAt  DateTime?  @map("retention_expires_at")
  // ... existing fields remain unchanged ...
}
```

Place the comment and new field near the other buyer PII fields (`buyerName`, `buyerPhone`).

- [ ] **Step 2: Validate**

```bash
npx prisma validate
```

---

### Task 19: Run Group 4 Migration

- [ ] **Step 1: Create and apply the migration**

```bash
npx prisma migrate dev --name fix_p3_schema_audit
```

Prisma will generate SQL for:
- `ALTER TABLE sellers ADD COLUMN retention_expires_at TIMESTAMPTZ`
- `ALTER TABLE cdd_records ADD COLUMN retention_expires_at TIMESTAMPTZ`
- `ALTER TABLE verified_viewers ADD COLUMN consent_timestamp TIMESTAMPTZ, ADD COLUMN consent_ip_address TEXT, ADD COLUMN consent_user_agent TEXT`
- `ALTER TABLE offers ADD COLUMN retention_expires_at TIMESTAMPTZ`

- [ ] **Step 2: Final Group 4 verification**

```bash
npx prisma validate
npx tsc --noEmit
npm test
```

All three must pass.

---

## Final Verification

- [ ] **Step 1: Check migration status**

```bash
npx prisma migrate status
```

Expected: all migrations applied, 0 pending.

- [ ] **Step 2: Validate schema**

```bash
npx prisma validate
```

- [ ] **Step 3: TypeScript compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Full test suite**

```bash
npm test
```

- [ ] **Step 5: Confirm zero drift between migrations and schema**

```bash
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --exit-code
```

Expected: exits with code 0 (no drift). If it outputs SQL, the schema and migrations are out of sync — investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/
git commit -m "fix(schema): apply P0-P3 schema audit fixes across four migrations

- Fix 1A: ConsentRecord FK bug (sellerId/buyerId columns replace subjectId FK)
- Fix 1B: Gate 5 HDB application structured tracking (enum + timestamps + agent FK)
- Fix 1C: Gate 4 OTP agentReviewedByAgentId FK
- Fix 1D: CDD record FKs on Transaction (sellerCddRecordId, counterpartyCddRecordId)
- Fix 2A: EAA FK on Transaction
- Fix 2B/2C: WeeklyUpdate/DocumentChecklist dedicated status enums + review domain refactor
- Fix 2D: Listing AI description draft status fields
- Fix 3A: Missing indexes (Property, CddRecord, FinancialReport, Transaction)
- Fix 3B: consultationCompletedAt on Seller
- Fix 3C: disclaimerAcknowledgedAt on FinancialReport
- Fix 3D: Remove CommissionInvoice hardcoded schema defaults + assertion test
- Fix 4A: retentionExpiresAt on Seller, CddRecord
- Fix 4B: VerifiedViewer consent timestamp/IP/UA fields
- Fix 4C: Offer retentionExpiresAt with PDPA anonymisation comment

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Known Tricky Points

1. **`hdbApplicationStatus` migration:** Prisma will try to cast `NULL` → `not_submitted` for existing rows. This should work automatically. If it fails, the generated SQL will need a manual `USING status::text::"HdbApplicationStatus"` clause or a default. Check the generated migration SQL before applying to prod.

2. **WeeklyUpdate/DocumentChecklist enum cast:** If ANY existing row has a status value that doesn't exist in the new enum (e.g., `sent` in document_checklists), the migration will fail. Verify data before running. If needed, add a data migration step to reset invalid values.

3. **`review.service.ts` `validateTransition` now takes `ReviewStatus`:** The two call sites in `approveItem` and `rejectItem` pass string literals `'approved'` and `'rejected'`. Both exist in all three status enums, so TypeScript accepts them as `ReviewStatus`. If TypeScript complains, use explicit casts: `validateTransition(currentStatus, 'approved' as ReviewStatus, entityType)`.

4. **`review.repository.ts` `getPendingQueue`:** The `currentStatus` field for WeeklyUpdate items was previously cast to `FinancialReportStatus`. Now that `ReviewItem.currentStatus` is `ReviewStatus` (a union), no cast is needed — the types flow naturally.

5. **Test factories:** Any test that constructs a `Transaction` mock with `hdbApplicationStatus: 'Submitted'` (a free-form string) must be updated to use `hdbApplicationStatus: 'submitted'` (the enum value).
