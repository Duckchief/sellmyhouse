# Phase 4: Transaction Management — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Sub-phases:** SP1 (Offer + Portal), SP2 (Transaction lifecycle)

---

## Overview

Phase 4 builds the full transaction management lifecycle: recording and negotiating offers, generating portal-ready listing content for manual posting, tracking the physical OTP process, handling the Huttons commission invoice, and running the post-completion sequence.

Phases 1–3 must be complete before starting Phase 4. Most Phase 4 models (`Transaction`, `Otp`, `CommissionInvoice`, `PortalListing`) exist in the schema. SP1 requires a schema migration to add AI analysis fields to the `Offer` model (see Section 2).

---

## Sub-phase Split

### SP1: Offer Domain + Portal Formatter
- `offer` domain (new)
- Portal formatter + portal service + portal router inside `property` domain (additions)
- Schema migration: add AI analysis fields to `Offer`

### SP2: Transaction Domain
- `transaction` domain (new) — OTP lifecycle, commission invoice, HDB tracking, completion, post-completion cron

---

## 1. Domain Structure

### New modules

```
src/domains/offer/
  offer.types.ts
  offer.service.ts
  offer.repository.ts
  offer.router.ts
  offer.validator.ts
  __tests__/
    offer.service.test.ts
    offer.repository.test.ts
    offer.router.test.ts

src/domains/transaction/
  transaction.types.ts
  transaction.service.ts
  transaction.repository.ts
  transaction.router.ts
  transaction.validator.ts
  transaction.jobs.ts          ← post-completion + OTP reminder cron handlers (follows existing pattern: viewing.jobs.ts lives in src/domains/viewing/)
  __tests__/
    transaction.service.test.ts
    transaction.repository.test.ts
    transaction.router.test.ts
    transaction.jobs.test.ts
```

### Property domain additions (SP1)

```
src/domains/property/
  portal.formatter.ts          ← pure function, no DB access
  portal.service.ts            ← persists PortalListing records
  portal.router.ts             ← agent portal page routes
  __tests__/
    portal.formatter.test.ts
    portal.service.test.ts
    portal.router.test.ts
```

### New SystemSetting keys (must be added to seed in SP1)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `offer_ai_analysis_enabled` | bool | `true` | Toggle AI narrative generation on offer creation |
| `otp_exercise_days` | int | `21` | Calendar days from OTP issuance to exercise deadline |

Existing seed keys used by Phase 4 (already present):

| Key | Value | Used by |
|-----|-------|---------|
| `commission_amount` | `1499` | Commission invoice amounts |
| `commission_gst_rate` | `0.09` | Commission invoice GST calculation |
| `agency_name` | `Huttons Asia Pte Ltd` | Portal formatter CEA fields |
| `agency_licence` | `L3008899K` | Portal formatter CEA fields |

---

## 2. Offer Domain (SP1)

### Responsibility
Manage the full offer negotiation lifecycle from first offer to acceptance or rejection.

### Schema migration (SP1)
Add the following fields to the `Offer` model in `prisma/schema.prisma`:

```prisma
aiAnalysis         String?   @map("ai_analysis")
aiAnalysisProvider String?   @map("ai_analysis_provider")
aiAnalysisModel    String?   @map("ai_analysis_model")
aiAnalysisStatus   String?   @map("ai_analysis_status")  // generated | reviewed | shared
```

These follow the same pattern as `FinancialReport.aiNarrative` / `aiProvider` / `aiModel`.

### Offer recording flow
When an agent records a new offer via `POST /agent/offers`:
1. Validate and persist `Offer` record (status: `pending`)
2. Fetch HDB market comps: last 12 months, same town + flat type from `HdbTransaction`
3. If `offer_ai_analysis_enabled` is `true`, call AI facade to generate narrative analysis
4. Store `aiAnalysis`, `aiAnalysisProvider`, `aiAnalysisModel`, `aiAnalysisStatus: 'generated'` on the offer record
5. Send seller notification (in-app always; WhatsApp + email per `notificationPreference`). All WhatsApp sends route through the notification domain's DNC check before dispatch.

### Human-in-the-loop for AI analysis
AI offer analysis follows the mandatory human-in-the-loop pattern from CLAUDE.md:

