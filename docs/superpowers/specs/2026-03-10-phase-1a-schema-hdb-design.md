# Phase 1A Design Spec: Full Prisma Schema + HDB Data Ingestion

## Overview

Port the complete v1 Prisma schema (29 models, 36 enums) to v2's TypeScript + domain-driven architecture, then implement HDB resale transaction data ingestion (CSV seed + data.gov.sg sync).

### What Changes from v1

1. **IDs**: `@default(uuid())` → cuid2 generated in app code (no `@default` on `id` fields)
2. **Money fields**: `Float` → `Decimal` (Prisma native type `@db.Decimal(12,2)`)
3. **Column naming**: `@@map("snake_case_table")` + `@map("snake_case_column")` on every field
4. **No agent relation on SystemSetting/AuditLog**: These already exist in v2 Phase 0 schema without agent FK (agent ID stored as plain string, not a relation — avoids circular dependency during bootstrap)

### What Stays the Same

- All model names, field names (camelCase in Prisma, snake_case in DB)
- All enums and their values
- All relations, indexes, and `@unique` field constraints
- All field nullability (`?` optional modifiers)
- Business logic rules (append-only audit, granular consent, etc.)

---

## 1. Prisma Schema

### 1.1 Enums

Port all v1 enums exactly. Group them at the top of `schema.prisma`:

```
AgentRole, SellerStatus, NotificationPreference, LeadSource,
BuyerStatus, PropertyStatus, ListingStatus, PortalName,
PortalListingStatus, ViewerType, ViewingStatus, SlotType,
SlotStatus, OfferStatus, TransactionStatus, OtpStatus,
InvoiceStatus, AgreementType, AgreementStatus, RiskLevel,
SubjectType, ConsentSubjectType, RecipientType,
NotificationChannel, NotificationStatus, VideoCategory,
HdbSource, HdbSyncStatus, TestimonialStatus, ReferralStatus,
CaseFlagType, CaseFlagStatus, DeletionTargetType,
DeletionRequestStatus, CorrectionRequestStatus, MarketContentStatus
```

### 1.2 Models

Port all 29 models from v1. Key changes per model:

| Model | v1 ID | v2 ID | Money Fields Changed |
|-------|-------|-------|---------------------|
| Agent | `@default(uuid())` | `@id` (cuid2 in app) | — |
| Seller | `@default(uuid())` | `@id` | — |
| Buyer | `@default(uuid())` | `@id` | — |
| Property | `@default(uuid())` | `@id` | `askingPrice Float?` → `Decimal?` |
| Listing | `@default(uuid())` | `@id` | — |
| PortalListing | `@default(uuid())` | `@id` | — |
| VerifiedViewer | `@default(uuid())` | `@id` | — |
| ViewingSlot | `@default(uuid())` | `@id` | — |
| Viewing | `@default(uuid())` | `@id` | — |
| Offer | `@default(uuid())` | `@id` | `offerAmount Decimal`, `counterAmount Decimal?` |
| Transaction | `@default(uuid())` | `@id` | `agreedPrice Decimal`, `optionFee Decimal?` |
| Otp | `@default(uuid())` | `@id` | — |
| CommissionInvoice | `@default(uuid())` | `@id` | `amount`, `gstAmount`, `totalAmount` → `Decimal` |
| EstateAgencyAgreement | `@default(uuid())` | `@id` | `commissionAmount` → `Decimal` |
| FinancialReport | `@default(uuid())` | `@id` | — |
| CddRecord | `@default(uuid())` | `@id` | — |
| ConsentRecord | `@default(uuid())` | `@id` | — |
| AuditLog | already done | ✓ | — |
| Notification | `@default(uuid())` | `@id` | — |
| VideoTutorial | `@default(uuid())` | `@id` | — |
| HdbTransaction | `@default(uuid())` | `@id` | `resalePrice Float` → `Decimal` |
| HdbDataSync | `@default(uuid())` | `@id` | — |
| SystemSetting | already done | ✓ | — |
| Testimonial | `@default(uuid())` | `@id` | — |
| Referral | `@default(uuid())` | `@id` | — |
| CaseFlag | `@default(uuid())` | `@id` | — |
| DataDeletionRequest | `@default(uuid())` | `@id` | — |
| DataCorrectionRequest | `@default(uuid())` | `@id` | — |
| MarketContent | `@default(uuid())` | `@id` | — |

### 1.3 Existing Models (SystemSetting, AuditLog)

