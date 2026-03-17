# Transaction Timeline — Design Spec
**Date:** 2026-03-17
**Scope:** Admin (`/admin/sellers/:id`) and Agent (`/agent/sellers/:id`) seller detail pages

## Overview

Replace the current 6-step, property-status-only timeline with an 11-step timeline that covers the full seller journey from compliance through completion. Admins see an expanded view with OTP and HDB sub-steps. Both roles see timestamps on each milestone.

---

## Milestone List

### Agent & Admin (11 milestones, in order)

| # | Label | Completed when | Date shown |
|---|-------|---------------|------------|
| 1 | Seller CDD Done | `sellerCddRecord` exists | `sellerCddRecord.createdAt` |
| 2 | Estate Agency Agreement Signed | `eaa.signedCopyPath` set | `eaa.videoCallConfirmedAt` |
| 3 | Property Listed | `property.status` ≠ `draft` | `property.listedAt` |
| 4 | Viewings | `property.status` = `offer_received` or beyond | `firstViewingAt` |
| 5 | Offer Received | `acceptedOffer` exists | `acceptedOffer.createdAt` |
| 6 | Counterparty CDD *(If Required)* | `counterpartyCddRecord` exists — or N/A if `isCoBroke` | `counterpartyCddRecord.createdAt` |
| 7 | OTP Review | `otp.agentReviewedAt` set | `otp.agentReviewedAt` |
| 8 | OTP Issued | `otp.issuedAt` set | `otp.issuedAt` |
| 9 | OTP Exercised | `otp.exercisedAt` set | `otp.exercisedAt` |
| 10 | HDB Resale Submission | `hdbApplicationStatus` ≠ `not_started` | `hdbAppSubmittedAt` |
| 11 | Completion | `transaction.status` = `completed` | `transaction.completionDate` |

### Admin-only sub-steps

**OTP sub-steps** — spliced between milestones 5 and 7 (after Offer Received, before OTP Review):

| Label | Completed when | Date |
|-------|---------------|------|
| OTP Prepared | OTP status ≥ `sent_to_seller` | null |
| OTP Sent to Seller | OTP status ≥ `signed_by_seller` | null |
| OTP Signed by Seller | OTP status ≥ `returned` | null |
| OTP Returned to Agent | OTP status ≥ `issued_to_buyer` | null |

Completion is inferred from the OTP state machine order (`OTP_TRANSITIONS`). No timestamps are stored for these intermediate states so dates show as null.

**HDB sub-steps** — spliced between milestones 10 and 11 (after HDB Resale Submission, before Completion):

| Label | Completed when | Date |
|-------|---------------|------|
| HDB Approval in Principle | `hdbApplicationStatus` ≥ `approval_in_principle` | null |
| HDB Approval Granted | `hdbApplicationStatus` ≥ `approval_granted` | `hdbAppApprovedAt` |
| Resale Checklist Submitted | `hdbApplicationStatus` ≥ `resale_checklist_submitted` | null |
| HDB Appointment Booked | `hdbApplicationStatus` ≥ `hdb_appointment_booked` | `hdbAppointmentDate` |

---

## Status Logic

- **`completed`** — milestone condition is met
- **`current`** — first milestone whose condition is not yet met
- **`upcoming`** — all milestones after `current`
- **`not_applicable`** — Counterparty CDD only, when `isCoBroke = true`

The `not_applicable` state is visually distinct: greyed out with an "N/A" badge. It is never `current` — the next uncompleted milestone after it becomes `current` instead.

Dates are formatted as `DD MMM YYYY`. If a date is null, the date line is hidden (not rendered as empty).

---

## Data Interface

```typescript
interface TimelineInput {
  sellerCddRecord:       { createdAt: Date } | null;
  eaa:                   { videoCallConfirmedAt: Date | null; signedCopyPath: string | null } | null;
  property:              { status: PropertyStatus; listedAt: Date | null } | null;
  firstViewingAt:        Date | null;
  acceptedOffer:         { createdAt: Date } | null;
  counterpartyCddRecord: { createdAt: Date } | null;
  isCoBroke:             boolean;
  otp: {
    status:            OtpStatus;
    agentReviewedAt:   Date | null;
    issuedAt:          Date | null;
    exercisedAt:       Date | null;
  } | null;
  transaction: {
    status:               TransactionStatus;
    hdbApplicationStatus: HdbApplicationStatus;
    hdbAppSubmittedAt:    Date | null;
    hdbAppApprovedAt:     Date | null;
    hdbAppointmentDate:   Date | null;
    completionDate:       Date | null;
  } | null;
}
```

Function signature:

```typescript
function getTimelineMilestones(data: TimelineInput, role: 'agent' | 'admin'): TimelineMilestone[]
```

`TimelineMilestone` type gains:
- `date: Date | null` (already exists, currently always null — now populated)
- `notApplicable: boolean` (new, drives N/A styling for Counterparty CDD)

---

## Architecture

### `seller.service.ts` — `getTimelineMilestones()`
- Refactored to accept `TimelineInput` + `role`
- Single source of truth for both agent and admin
- Returns flat list — admin list is longer due to inline sub-steps

### `agent.router.ts` (line ~139)
- Currently passes only `property.status`
- Must load additional data before calling `getTimelineMilestones`:
  - `sellerCddRecord` via `complianceService.findLatestSellerCddRecord(sellerId)`
  - `eaa` via `transactionService` or directly from seller detail
  - `acceptedOffer` via `offerService` or transaction
  - `counterpartyCddRecord` via `complianceService.findCddRecordByTransactionAndSubjectType`
  - `otp` via `transactionService`
  - `firstViewingAt` via `viewingService` (first confirmed viewing date)
- All are read-only lookups via existing services — no direct repo imports

### `admin.service.ts` (line ~572)
- Already has rich data context in `AdminSellerDetail`
- Passes new `TimelineInput` shape and `role: 'admin'`

### Templates
- `src/views/partials/agent/seller-timeline.njk` — add date line, add N/A state
- `src/views/partials/seller/timeline.njk` — same changes (seller-facing, for consistency)

---

## What Does Not Change
- The `TimelineMilestone` interface stays in `seller.types.ts`
- Template structure (vertical list, dot indicators) stays the same
- No new database fields required
- No schema migrations required