```
generated → reviewed → shared
```

- `generated`: AI has produced the analysis; visible to agent only
- `reviewed`: Agent has confirmed the analysis is accurate (explicit action `POST /agent/offers/:id/analysis/review`)
- `shared`: Agent has shared the analysis with the seller (explicit action `POST /agent/offers/:id/analysis/share`)

The service blocks sharing until `aiAnalysisStatus` is `reviewed`. The service blocks the agent from advancing from `reviewed` to `shared` without an explicit share action. This enforces `ai_generated → pending_review → approved → sent` as required by CLAUDE.md.

### Counter-offer chain
When agent counters an offer:
- Creates new `Offer` record with `parentOfferId` → original offer ID
- Sets `counterAmount` on the new record
- Sets parent offer status → `countered`

Chain displayed in seller detail view as a threaded list:
```
Offer $620K (countered) → Counter $650K (countered) → Counter $640K (accepted)
```

### Offer acceptance → Transaction
When agent marks an offer `accepted`:
- Offer status → `accepted`
- All sibling offers (same property, status `pending` or `countered`) auto-set to `expired` — this closes all open negotiation threads on the property
- UI prompts agent to create a Transaction with the agreed price
- Transaction creation is an explicit separate action (`POST /agent/transactions`) — not automatic
- No `offerId` FK on `Transaction` — the link is implicit via `propertyId` + `agreedPrice`. The accepted offer and the transaction are the same agreed price; a formal FK is not required as the audit log records the relationship via `AuditLog` entries on both entities at acceptance time.

### State machine
```
pending → countered | accepted | rejected | expired
```
`countered` means a child counter-offer has been created; the parent stays in `countered` state. Only `pending` offers can be actioned.

### Routes (agent-facing only)
```
GET  /agent/properties/:propertyId/offers      — offer chain for a property
POST /agent/offers                             — record new offer
POST /agent/offers/:id/counter                 — record counter-offer
POST /agent/offers/:id/accept                  — accept offer (returns prompt to create transaction)
POST /agent/offers/:id/reject                  — reject offer
POST /agent/offers/:id/analysis/review         — mark AI analysis as reviewed
POST /agent/offers/:id/analysis/share          — share AI analysis with seller
```

Note: Offers are fetched by `propertyId` (the direct FK on the `Offer` model). The seller detail page in the agent dashboard loads the property first, then fetches offers by `propertyId`. There is no direct `sellerId` → offers query; the join goes through `Property`.

---

## 3. Portal Formatter (SP1)

### Responsibility
Generate portal-ready structured content from an approved listing for manual posting to PropertyGuru, 99.co, and SRX.

### `portal.formatter.ts` — pure function
```typescript
type PortalContent = {
  title: string;
  description: string;
  flatDetails: {
    town: string;
    flatType: string;
    floorAreaSqm: number;
    storeyRange: string;
    remainingLease: string;
    askingPrice: number;
  };
  photos: string[];        // optimized file paths
  ceaDetails: {
    agentName: string;     // from Agent.name
    ceaRegNo: string;      // from Agent.ceaRegNo
    agencyName: string;    // hardcoded constant: "Huttons Asia Pte Ltd"
    agencyLicence: string; // hardcoded constant: "L3008899K"
    agentPhone: string;    // from Agent.phone
  };
};

function formatForPortal(
  portal: PortalName,  // PortalName enum: propertyguru | ninety_nine_co | srx | other
  listing: Listing,
  property: Property,
  agent: Agent,
  agencyName: string,    // from SystemSetting 'agency_name'
  agencyLicence: string, // from SystemSetting 'agency_licence'
): PortalContent
```

**CEA constants:** `agencyName` and `agencyLicence` are read from SystemSetting keys `agency_name` and `agency_licence` at service call time (both already seeded). The formatter receives them as parameters — it is a pure function and does not call SystemSetting directly. The `portal.service.ts` reads these values and passes them into the formatter.

CEA fields are always present and populated — required by CEA advertising compliance.

**Note on PortalName enum values:** The TypeScript/Prisma enum uses `propertyguru`, `ninety_nine_co`, `srx`. UI display labels differ: "PropertyGuru", "99.co", "SRX". The formatter switches on enum values; display labels are defined in the view layer only.