These already exist in v2 from Phase 0. Deliberate v2 tightenings vs v1:

- **SystemSetting**: `description` is non-nullable (v1 was `String?`). Intentional — every setting should have a description. No schema changes needed.
- **AuditLog**: `entityId` is non-nullable (v1 was `String?`). Intentional — every audit entry must reference an entity (use `"system"` for system-level actions). `details` is non-nullable `Json` (v1 was `Json?`). Intentional — use `{}` for entries with no details. No schema changes needed.

Both intentionally omit FK relations to Agent (store `agentId`/`updatedByAgentId` as plain strings). V1 had `SystemSetting.updatedByAgent` as a relation — this is intentionally dropped in v2. This avoids migration ordering issues and keeps these cross-cutting models independent.

**Agent-side cleanup**: V1's Agent model had `auditLogs AuditLog[]` and `systemSettings SystemSetting[]` relation arrays. These must be **removed** from the v2 Agent model since the FK relations on AuditLog/SystemSetting are dropped.

### 1.4 Mapping Convention

Every model gets `@@map("snake_case_plural")`. Every camelCase field gets `@map("snake_case")`. Single-word fields that are already valid snake_case (e.g., `block`, `town`, `phone`, `email`, `name`) do NOT need `@map`. Example:

```prisma
model FinancialReport {
  id                String   @id
  sellerId          String   @map("seller_id")
  propertyId        String   @map("property_id")
  reportData        Json     @map("report_data")
  // ...
  @@map("financial_reports")
}
```

### 1.5 Notable Relations

#### Offer Self-Relation (Counter-Offer Chain)
The Offer model has a self-referential relation for tracking counter-offer chains. Port exactly from v1:
```prisma
parentOfferId  String?
parentOffer    Offer?   @relation("OfferChain", fields: [parentOfferId], references: [id])
counterOffers  Offer[]  @relation("OfferChain")
```

#### ConsentRecord Polymorphic Seller Relation
ConsentRecord uses `subjectId` as both a generic identifier AND a Seller FK:
```prisma
seller Seller? @relation(fields: [subjectId], references: [id])
```
This only works when `subjectType` is `seller`. Port as-is from v1.

#### Named Relations
Several models require explicit `@relation()` names to disambiguate multiple relations to the same model:

**Agent has 5 named relations:**
- `Listing @relation("DescriptionApprover")` — listings where agent approved description
- `Listing @relation("PhotosApprover")` — listings where agent approved photos
- `MarketContent @relation("ContentApprover")`
- `DataDeletionRequest @relation("DeletionReviewer")`
- `DataCorrectionRequest @relation("CorrectionProcessor")`

**Seller has 2 named Referral relations:**
- `Referral @relation("Referrer")` — referrals this seller gave
- `Referral @relation("ReferredSeller")` — referral that brought this seller in

#### Transaction HDB Fields
Transaction includes two HDB-specific fields ported from v1:
- `hdbApplicationStatus String?` — tracks HDB application progress
- `hdbAppointmentDate DateTime?` — scheduled HDB appointment

### 1.6 Cancelation Token

`Viewing.cancelToken` in v1 uses `@default(uuid())`. In v2, the schema simply declares it as `String @unique` with no default. The Viewing domain service (built in a later phase) will generate it via cuid2 alongside the ID.

### 1.7 Json Fields

All `Json` fields that had `@default("[]")` in v1 keep the default. `Json` fields without defaults (like `AuditLog.details`) remain required with no default.

### 1.8 floorAreaSqm and resalePrice