### `portal.service.ts`
- `generatePortalListings(listingId)` — calls formatter for each portal (`propertyguru`, `ninety_nine_co`, `srx`), upserts `PortalListing` records. Called automatically when a listing is approved in the review gate (hooks into existing Phase 3 review approval flow).
- `markAsPosted(portalListingId, url)` — records `postedManuallyAt` + `portalListingUrl`, sets status → `posted`
- `getPortalListings(listingId)` — returns all PortalListing records for a listing

### Portal page — `/agent/listings/:listingId/portals`
Dedicated page with three panels (one per portal). Each panel shows:
- Field-by-field display with "Copy" button per field (HTMX clipboard copy)
- Photo list with copy/download
- Form to paste live portal URL back
- "Mark as Posted" action

HTMX pattern: `hx-on:click` for clipboard copy; `hx-post` for marking posted + URL submission.

### Trigger
`portal.service.generatePortalListings()` is called inside the existing listing approval handler in Phase 3's review gate. Portal content is generated before the agent opens the portal page.

---

## 4. OTP Lifecycle (SP2)

### Responsibility
Track the physical HDB OTP form through its lifecycle. Platform does not generate or modify the OTP — it tracks status and stores scanned copies only.

### State machine
```
prepared → sent_to_seller → signed_by_seller → returned → issued_to_buyer → exercised
                                                                           ↘ expired
```

All transitions are agent-initiated except `expired`, which is set by the daily reminder cron when exercise deadline passes without exercise.

The service enforces strict sequential transitions using a typed constant:
```typescript
const OTP_TRANSITIONS: Record<OtpStatus, OtpStatus | null> = {
  prepared: 'sent_to_seller',
  sent_to_seller: 'signed_by_seller',
  signed_by_seller: 'returned',
  returned: 'issued_to_buyer',
  issued_to_buyer: 'exercised',
  exercised: null,
  expired: null,
};
```
`POST /agent/transactions/:id/otp/advance` sends `{ notes }` only — the service calculates the next status from the current one. Arbitrary status jumps are rejected.