- All `floorAreaSqm` fields (`HdbTransaction` and `Property`): Keep as `Float` (not money, it's a measurement)
- `HdbTransaction.resalePrice`: Change to `Decimal @db.Decimal(12,2)` (it's money)

### 1.9 Decimal Defaults

V1 models with `@default()` on Float money fields carry the same defaults to v2 Decimal fields. Prisma supports `@default()` on Decimal fields. Specific defaults:

- `CommissionInvoice.amount` → `Decimal @default(1499) @db.Decimal(12,2)`
- `CommissionInvoice.gstAmount` → `Decimal @default(134.91) @db.Decimal(12,2)`
- `CommissionInvoice.totalAmount` → `Decimal @default(1633.91) @db.Decimal(12,2)`
- `EstateAgencyAgreement.commissionAmount` → `Decimal @default(1499) @db.Decimal(12,2)`

### 1.10 Indexes

All v1 indexes are ported as-is: `Seller(agentId+status, leadSource)`, `ViewingSlot(propertyId+date+status)`, `Viewing(propertyId+scheduledAt)`, `Offer(propertyId+status)`, `Transaction(sellerId+status)`, `DataDeletionRequest(status, targetType+targetId)`, `MarketContent(status, town+flatType)`, `Notification(recipientType+recipientId+status)`, `AuditLog(entityType+entityId, action, createdAt)`, `HdbTransaction(town+flatType+month)`.

All field-level `@unique` constraints are also ported unchanged (e.g., `Agent.email`, `Seller.email`, `Seller.phone`, `Buyer.email`, `Buyer.phone`, `VerifiedViewer.phone`, `Viewing.cancelToken`, `Otp.transactionId`, `CommissionInvoice.transactionId`, `VideoTutorial.slug`, `SystemSetting.key`, `Testimonial.transactionId`, `Referral.referralCode`).

### 1.11 Native Type Annotations

- `ViewingSlot.date` uses `@db.Date` (date-only, no timestamp component). Must preserve this from v1.
- All Decimal money fields use `@db.Decimal(12,2)`.

### 1.12 Models Without updatedAt

The following models do NOT have `updatedAt` in v1. Do not add it in v2:
Viewing, ViewingSlot, FinancialReport, ConsentRecord, Notification, VideoTutorial, HdbTransaction, HdbDataSync, Testimonial, Referral.

All other models (Agent, Seller, Buyer, Property, Listing, PortalListing, VerifiedViewer, Offer, Transaction, Otp, CommissionInvoice, EstateAgencyAgreement, CddRecord, CaseFlag, DataDeletionRequest, DataCorrectionRequest, MarketContent) have `updatedAt DateTime @updatedAt`.

### 1.13 Prisma Decimal Type

`Prisma.Decimal` is `decimal.js`'s `Decimal` type (re-exported by `@prisma/client`). The `decimal.js` package listed in dependencies is for arithmetic operations in service code (e.g., median calculation). No separate `@types` package needed — `decimal.js` ships its own TypeScript types.

---

## 2. Migration Strategy

### 2.1 Single Migration

Create one migration that:
1. Adds all enums
2. Creates all new models
3. Adds indexes

The existing `SystemSetting` and `AuditLog` tables are already created. Prisma will detect them as existing and only add new models.

### 2.2 Migration Command

```bash
npx prisma migrate dev --name phase_1a_full_schema
```

### 2.3 Post-Migration

Run `npx prisma generate` to update the client. Verify all types are available.

---

## 3. HDB Data Ingestion

### 3.1 Domain Module Structure

```
src/domains/hdb/
  types.ts           — HdbTransaction, HdbDataSync types, CSV row interface
  repository.ts      — Prisma queries (upsert batch, find by town/flat, sync log)
  service.ts         — Business logic: seed from CSV, query transactions
  sync.service.ts    — data.gov.sg API sync (fetch, dedupe, insert)
  __tests__/
    service.test.ts
    repository.test.ts
    sync.service.test.ts
```

### 3.2 CSV Seed

Reuse the 5 v1 CSV files from `../sellmyhouse/data/hdb/`. Copy them to `data/hdb/` in v2.

**CSV files** (~972K records total):
- `Resale_Flat_Prices_Based_on_Approval_Date_1990__1999.csv`
- `Resale_Flat_Prices_Based_on_Approval_Date_2000__Feb2012.csv`
- `Resale_Flat_Prices_Based_on_Registration_Date_From_Mar_2012_to_Dec_2014.csv`
- `Resale_Flat_Prices_Based_on_Registration_Date_From_Jan_2015_to_Dec_2016.csv`
- `Resale_flat_prices_based_on_registration_date_from_Jan2017_onwards.csv`

**Three schema variants** (handled in v1, port logic):
1. **1990-2014**: No `remaining_lease` column
2. **2015-2016**: `remaining_lease` as plain number (years only)
3. **2017+**: `remaining_lease` as "XX years YY months" string

**Seed script**: `prisma/seeds/hdb-transactions.ts`
- Stream CSV with `csv-parse` (streaming mode, not loading all into memory)
- Batch insert 5000 records at a time via `prisma.hdbTransaction.createMany()`
- Generate cuid2 IDs for each record
- Set `source: 'csv_seed'`
- Log progress every 50K records

### 3.3 data.gov.sg Sync Service

Port v1's `hdbSync.js` to TypeScript:

```typescript
// src/domains/hdb/sync.service.ts
export class HdbSyncService {
  async sync(): Promise<HdbDataSync> {
    // 1. Fetch from data.gov.sg API
    // 2. Dedupe by filtering: only insert records where month > latest month in DB
    // 3. Insert new records with source: 'datagov_sync'
    // 4. Log sync result to HdbDataSync table
  }
}
```

Register as a cron job (weekly, Sunday 3am SGT) in `src/infra/jobs/runner.ts`. The existing `registerJob` API does not support timezone options — extend the `Job` interface and `startJobs` function to accept an optional `options` object (including `timezone`) so the cron uses `cron.schedule('0 3 * * 0', handler, { timezone: 'Asia/Singapore' })`.

### 3.4 HDB Query Service

```typescript
// src/domains/hdb/service.ts
export class HdbService {
  async getTransactions(filters: {
    town?: string;
    flatType?: string;
    fromMonth?: string;
    toMonth?: string;
    block?: string;
    streetName?: string;
  }): Promise<HdbTransaction[]>

  async getDistinctTowns(): Promise<string[]>
  async getDistinctFlatTypes(): Promise<string[]>
  async getMedianPrice(town: string, flatType: string, months: number): Promise<Decimal | null>
}
```

---

## 4. SystemSetting Seed

Seed default system settings needed by the platform:

| Key | Default Value | Description |
|-----|---------------|-------------|
| `commission_amount` | `1499` | Fixed commission (SGD) |
| `commission_gst_rate` | `0.09` | GST rate |
| `ai_provider` | `anthropic` | Active AI provider |
| `ai_model` | `claude-sonnet-4-20250514` | Active AI model |
| `platform_name` | `SellMyHouse.sg` | Platform display name |
| `agency_name` | `Huttons Asia Pte Ltd` | Agency name for CEA compliance |
| `agency_licence` | `L3008899K` | Agency licence number |
| `support_email` | `support@sellmyhouse.sg` | Support email |
| `support_phone` | `+6591234567` | Support phone (placeholder) |

Seed script: `prisma/seeds/system-settings.ts` (upsert to be idempotent).

**Seed orchestration**: A main `prisma/seed.ts` entry point imports and runs both seed files. Configure in `package.json` under `prisma.seed`: `"ts-node prisma/seed.ts"`. Each seed file exports an async function; the main seed runs them sequentially (system settings first, then HDB data).

---

## 5. Test Factory Extensions

Extend `tests/fixtures/factory.ts` with factories for the new models. Phase 1A focuses on:

- `factory.agent()` — creates Agent with required fields
- `factory.seller()` — creates Seller with agent relation
- `factory.property()` — creates Property with seller relation
- `factory.hdbTransaction()` — creates HdbTransaction record

Other model factories will be added in later phases as their domain modules are built.

---

## 6. Integration Tests

### 6.1 Schema Migration Test

Verify the migration runs cleanly on the test database and all models are queryable.

### 6.2 HDB Seed Test

- Seed a small CSV fixture at `tests/fixtures/hdb-sample.csv` (50 records covering all 3 schema variants)
- Verify correct parsing of each variant
- Verify `resalePrice` stored as Decimal
- Verify deduplication on re-seed

### 6.3 HDB Query Tests

- Filter by town + flat type
- Get median price calculation
- Get distinct towns/flat types

### 6.4 HDB Sync Test

- Mock data.gov.sg API response
- Verify new records inserted
- Verify duplicates skipped
- Verify HdbDataSync log entry created

---

## 7. Out of Scope for Phase 1A

- Agent/Seller/Buyer auth (Phase 1B)
- Notification service (Phase 1B)
- Public website routes (Phase 1C)
- Any domain service beyond HDB and the existing shared services
- No new routes or views — schema and data only

---

## 8. Dependencies

### New npm packages
- `csv-parse` — CSV streaming parser (for HDB seed)
- `decimal.js` — Decimal arithmetic (Prisma returns `Decimal` objects but we may need arithmetic in service layer)

### Existing packages (already installed)
- `@prisma/client` + `prisma` — ORM
- `@paralleldrive/cuid2` — ID generation
- `node-cron` — Job scheduling (for sync cron)

---

## 9. Success Criteria

1. `npx prisma migrate dev` runs cleanly — 27 new models created (29 total including 2 existing Phase 0 models)
2. `npx prisma db seed` ingests all ~972K HDB records from CSV
3. HDB domain module passes unit + integration tests
4. Existing Phase 0 tests still pass (no regressions)
5. All money fields use `Decimal` type end-to-end