### Key gates
- `issued_to_buyer` is blocked unless `agentReviewedAt` is set — enforced in service layer, not just UI
- When OTP transitions to `issued_to_buyer`: service sets `Otp.issuedAt = new Date()` (current timestamp at call time) and `Transaction.exerciseDeadline = issuedAt + otp_exercise_days calendar days` (read from `SystemSetting` key `otp_exercise_days` at runtime, default 21). `Transaction.exerciseDeadline` is the single source of truth; the cron reads from this persisted field rather than recalculating. If an agent needs to record a past issuance date (e.g. OTP was physically issued yesterday), `POST /agent/transactions/:id/otp/advance` accepts an optional `issuedAt` ISO date in the request body — if omitted, `new Date()` is used.
- Scanned copy upload is required at two distinct steps: `signed_by_seller` (seller's signed copy) and `returned` (returned original). Two separate files stored at:
  - `/uploads/otp/{transactionId}/signed-by-seller.{ext}`
  - `/uploads/otp/{transactionId}/returned.{ext}`
  - All uploaded filenames sanitised and path traversal (`../`) rejected per CLAUDE.md file upload security rules. UUID-based internal filenames used, not user-supplied names.

**Schema note:** The `Otp` model currently has a single `scannedCopyPath` field and single `scannedCopyDeletedAt`. SP2 must add a migration:
```prisma
scannedCopyPathSeller   String?   @map("scanned_copy_path_seller")
scannedCopyPathReturned String?   @map("scanned_copy_path_returned")
scannedCopyDeletedAt    DateTime? @map("scanned_copy_deleted_at")  // single deletion timestamp (both files deleted together under PDPA, subject to AML retention — see below)
```
The original `scannedCopyPath` field is removed in the same migration.

### AML/CFT retention for OTP scans
OTP scans are transaction documents subject to the 5-year AML/CFT retention rule. PDPA deletion requests for a seller within the retention window must not delete these files. The `scannedCopyDeletedAt` field tracks deletion; Phase 5's data deletion handler must check `transaction.createdAt + 5 years` before deleting OTP scan files.

### OTP reminders (daily cron, 9am SGT)
Checks all OTPs with status `issued_to_buyer`. For each one, reads `Transaction.exerciseDeadline`. If the deadline is exactly 14, 7, 3, or 1 day(s) away:
1. Check `Notification` table for existing record with matching `templateName` + `recipientId` to prevent duplicate sends on cron re-runs
2. Send WhatsApp + email + in-app per seller `notificationPreference` (all WhatsApp sends route through DNC check in notification domain)
3. Log `Notification` record

### Routes (agent-facing)
```
POST /agent/transactions/:id/otp                      — create OTP record (status: prepared)
POST /agent/transactions/:id/otp/advance              — advance to next status { notes }
POST /agent/transactions/:id/otp/scan/seller          — upload signed-by-seller scan (multipart, max 10MB)
POST /agent/transactions/:id/otp/scan/returned        — upload returned scan (multipart, max 10MB)
POST /agent/transactions/:id/otp/review               — mark agent review complete
```

### Fallen-through cascade
When transaction status → `fallen_through`:
- Active OTP → `expired`
- Listing → `draft`
- Property → `draft`
- `PortalListing` records with status `ready` or `posted` → `expired`
- Active viewing slots → `cancelled` (viewers notified)
- Transaction record preserved
- Agent alerted to manually delist from live portals (in-app notification)

---

## 5. Commission Invoice (SP2)

### Responsibility
Store and distribute the Huttons-generated commission invoice. Platform does not generate invoices.

### Flow
```
pending_upload → uploaded → sent_to_client → paid
```

### Service methods
- `uploadInvoice(transactionId, file, invoiceNumber)` — validates PDF (max 10MB, pdf only, sanitised filename, path traversal rejected), stores at `/uploads/invoices/{transactionId}/`, reads `commission_amount` and `commission_gst_rate` from `SystemSetting` at creation time and explicitly sets `amount`, `gstAmount`, `totalAmount` on the record (never relies on Prisma schema defaults), sets status → `uploaded`
- `sendInvoice(transactionId, channel)` — sends PDF via WhatsApp and/or email per seller `notificationPreference` (routes through DNC check), records `sentAt` + `sentVia`, sets status → `sent_to_client`
- `markPaid(transactionId)` — records `paidAt`, sets status → `paid`

**Note on schema defaults:** The `CommissionInvoice` model has Prisma-level `@default(1499)` / `@default(134.91)` / `@default(1633.91)` on the amount fields. These are DB-level fallbacks only. The service **must always** read from `SystemSetting` keys `commission_amount` and `commission_gst_rate`, and pass amounts explicitly — never rely on schema defaults. A unit test asserts that amounts come from SystemSetting, not schema defaults.

### AML/CFT retention for invoice files
Commission invoices are transaction documents subject to the 5-year AML/CFT retention rule. Phase 5's data deletion handler must check `transaction.createdAt + 5 years` before deleting invoice files. The `invoiceDeletedAt` field tracks deletion.

### File protection
Invoice PDF is served through an authenticated application route. Never served directly via nginx.

### Routes (agent-facing)
```
POST /agent/transactions/:id/invoice/upload   — multipart PDF upload
POST /agent/transactions/:id/invoice/send     — send to client
POST /agent/transactions/:id/invoice/paid     — mark as paid
GET  /agent/transactions/:id/invoice/file     — authenticated file download
```

---

## 6. Completion & Post-Completion (SP2)

### HDB application tracking
Agent manually updates `hdbApplicationStatus` (free-form string: "Submitted", "Endorsed", "Approved") and `hdbAppointmentDate` on the transaction record. No state machine — HDB's process is external and unpredictable.

### Transaction status progression
```
option_issued → option_exercised → completing → completed → fallen_through
```
Agent advances status manually via `PATCH /agent/transactions/:id/status`. `fallen_through` triggers the cascade described in Section 4.

When advancing to `completed`: `completionDate` is automatically set to the current timestamp by the service. This is the source of truth for post-completion sequence timing.

### Post-completion sequence (daily cron, 9am SGT)
```
Day 1 after completionDate:   thank-you message     → seller (service consent, always)
Day 7 after completionDate:   testimonial request   → seller (service consent, always)
Day 14 after completionDate:  buyer-side follow-up  → seller (marketing consent required)
```

For each step:
1. Query transactions with `completionDate` on date `today - N days` and status `completed`
2. Check `Notification` table for existing record (`templateName` + `recipientId`) to prevent re-sending on cron re-runs
3. For day 14 only: check seller has active marketing consent — blocked if absent
4. Send via `notificationPreference` channels (all WhatsApp sends route through DNC check), log `Notification` record

### Transaction routes (agent-facing)
```
GET   /agent/transactions/:id             — transaction detail (OTP, invoice, HDB tracking)
POST  /agent/transactions                 — create transaction from accepted offer
PATCH /agent/transactions/:id/hdb         — update HDB status + appointment date
PATCH /agent/transactions/:id/status      — advance transaction status
```

### Seller dashboard (read-only panel)
Seller sees current OTP step, exercise deadline countdown, HDB appointment date. No seller actions in Phase 4.

---

## 7. Testing Requirements

### Unit tests
- `offer.service`: offer creation with/without AI analysis, counter-offer chain, state transitions, sibling expiry on acceptance
- `offer.service`: AI analysis HITL — sharing blocked until `reviewed`, review blocked until `generated`
- `portal.formatter`: correct output for all three `PortalName` enum values including all CEA fields (agencyName and agencyLicence hardcoded constants verified)
- `portal.service`: `generatePortalListings` creates one record per portal, `markAsPosted` updates correctly
- `transaction.service`: OTP strict sequential transitions enforced (no arbitrary jumps), blocks `issued_to_buyer` without agent review, `exerciseDeadline` set correctly on `issuedAt + SystemSetting.otp_exercise_days`
- `transaction.service`: commission invoice amounts always explicitly read from SystemSetting — not schema defaults
- `transaction.service`: `completionDate` automatically set on transition to `completed`
- `transaction.service`: post-completion sequence blocked without marketing consent (day 14)
- `transaction.jobs`: OTP reminder deduplication (no double-send), post-completion deduplication

### Integration tests
- Offer full lifecycle: record → counter → accept → create transaction
- Portal content generated when listing approved
- OTP full lifecycle with two scanned copy uploads (seller + returned)
- OTP reminders sent at correct intervals, not re-sent
- Invoice upload → send to client → notification logged
- Post-completion sequence respects consent status and deduplication
- Fallen-through cascade: OTP expired, PortalListing expired, listing/property reverted to draft

### E2E tests
- Full transaction lifecycle: listing approved → portal content → offer → OTP → completion → invoice → post-completion

---

## 8. Compliance Notes

- **CEA:** All portal content must include agent name, CEA reg no, agency name (from SystemSetting `agency_name`), agency licence number (from SystemSetting `agency_licence`), agent phone — enforced in `portal.formatter.ts`. Values passed in by `portal.service.ts` which reads from SystemSetting.
- **Commission:** Always $1,499 + GST read from SystemSetting at record creation, never hardcoded, never percentage-based
- **OTP:** Platform tracks only. Does not generate or modify the physical form.
- **Invoice:** Platform stores and distributes only. Does not generate the invoice.
- **Human-in-the-loop:** AI offer analysis follows strict `generated → reviewed → shared` status flow (domain-specific mapping of CLAUDE.md's canonical `ai_generated → pending_review → approved → sent`). Service blocks sharing without review. Cannot skip.
- **DNC:** All WhatsApp sends in offer and transaction flows route through the notification domain's DNC check before dispatch.
- **Marketing consent:** Day-14 buyer follow-up message blocked without explicit marketing consent
- **AML/CFT retention:** OTP scan files and commission invoice PDFs are transaction documents retained for 5 years minimum. Phase 5 deletion handler must check `transaction.createdAt + 5 years` before deleting these files. `scannedCopyDeletedAt` and `invoiceDeletedAt` track deletion timestamps.
- **Audit:** All status transitions logged in `AuditLog`
- **File protection:** OTP scans and invoice PDFs served through authenticated routes only, never directly via nginx
