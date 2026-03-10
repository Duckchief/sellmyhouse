# Phase 1A: Full Prisma Schema + HDB Data Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the complete v1 Prisma schema (29 models, 36 enums) to v2 with cuid2 IDs and Decimal money fields, then implement HDB resale transaction data ingestion (CSV seed + data.gov.sg sync).

**Architecture:** Domain-driven with repository pattern. All DB access through repositories, services contain business logic. HDB domain module follows existing `shared/` patterns. Seed orchestration via `prisma/seed.ts` entry point.

**Tech Stack:** Prisma 6 + PostgreSQL, TypeScript, Jest 30, csv-parse (streaming), decimal.js, node-cron, axios

**Spec:** `docs/superpowers/specs/2026-03-10-phase-1a-schema-hdb-design.md`

---

## File Structure

### New Files
```
prisma/schema.prisma                          — Full schema (modify existing)
prisma/seed.ts                                — Seed entry point
prisma/seeds/system-settings.ts               — SystemSetting seed data
prisma/seeds/hdb-transactions.ts              — HDB CSV seed script
data/hdb/*.csv                                — Copy 5 CSV files from v1
src/domains/hdb/types.ts                      — HDB types and interfaces
src/domains/hdb/repository.ts                 — HDB Prisma queries
src/domains/hdb/service.ts                    — HDB business logic
src/domains/hdb/sync.service.ts               — data.gov.sg API sync
src/domains/hdb/__tests__/repository.test.ts  — Repository unit tests
src/domains/hdb/__tests__/service.test.ts     — Service unit tests
src/domains/hdb/__tests__/sync.service.test.ts — Sync service unit tests
tests/fixtures/hdb-sample.csv                 — Test fixture (50 records)
tests/integration/schema.test.ts              — Schema migration test
tests/integration/hdb.test.ts                 — HDB integration tests
```

### Modified Files
```
package.json                — Add csv-parse, decimal.js, prisma.seed config
tests/fixtures/factory.ts   — Add agent, seller, property, hdbTransaction factories
src/infra/jobs/runner.ts    — Add timezone support to registerJob
```

---

## Chunk 1: Prisma Schema + Migration

### Task 1: Write the full Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write all enums**

Add all 36 enums to `prisma/schema.prisma` after the existing `datasource` block and before the existing models. Port exactly from v1 schema:

```prisma
// ─── Enums ──────────────────────────────────────────────────

enum AgentRole {
  admin
  agent
}

enum SellerStatus {
  lead
  engaged
  active
  completed
  archived
}

enum NotificationPreference {
  whatsapp_and_email
  email_only
}

enum LeadSource {
  website
  tiktok
  instagram
  referral
  walkin
  other
}

enum BuyerStatus {
  lead
  active
  completed
  archived
}

enum PropertyStatus {
  draft
  listed
  offer_received
  under_option
  completing
  completed
  withdrawn
}

enum ListingStatus {
  draft
  pending_review
  approved
  live
  paused
  closed
}

enum PortalName {
  propertyguru
  ninety_nine_co
  srx
  other
}

enum PortalListingStatus {
  ready
  posted
  expired
}

enum ViewerType {
  buyer
  agent
}

enum ViewingStatus {
  pending_otp
  scheduled
  completed
  cancelled
  no_show
}

enum SlotType {
  single
  group
}

enum SlotStatus {
  available
  booked
  full
  cancelled
}

enum OfferStatus {
  pending
  countered
  accepted
  rejected
  expired
}

enum TransactionStatus {
  option_issued
  option_exercised
  completing
  completed
  fallen_through
}

enum OtpStatus {
  prepared
  sent_to_seller
  signed_by_seller
  returned
  issued_to_buyer
  exercised
  expired
}

enum InvoiceStatus {
  pending_upload
  uploaded
  sent_to_client
  paid
}

enum AgreementType {
  non_exclusive
  exclusive
}

enum AgreementStatus {
  draft
  sent_to_seller
  signed
  active
  terminated
  expired
}

enum RiskLevel {
  standard
  enhanced
}

enum SubjectType {
  seller
  buyer
  counterparty
}

enum ConsentSubjectType {
  seller
  buyer
}

enum RecipientType {
  seller
  agent
}

enum NotificationChannel {
  whatsapp
  email
  in_app
}

enum NotificationStatus {
  pending
  sent
  delivered
  failed
  read
}

enum VideoCategory {
  photography
  forms
  process
  financial
}

enum HdbSource {
  csv_seed
  datagov_sync
}

enum HdbSyncStatus {
  success
  failed
}

enum TestimonialStatus {
  pending_review
  approved
  rejected
}

enum ReferralStatus {
  link_generated
  clicked
  lead_created
  transaction_completed
}

enum CaseFlagType {
  deceased_estate
  divorce
  mop_not_met
  eip_restriction
  pr_quota
  bank_loan
  court_order
  other
}

enum CaseFlagStatus {
  identified
  in_progress
  resolved
  out_of_scope
}

enum DeletionTargetType {
  lead
  transaction
  cdd_documents
  consent_record
}

enum DeletionRequestStatus {
  flagged
  pending_review
  approved
  executed
  rejected
}

enum CorrectionRequestStatus {
  pending
  in_progress
  completed
  rejected
}

enum MarketContentStatus {
  ai_generated
  pending_review
  approved
  rejected
  published
}
```

- [ ] **Step 2: Write all new models**

Add all 25 new models after the enums and before the existing `SystemSetting` and `AuditLog` models. Each model follows the conventions: `@id` (no default), `@map("snake_case")` on camelCase fields, `@@map("table_name")`, `Decimal @db.Decimal(12,2)` for money fields.

```prisma
// ─── Models ─────────────────────────────────────────────────

model Agent {
  id                        String    @id
  name                      String
  email                     String    @unique
  phone                     String
  ceaRegNo                  String    @map("cea_reg_no")
  passwordHash              String    @map("password_hash")
  role                      AgentRole @default(agent)
  isActive                  Boolean   @default(true) @map("is_active")
  twoFactorSecret           String?   @map("two_factor_secret")
  twoFactorEnabled          Boolean   @default(false) @map("two_factor_enabled")
  twoFactorBackupCodes      Json?     @map("two_factor_backup_codes")
  failedTwoFactorAttempts   Int       @default(0) @map("failed_two_factor_attempts")
  twoFactorLockedUntil      DateTime? @map("two_factor_locked_until")
  createdAt                 DateTime  @default(now()) @map("created_at")
  updatedAt                 DateTime  @updatedAt @map("updated_at")

  sellers                   Seller[]
  buyers                    Buyer[]
  listingsApprovedDesc      Listing[]              @relation("DescriptionApprover")
  listingsApprovedPhoto     Listing[]              @relation("PhotosApprover")
  financialReports          FinancialReport[]
  cddRecords                CddRecord[]
  estateAgencyAgreements    EstateAgencyAgreement[]
  testimonials              Testimonial[]
  marketContentApproved     MarketContent[]        @relation("ContentApprover")
  deletionReviews           DataDeletionRequest[]  @relation("DeletionReviewer")
  correctionProcessed       DataCorrectionRequest[] @relation("CorrectionProcessor")

  @@map("agents")
}

model Seller {
  id                      String                 @id
  name                    String
  email                   String?                @unique
  phone                   String                 @unique
  passwordHash            String?                @map("password_hash")
  agentId                 String?                @map("agent_id")
  agent                   Agent?                 @relation(fields: [agentId], references: [id])
  status                  SellerStatus           @default(lead)
  notificationPreference  NotificationPreference @default(whatsapp_and_email) @map("notification_preference")
  consentService          Boolean                @default(false) @map("consent_service")
  consentMarketing        Boolean                @default(false) @map("consent_marketing")
  consentTimestamp         DateTime?              @map("consent_timestamp")
  consentWithdrawnAt       DateTime?              @map("consent_withdrawn_at")
  leadSource              LeadSource?            @map("lead_source")
  twoFactorSecret         String?                @map("two_factor_secret")
  twoFactorEnabled        Boolean                @default(false) @map("two_factor_enabled")
  twoFactorBackupCodes    Json?                  @map("two_factor_backup_codes")
  failedTwoFactorAttempts Int                    @default(0) @map("failed_two_factor_attempts")
  twoFactorLockedUntil    DateTime?              @map("two_factor_locked_until")
  createdAt               DateTime               @default(now()) @map("created_at")
  updatedAt               DateTime               @updatedAt @map("updated_at")

  properties              Property[]
  transactions            Transaction[]
  financialReports        FinancialReport[]
  consentRecords          ConsentRecord[]
  estateAgencyAgreements  EstateAgencyAgreement[]
  testimonials            Testimonial[]
  referralsGiven          Referral[]             @relation("Referrer")
  referralsReceived       Referral[]             @relation("ReferredSeller")
  caseFlags               CaseFlag[]
  correctionRequests      DataCorrectionRequest[]

  @@index([agentId, status])
  @@index([leadSource])
  @@map("sellers")
}

model Buyer {
  id                 String      @id
  name               String
  email              String?     @unique
  phone              String      @unique
  passwordHash       String?     @map("password_hash")
  agentId            String?     @map("agent_id")
  agent              Agent?      @relation(fields: [agentId], references: [id])
  status             BuyerStatus @default(lead)
  consentService     Boolean     @default(false) @map("consent_service")
  consentMarketing   Boolean     @default(false) @map("consent_marketing")
  consentTimestamp    DateTime?   @map("consent_timestamp")
  consentWithdrawnAt DateTime?   @map("consent_withdrawn_at")
  createdAt          DateTime    @default(now()) @map("created_at")
  updatedAt          DateTime    @updatedAt @map("updated_at")

  transactions Transaction[]

  @@map("buyers")
}

model Property {
  id                String         @id
  sellerId          String         @map("seller_id")
  seller            Seller         @relation(fields: [sellerId], references: [id])
  town              String
  street            String
  block             String
  flatType          String         @map("flat_type")
  storeyRange       String         @map("storey_range")
  floorAreaSqm      Float          @map("floor_area_sqm")
  flatModel         String         @map("flat_model")
  leaseCommenceDate Int            @map("lease_commence_date")
  remainingLease    String?        @map("remaining_lease")
  askingPrice       Decimal?       @map("asking_price") @db.Decimal(12, 2)
  priceHistory      Json?          @default("[]") @map("price_history")
  status            PropertyStatus @default(draft)
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")

  listings         Listing[]
  viewings         Viewing[]
  viewingSlots     ViewingSlot[]
  offers           Offer[]
  transactions     Transaction[]
  financialReports FinancialReport[]

  @@map("properties")
}

model Listing {
  id                          String        @id
  propertyId                  String        @map("property_id")
  property                    Property      @relation(fields: [propertyId], references: [id])
  title                       String?
  description                 String?
  descriptionApprovedByAgentId String?      @map("description_approved_by_agent_id")
  descriptionApprover         Agent?        @relation("DescriptionApprover", fields: [descriptionApprovedByAgentId], references: [id])
  descriptionApprovedAt       DateTime?     @map("description_approved_at")
  photos                      Json?         @default("[]")
  photosApprovedByAgentId     String?       @map("photos_approved_by_agent_id")
  photosApprover              Agent?        @relation("PhotosApprover", fields: [photosApprovedByAgentId], references: [id])
  photosApprovedAt            DateTime?     @map("photos_approved_at")
  status                      ListingStatus @default(draft)
  createdAt                   DateTime      @default(now()) @map("created_at")
  updatedAt                   DateTime      @updatedAt @map("updated_at")

  portalListings PortalListing[]

  @@map("listings")
}

model PortalListing {
  id                 String              @id
  listingId          String              @map("listing_id")
  listing            Listing             @relation(fields: [listingId], references: [id])
  portalName         PortalName          @map("portal_name")
  portalReadyContent Json?               @map("portal_ready_content")
  postedManuallyAt   DateTime?           @map("posted_manually_at")
  portalListingUrl   String?             @map("portal_listing_url")
  status             PortalListingStatus @default(ready)
  createdAt          DateTime            @default(now()) @map("created_at")
  updatedAt          DateTime            @updatedAt @map("updated_at")

  @@map("portal_listings")
}

model VerifiedViewer {
  id              String     @id
  name            String
  phone           String     @unique
  phoneVerifiedAt DateTime?  @map("phone_verified_at")
  viewerType      ViewerType @map("viewer_type")
  agentName       String?    @map("agent_name")
  agentCeaReg     String?    @map("agent_cea_reg")
  agentAgencyName String?    @map("agent_agency_name")
  consentService  Boolean    @default(false) @map("consent_service")
  totalBookings   Int        @default(0) @map("total_bookings")
  lastBookingAt   DateTime?  @map("last_booking_at")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  viewings Viewing[]

  @@map("verified_viewers")
}

model ViewingSlot {
  id              String     @id
  propertyId      String     @map("property_id")
  property        Property   @relation(fields: [propertyId], references: [id])
  date            DateTime   @db.Date
  startTime       String     @map("start_time")
  endTime         String     @map("end_time")
  durationMinutes Int        @default(15) @map("duration_minutes")
  slotType        SlotType   @default(single) @map("slot_type")
  maxViewers      Int        @default(1) @map("max_viewers")
  currentBookings Int        @default(0) @map("current_bookings")
  status          SlotStatus @default(available)
  createdAt       DateTime   @default(now()) @map("created_at")

  viewings Viewing[]

  @@index([propertyId, date, status])
  @@map("viewing_slots")
}

model Viewing {
  id               String         @id
  propertyId       String         @map("property_id")
  property         Property       @relation(fields: [propertyId], references: [id])
  viewingSlotId    String         @map("viewing_slot_id")
  viewingSlot      ViewingSlot    @relation(fields: [viewingSlotId], references: [id])
  verifiedViewerId String         @map("verified_viewer_id")
  verifiedViewer   VerifiedViewer @relation(fields: [verifiedViewerId], references: [id])
  cancelToken      String         @unique @map("cancel_token")
  status           ViewingStatus  @default(pending_otp)
  scheduledAt      DateTime       @map("scheduled_at")
  completedAt      DateTime?      @map("completed_at")
  feedback         String?
  createdAt        DateTime       @default(now()) @map("created_at")

  @@index([propertyId, scheduledAt])
  @@map("viewings")
}

model Offer {
  id               String      @id
  propertyId       String      @map("property_id")
  property         Property    @relation(fields: [propertyId], references: [id])
  buyerName        String      @map("buyer_name")
  buyerPhone       String      @map("buyer_phone")
  buyerAgentName   String?     @map("buyer_agent_name")
  buyerAgentCeaReg String?     @map("buyer_agent_cea_reg")
  isCoBroke        Boolean     @default(false) @map("is_co_broke")
  offerAmount      Decimal     @map("offer_amount") @db.Decimal(12, 2)
  status           OfferStatus @default(pending)
  notes            String?
  parentOfferId    String?     @map("parent_offer_id")
  parentOffer      Offer?      @relation("OfferChain", fields: [parentOfferId], references: [id])
  counterOffers    Offer[]     @relation("OfferChain")
  counterAmount    Decimal?    @map("counter_amount") @db.Decimal(12, 2)
  createdAt        DateTime    @default(now()) @map("created_at")
  updatedAt        DateTime    @updatedAt @map("updated_at")

  @@index([propertyId, status])
  @@map("offers")
}

model Transaction {
  id                   String            @id
  propertyId           String            @map("property_id")
  property             Property          @relation(fields: [propertyId], references: [id])
  sellerId             String            @map("seller_id")
  seller               Seller            @relation(fields: [sellerId], references: [id])
  buyerId              String?           @map("buyer_id")
  buyer                Buyer?            @relation(fields: [buyerId], references: [id])
  agreedPrice          Decimal           @map("agreed_price") @db.Decimal(12, 2)
  optionFee            Decimal?          @map("option_fee") @db.Decimal(12, 2)
  optionDate           DateTime?         @map("option_date")
  exerciseDeadline     DateTime?         @map("exercise_deadline")
  exerciseDate         DateTime?         @map("exercise_date")
  completionDate       DateTime?         @map("completion_date")
  status               TransactionStatus @default(option_issued)
  hdbApplicationStatus String?           @map("hdb_application_status")
  hdbAppointmentDate   DateTime?         @map("hdb_appointment_date")
  createdAt            DateTime          @default(now()) @map("created_at")
  updatedAt            DateTime          @updatedAt @map("updated_at")

  otp               Otp?
  commissionInvoice CommissionInvoice?
  testimonial       Testimonial?

  @@index([sellerId, status])
  @@map("transactions")
}

model Otp {
  id                    String    @id
  transactionId         String    @unique @map("transaction_id")
  transaction           Transaction @relation(fields: [transactionId], references: [id])
  hdbSerialNumber       String    @map("hdb_serial_number")
  status                OtpStatus @default(prepared)
  scannedCopyPath       String?   @map("scanned_copy_path")
  scannedCopyDeletedAt  DateTime? @map("scanned_copy_deleted_at")
  agentReviewedAt       DateTime? @map("agent_reviewed_at")
  agentReviewNotes      String?   @map("agent_review_notes")
  preparedAt            DateTime  @default(now()) @map("prepared_at")
  issuedAt              DateTime? @map("issued_at")
  exercisedAt           DateTime? @map("exercised_at")
  expiredAt             DateTime? @map("expired_at")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@map("otps")
}

model CommissionInvoice {
  id                String        @id
  transactionId     String        @unique @map("transaction_id")
  transaction       Transaction   @relation(fields: [transactionId], references: [id])
  invoiceFilePath   String?       @map("invoice_file_path")
  invoiceDeletedAt  DateTime?     @map("invoice_deleted_at")
  invoiceNumber     String?       @map("invoice_number")
  amount            Decimal       @default(1499) @db.Decimal(12, 2)
  gstAmount         Decimal       @default(134.91) @map("gst_amount") @db.Decimal(12, 2)
  totalAmount       Decimal       @default(1633.91) @map("total_amount") @db.Decimal(12, 2)
  status            InvoiceStatus @default(pending_upload)
  uploadedAt        DateTime?     @map("uploaded_at")
  sentAt            DateTime?     @map("sent_at")
  sentVia           String?       @map("sent_via")
  paidAt            DateTime?     @map("paid_at")
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")

  @@map("commission_invoices")
}

model EstateAgencyAgreement {
  id                     String          @id
  sellerId               String          @map("seller_id")
  seller                 Seller          @relation(fields: [sellerId], references: [id])
  agentId                String          @map("agent_id")
  agent                  Agent           @relation(fields: [agentId], references: [id])
  agreementType          AgreementType   @default(non_exclusive) @map("agreement_type")
  formType               String          @default("CEA Form 1") @map("form_type")
  commissionAmount       Decimal         @default(1499) @map("commission_amount") @db.Decimal(12, 2)
  commissionGstInclusive Boolean         @default(false) @map("commission_gst_inclusive")
  coBrokingAllowed       Boolean         @default(true) @map("co_broking_allowed")
  coBrokingTerms         String          @default("Co-broking welcomed. Commission is not shared. Buyer's agent is paid by their own client.") @map("co_broking_terms")
  signedAt               DateTime?       @map("signed_at")
  signedCopyPath         String?         @map("signed_copy_path")
  signedCopyDeletedAt    DateTime?       @map("signed_copy_deleted_at")
  videoCallConfirmedAt   DateTime?       @map("video_call_confirmed_at")
  videoCallNotes         String?         @map("video_call_notes")
  expiryDate             DateTime?       @map("expiry_date")
  status                 AgreementStatus @default(draft)
  createdAt              DateTime        @default(now()) @map("created_at")
  updatedAt              DateTime        @updatedAt @map("updated_at")

  @@map("estate_agency_agreements")
}

model FinancialReport {
  id                String   @id
  sellerId          String   @map("seller_id")
  seller            Seller   @relation(fields: [sellerId], references: [id])
  propertyId        String   @map("property_id")
  property          Property @relation(fields: [propertyId], references: [id])
  reportData        Json     @map("report_data")
  aiNarrative       String?  @map("ai_narrative")
  aiProvider        String?  @map("ai_provider")
  aiModel           String?  @map("ai_model")
  generatedAt       DateTime @default(now()) @map("generated_at")
  reviewedByAgentId String?  @map("reviewed_by_agent_id")
  reviewedByAgent   Agent?   @relation(fields: [reviewedByAgentId], references: [id])
  reviewedAt        DateTime? @map("reviewed_at")
  reviewNotes       String?  @map("review_notes")
  approvedAt        DateTime? @map("approved_at")
  sentToSellerAt    DateTime? @map("sent_to_seller_at")
  sentVia           String?  @map("sent_via")
  version           Int      @default(1)
  createdAt         DateTime @default(now()) @map("created_at")

  @@map("financial_reports")
}

model CddRecord {
  id                String      @id
  subjectType       SubjectType @map("subject_type")
  subjectId         String      @map("subject_id")
  fullName          String      @map("full_name")
  nricLast4         String      @map("nric_last4")
  dateOfBirth       DateTime?   @map("date_of_birth")
  nationality       String?
  occupation        String?
  riskLevel         RiskLevel   @default(standard) @map("risk_level")
  identityVerified  Boolean     @default(false) @map("identity_verified")
  verifiedByAgentId String      @map("verified_by_agent_id")
  verifiedByAgent   Agent       @relation(fields: [verifiedByAgentId], references: [id])
  verifiedAt        DateTime?   @map("verified_at")
  documents         Json?       @default("[]")
  notes             String?
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")

  @@map("cdd_records")
}

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
  seller             Seller?            @relation(fields: [subjectId], references: [id])
  createdAt          DateTime           @default(now()) @map("created_at")

  @@map("consent_records")
}

model Notification {
  id                String              @id
  recipientType     RecipientType       @map("recipient_type")
  recipientId       String              @map("recipient_id")
  channel           NotificationChannel
  templateName      String              @map("template_name")
  content           String
  status            NotificationStatus  @default(pending)
  sentAt            DateTime?           @map("sent_at")
  deliveredAt       DateTime?           @map("delivered_at")
  readAt            DateTime?           @map("read_at")
  whatsappMessageId String?             @map("whatsapp_message_id")
  error             String?
  createdAt         DateTime            @default(now()) @map("created_at")

  @@index([recipientType, recipientId, status])
  @@map("notifications")
}

model VideoTutorial {
  id          String        @id
  title       String
  slug        String        @unique
  description String?
  youtubeUrl  String        @map("youtube_url")
  category    VideoCategory
  orderIndex  Int           @default(0) @map("order_index")
  createdAt   DateTime      @default(now()) @map("created_at")

  @@map("video_tutorials")
}

model HdbTransaction {
  id                String    @id
  month             String
  town              String
  flatType          String    @map("flat_type")
  block             String
  streetName        String    @map("street_name")
  storeyRange       String    @map("storey_range")
  floorAreaSqm      Float     @map("floor_area_sqm")
  flatModel         String    @map("flat_model")
  leaseCommenceDate Int       @map("lease_commence_date")
  remainingLease    String?   @map("remaining_lease")
  resalePrice       Decimal   @map("resale_price") @db.Decimal(12, 2)
  source            HdbSource @default(csv_seed)
  createdAt         DateTime  @default(now()) @map("created_at")

  @@index([town, flatType, month])
  @@map("hdb_transactions")
}

model HdbDataSync {
  id           String        @id
  syncedAt     DateTime      @default(now()) @map("synced_at")
  recordsAdded Int           @map("records_added")
  recordsTotal Int           @map("records_total")
  source       String
  status       HdbSyncStatus
  error        String?
  createdAt    DateTime      @default(now()) @map("created_at")

  @@map("hdb_data_syncs")
}

model Testimonial {
  id                String            @id
  sellerId          String            @map("seller_id")
  seller            Seller            @relation(fields: [sellerId], references: [id])
  transactionId     String            @unique @map("transaction_id")
  transaction       Transaction       @relation(fields: [transactionId], references: [id])
  content           String
  rating            Int
  sellerName        String            @map("seller_name")
  sellerTown        String            @map("seller_town")
  status            TestimonialStatus @default(pending_review)
  approvedByAgentId String?           @map("approved_by_agent_id")
  approvedByAgent   Agent?            @relation(fields: [approvedByAgentId], references: [id])
  approvedAt        DateTime?         @map("approved_at")
  displayOnWebsite  Boolean           @default(false) @map("display_on_website")
  createdAt         DateTime          @default(now()) @map("created_at")

  @@map("testimonials")
}

model Referral {
  id               String         @id
  referrerSellerId String         @map("referrer_seller_id")
  referrer         Seller         @relation("Referrer", fields: [referrerSellerId], references: [id])
  referralCode     String         @unique @map("referral_code")
  referredName     String?        @map("referred_name")
  referredPhone    String?        @map("referred_phone")
  referredSellerId String?        @map("referred_seller_id")
  referredSeller   Seller?        @relation("ReferredSeller", fields: [referredSellerId], references: [id])
  status           ReferralStatus @default(link_generated)
  clickCount       Int            @default(0) @map("click_count")
  createdAt        DateTime       @default(now()) @map("created_at")
  convertedAt      DateTime?      @map("converted_at")

  @@map("referrals")
}

model CaseFlag {
  id               String         @id
  sellerId         String         @map("seller_id")
  seller           Seller         @relation(fields: [sellerId], references: [id])
  flagType         CaseFlagType   @map("flag_type")
  description      String
  status           CaseFlagStatus @default(identified)
  guidanceProvided String?        @map("guidance_provided")
  resolvedAt       DateTime?      @map("resolved_at")
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt @map("updated_at")

  @@map("case_flags")
}

model DataDeletionRequest {
  id                String                @id
  targetType        DeletionTargetType    @map("target_type")
  targetId          String                @map("target_id")
  reason            String?
  retentionRule     String?               @map("retention_rule")
  flaggedAt         DateTime              @default(now()) @map("flagged_at")
  reviewedByAgentId String?               @map("reviewed_by_agent_id")
  reviewedByAgent   Agent?                @relation("DeletionReviewer", fields: [reviewedByAgentId], references: [id])
  reviewedAt        DateTime?             @map("reviewed_at")
  reviewNotes       String?               @map("review_notes")
  executedAt        DateTime?             @map("executed_at")
  status            DeletionRequestStatus @default(flagged)
  details           Json?
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  @@index([status])
  @@index([targetType, targetId])
  @@map("data_deletion_requests")
}

model DataCorrectionRequest {
  id                 String                  @id
  sellerId           String                  @map("seller_id")
  seller             Seller                  @relation(fields: [sellerId], references: [id])
  fieldName          String                  @map("field_name")
  currentValue       String?                 @map("current_value")
  requestedValue     String                  @map("requested_value")
  reason             String?
  status             CorrectionRequestStatus @default(pending)
  processedByAgentId String?                 @map("processed_by_agent_id")
  processedByAgent   Agent?                  @relation("CorrectionProcessor", fields: [processedByAgentId], references: [id])
  processedAt        DateTime?               @map("processed_at")
  processNotes       String?                 @map("process_notes")
  createdAt          DateTime                @default(now()) @map("created_at")
  updatedAt          DateTime                @updatedAt @map("updated_at")

  @@map("data_correction_requests")
}

model MarketContent {
  id                String              @id
  town              String
  flatType          String              @map("flat_type")
  period            String
  rawData           Json                @map("raw_data")
  aiNarrative       String?             @map("ai_narrative")
  aiProvider        String?             @map("ai_provider")
  aiModel           String?             @map("ai_model")
  status            MarketContentStatus @default(ai_generated)
  tiktokFormat      String?             @map("tiktok_format")
  instagramFormat   String?             @map("instagram_format")
  linkedinFormat    String?             @map("linkedin_format")
  approvedByAgentId String?             @map("approved_by_agent_id")
  approvedByAgent   Agent?              @relation("ContentApprover", fields: [approvedByAgentId], references: [id])
  approvedAt        DateTime?           @map("approved_at")
  publishedAt       DateTime?           @map("published_at")
  createdAt         DateTime            @default(now()) @map("created_at")
  updatedAt         DateTime            @updatedAt @map("updated_at")

  @@index([status])
  @@index([town, flatType])
  @@map("market_contents")
}
```

- [ ] **Step 3: Verify schema is valid**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx prisma validate`
Expected: "Your Prisma schema is valid."

- [ ] **Step 4: Commit schema**

```bash
git add prisma/schema.prisma
git commit -m "feat: add full Prisma schema with all 36 enums and 27 models"
```

### Task 2: Run migration and generate client

**Files:**
- Generated: `prisma/migrations/<timestamp>_phase_1a_full_schema/migration.sql`

- [ ] **Step 1: Run the migration**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx prisma migrate dev --name phase_1a_full_schema`
Expected: Migration creates all new tables and enums. Existing `system_settings` and `audit_logs` tables are untouched.

- [ ] **Step 2: Verify migration on test database**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && DATABASE_URL="postgresql://smhn:smhn_dev@localhost:5432/sellmyhomenow_test" npx prisma migrate deploy`
Expected: Migration applies cleanly to test DB.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test && npm run test:integration`
Expected: All 22 unit tests + 3 integration tests pass.

- [ ] **Step 4: Commit migration**

```bash
git add prisma/migrations/
git commit -m "feat: add phase 1a migration - all tables and enums"
```

---

## Chunk 2: Dependencies, Seed Infrastructure, Test Factories

### Task 3: Install dependencies and configure seed

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install new dependencies**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm install csv-parse decimal.js`
Expected: Both packages added to dependencies in `package.json`.

- [ ] **Step 2: Add prisma seed config to package.json**

Add to `package.json` at the top level (not inside `scripts`):

```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add csv-parse, decimal.js deps and prisma seed config"
```

### Task 4: Create seed files

**Files:**
- Create: `prisma/seed.ts`
- Create: `prisma/seeds/system-settings.ts`

- [ ] **Step 1: Create the system settings seed**

```typescript
// prisma/seeds/system-settings.ts
import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const SETTINGS = [
  { key: 'commission_amount', value: '1499', description: 'Fixed commission amount in SGD' },
  { key: 'commission_gst_rate', value: '0.09', description: 'GST rate applied to commission' },
  { key: 'ai_provider', value: 'anthropic', description: 'Active AI provider (anthropic, openai, google)' },
  { key: 'ai_model', value: 'claude-sonnet-4-20250514', description: 'Active AI model identifier' },
  { key: 'platform_name', value: 'SellMyHomeNow.sg', description: 'Platform display name' },
  { key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'Agency name for CEA compliance' },
  { key: 'agency_licence', value: 'L3008899K', description: 'CEA agency licence number' },
  { key: 'support_email', value: 'support@sellmyhomenow.sg', description: 'Platform support email' },
  { key: 'support_phone', value: '+6591234567', description: 'Platform support phone (placeholder)' },
];

export async function seedSystemSettings(prisma: PrismaClient): Promise<void> {
  console.log('Seeding system settings...');

  for (const setting of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: { id: createId(), ...setting },
    });
  }

  console.log(`System settings seeded: ${SETTINGS.length} entries`);
}
```

- [ ] **Step 2: Create the seed entry point**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { seedSystemSettings } from './seeds/system-settings';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');
  await seedSystemSettings(prisma);
  // HDB transaction seed will be added in Task 10
  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Test the seed runs**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx prisma db seed`
Expected: "Seeding system settings..." then "System settings seeded: 9 entries" then "Seed completed."

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts prisma/seeds/system-settings.ts
git commit -m "feat: add system settings seed with 9 default entries"
```

### Task 5: Extend test factories

**Files:**
- Modify: `tests/fixtures/factory.ts`

- [ ] **Step 1: Add agent, seller, property, hdbTransaction factories**

Replace the full content of `tests/fixtures/factory.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { testPrisma } from '../helpers/prisma';
import { createId } from '@paralleldrive/cuid2';

export const factory = {
  async systemSetting(overrides: {
    key: string;
    value: string;
    description?: string;
  }) {
    return testPrisma.systemSetting.create({
      data: {
        id: createId(),
        key: overrides.key,
        value: overrides.value,
        description: overrides.description || `Setting: ${overrides.key}`,
      },
    });
  },

  async auditLog(overrides: {
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    agentId?: string;
  }) {
    return testPrisma.auditLog.create({
      data: {
        id: createId(),
        action: overrides.action,
        entityType: overrides.entityType,
        entityId: overrides.entityId,
        details: (overrides.details || {}) as Prisma.InputJsonValue,
        agentId: overrides.agentId,
      },
    });
  },

  async agent(overrides?: {
    name?: string;
    email?: string;
    phone?: string;
    ceaRegNo?: string;
    passwordHash?: string;
    role?: 'admin' | 'agent';
    isActive?: boolean;
  }) {
    const id = createId();
    return testPrisma.agent.create({
      data: {
        id,
        name: overrides?.name ?? 'Test Agent',
        email: overrides?.email ?? `agent-${id}@test.local`,
        phone: overrides?.phone ?? `9${id.slice(0, 7)}`,
        ceaRegNo: overrides?.ceaRegNo ?? `R${id.slice(0, 6)}A`,
        passwordHash: overrides?.passwordHash ?? '$2b$12$placeholder.hash.for.testing.only',
        role: overrides?.role ?? 'agent',
        isActive: overrides?.isActive ?? true,
      },
    });
  },

  async seller(overrides?: {
    name?: string;
    email?: string;
    phone?: string;
    agentId?: string;
    status?: 'lead' | 'engaged' | 'active' | 'completed' | 'archived';
    consentService?: boolean;
    consentMarketing?: boolean;
    leadSource?: 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';
  }) {
    const id = createId();
    return testPrisma.seller.create({
      data: {
        id,
        name: overrides?.name ?? 'Test Seller',
        email: overrides?.email ?? `seller-${id}@test.local`,
        phone: overrides?.phone ?? `8${id.slice(0, 7)}`,
        agentId: overrides?.agentId,
        status: overrides?.status ?? 'lead',
        consentService: overrides?.consentService ?? true,
        consentMarketing: overrides?.consentMarketing ?? false,
        leadSource: overrides?.leadSource ?? 'website',
      },
    });
  },

  async property(overrides: {
    sellerId: string;
    town?: string;
    street?: string;
    block?: string;
    flatType?: string;
    storeyRange?: string;
    floorAreaSqm?: number;
    flatModel?: string;
    leaseCommenceDate?: number;
    askingPrice?: number;
    status?: 'draft' | 'listed' | 'offer_received' | 'under_option' | 'completing' | 'completed' | 'withdrawn';
  }) {
    return testPrisma.property.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        town: overrides.town ?? 'TAMPINES',
        street: overrides.street ?? 'TAMPINES ST 21',
        block: overrides.block ?? '123',
        flatType: overrides.flatType ?? '4 ROOM',
        storeyRange: overrides.storeyRange ?? '07 TO 09',
        floorAreaSqm: overrides.floorAreaSqm ?? 93,
        flatModel: overrides.flatModel ?? 'Model A',
        leaseCommenceDate: overrides.leaseCommenceDate ?? 1995,
        askingPrice: overrides.askingPrice,
        status: overrides.status ?? 'draft',
      },
    });
  },

  async hdbTransaction(overrides?: {
    month?: string;
    town?: string;
    flatType?: string;
    block?: string;
    streetName?: string;
    storeyRange?: string;
    floorAreaSqm?: number;
    flatModel?: string;
    leaseCommenceDate?: number;
    remainingLease?: string;
    resalePrice?: number;
    source?: 'csv_seed' | 'datagov_sync';
  }) {
    return testPrisma.hdbTransaction.create({
      data: {
        id: createId(),
        month: overrides?.month ?? '2024-01',
        town: overrides?.town ?? 'TAMPINES',
        flatType: overrides?.flatType ?? '4 ROOM',
        block: overrides?.block ?? '456',
        streetName: overrides?.streetName ?? 'TAMPINES ST 21',
        storeyRange: overrides?.storeyRange ?? '07 TO 09',
        floorAreaSqm: overrides?.floorAreaSqm ?? 93,
        flatModel: overrides?.flatModel ?? 'Model A',
        leaseCommenceDate: overrides?.leaseCommenceDate ?? 1995,
        remainingLease: overrides?.remainingLease ?? '68 years 03 months',
        resalePrice: overrides?.resalePrice ?? 500000,
        source: overrides?.source ?? 'csv_seed',
      },
    });
  },
};
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm run test:integration`
Expected: All integration tests pass. New factories don't break existing ones.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/factory.ts
git commit -m "feat: add agent, seller, property, hdbTransaction test factories"
```

---

## Chunk 3: HDB Domain Module — Types + Repository

### Task 6: Create HDB types

**Files:**
- Create: `src/domains/hdb/types.ts`

- [ ] **Step 1: Write HDB types**

```typescript
// src/domains/hdb/types.ts
import { Decimal } from '@prisma/client/runtime/library';

export interface HdbTransactionRecord {
  id: string;
  month: string;
  town: string;
  flatType: string;
  block: string;
  streetName: string;
  storeyRange: string;
  floorAreaSqm: number;
  flatModel: string;
  leaseCommenceDate: number;
  remainingLease: string | null;
  resalePrice: Decimal;
  source: 'csv_seed' | 'datagov_sync';
  createdAt: Date;
}

export interface HdbDataSyncRecord {
  id: string;
  syncedAt: Date;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: 'success' | 'failed';
  error: string | null;
  createdAt: Date;
}

export interface HdbTransactionFilters {
  town?: string;
  flatType?: string;
  fromMonth?: string;
  toMonth?: string;
  block?: string;
  streetName?: string;
  storeyRange?: string;
}

export interface HdbMarketReport {
  town: string;
  flatType: string;
  storeyRange: string;
  months: number;
  count: number;
  min: Decimal;
  max: Decimal;
  median: Decimal;
  avgPricePerSqm: number;
  recentTransactions: HdbTransactionRecord[];
}

export interface CsvRow {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease?: string;
  resale_price: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/hdb/types.ts
git commit -m "feat: add HDB domain types"
```

### Task 7: Create HDB repository with tests

**Files:**
- Create: `src/domains/hdb/repository.ts`
- Create: `src/domains/hdb/__tests__/repository.test.ts`

- [ ] **Step 1: Write the repository test**

```typescript
// src/domains/hdb/__tests__/repository.test.ts
import { HdbRepository } from '../repository';

// Mock prisma
const mockPrisma = {
  hdbTransaction: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
  },
  hdbDataSync: {
    create: jest.fn(),
  },
};

jest.mock('@/infra/database/prisma', () => ({
  prisma: mockPrisma,
  createId: jest.fn(() => 'mock-id'),
}));

describe('HdbRepository', () => {
  const repo = new HdbRepository();

  beforeEach(() => jest.clearAllMocks());

  describe('createManyTransactions', () => {
    it('calls createMany with skipDuplicates', async () => {
      const data = [
        {
          id: 'id1',
          month: '2024-01',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '123',
          streetName: 'TAMPINES ST 21',
          storeyRange: '07 TO 09',
          floorAreaSqm: 93,
          flatModel: 'Model A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: 500000,
          source: 'csv_seed' as const,
        },
      ];
      mockPrisma.hdbTransaction.createMany.mockResolvedValue({ count: 1 });

      const result = await repo.createManyTransactions(data);

      expect(result).toBe(1);
      expect(mockPrisma.hdbTransaction.createMany).toHaveBeenCalledWith({
        data,
        skipDuplicates: true,
      });
    });
  });

  describe('findTransactions', () => {
    it('builds where clause from filters', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.findTransactions({ town: 'TAMPINES', flatType: '4 ROOM' });

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            town: 'TAMPINES',
            flatType: '4 ROOM',
          }),
        }),
      );
    });

    it('applies month range filter', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.findTransactions({ fromMonth: '2023-01', toMonth: '2024-06' });

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            month: { gte: '2023-01', lte: '2024-06' },
          }),
        }),
      );
    });
  });

  describe('getDistinctTowns', () => {
    it('returns unique town names sorted', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { town: 'ANG MO KIO' },
        { town: 'TAMPINES' },
      ]);

      const result = await repo.getDistinctTowns();

      expect(result).toEqual(['ANG MO KIO', 'TAMPINES']);
    });
  });

  describe('getDistinctFlatTypes', () => {
    it('returns unique flat types sorted', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { flatType: '3 ROOM' },
        { flatType: '4 ROOM' },
      ]);

      const result = await repo.getDistinctFlatTypes();

      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });
  });

  describe('countTransactions', () => {
    it('returns total count', async () => {
      mockPrisma.hdbTransaction.count.mockResolvedValue(972000);

      const result = await repo.countTransactions();

      expect(result).toBe(972000);
    });
  });

  describe('getLatestMonth', () => {
    it('returns latest month string', async () => {
      mockPrisma.hdbTransaction.findFirst.mockResolvedValue({ month: '2024-12' });

      const result = await repo.getLatestMonth();

      expect(result).toBe('2024-12');
    });

    it('returns null when no records exist', async () => {
      mockPrisma.hdbTransaction.findFirst.mockResolvedValue(null);

      const result = await repo.getLatestMonth();

      expect(result).toBeNull();
    });
  });

  describe('createSyncLog', () => {
    it('creates a sync log entry', async () => {
      const syncData = {
        id: 'sync-1',
        recordsAdded: 100,
        recordsTotal: 1000,
        source: 'test-dataset',
        status: 'success' as const,
      };
      mockPrisma.hdbDataSync.create.mockResolvedValue(syncData);

      const result = await repo.createSyncLog(syncData);

      expect(result).toEqual(syncData);
      expect(mockPrisma.hdbDataSync.create).toHaveBeenCalledWith({
        data: syncData,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/repository.test.ts`
Expected: FAIL — "Cannot find module '../repository'"

- [ ] **Step 3: Write the repository**

```typescript
// src/domains/hdb/repository.ts
import { prisma } from '@/infra/database/prisma';
import type { HdbTransactionFilters } from './types';

interface CreateTransactionData {
  id: string;
  month: string;
  town: string;
  flatType: string;
  block: string;
  streetName: string;
  storeyRange: string;
  floorAreaSqm: number;
  flatModel: string;
  leaseCommenceDate: number;
  remainingLease: string | null;
  resalePrice: number;
  source: 'csv_seed' | 'datagov_sync';
}

interface CreateSyncLogData {
  id: string;
  recordsAdded: number;
  recordsTotal: number;
  source: string;
  status: 'success' | 'failed';
  error?: string;
}

export class HdbRepository {
  async createManyTransactions(data: CreateTransactionData[]): Promise<number> {
    const result = await prisma.hdbTransaction.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async findTransactions(filters: HdbTransactionFilters) {
    const where: Record<string, unknown> = {};

    if (filters.town) where.town = filters.town;
    if (filters.flatType) where.flatType = filters.flatType;
    if (filters.block) where.block = filters.block;
    if (filters.streetName) where.streetName = filters.streetName;
    if (filters.storeyRange) where.storeyRange = filters.storeyRange;

    if (filters.fromMonth || filters.toMonth) {
      const monthFilter: Record<string, string> = {};
      if (filters.fromMonth) monthFilter.gte = filters.fromMonth;
      if (filters.toMonth) monthFilter.lte = filters.toMonth;
      where.month = monthFilter;
    }

    return prisma.hdbTransaction.findMany({
      where,
      orderBy: { resalePrice: 'asc' },
    });
  }

  async getDistinctTowns(): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['town'],
      select: { town: true },
      orderBy: { town: 'asc' },
    });
    return results.map((r) => r.town);
  }

  async getDistinctFlatTypes(): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['flatType'],
      select: { flatType: true },
      orderBy: { flatType: 'asc' },
    });
    return results.map((r) => r.flatType);
  }

  async countTransactions(): Promise<number> {
    return prisma.hdbTransaction.count();
  }

  async getLatestMonth(): Promise<string | null> {
    const result = await prisma.hdbTransaction.findFirst({
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    return result?.month ?? null;
  }

  async createSyncLog(data: CreateSyncLogData) {
    return prisma.hdbDataSync.create({ data });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/repository.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/types.ts src/domains/hdb/repository.ts src/domains/hdb/__tests__/repository.test.ts
git commit -m "feat: add HDB repository with unit tests"
```

---

## Chunk 4: HDB Service + Sync Service

### Task 8: Create HDB service with tests

**Files:**
- Create: `src/domains/hdb/service.ts`
- Create: `src/domains/hdb/__tests__/service.test.ts`

- [ ] **Step 1: Write the service test**

```typescript
// src/domains/hdb/__tests__/service.test.ts
import { Decimal } from '@prisma/client/runtime/library';
import { HdbService } from '../service';
import { HdbRepository } from '../repository';

jest.mock('../repository');

const mockRepo = new HdbRepository() as jest.Mocked<HdbRepository>;

describe('HdbService', () => {
  const service = new HdbService(mockRepo);

  beforeEach(() => jest.clearAllMocks());

  describe('getTransactions', () => {
    it('delegates to repository with filters', async () => {
      const mockData = [
        {
          id: '1',
          month: '2024-01',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '123',
          streetName: 'TAMPINES ST 21',
          storeyRange: '07 TO 09',
          floorAreaSqm: 93,
          flatModel: 'Model A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(500000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
      ];
      mockRepo.findTransactions.mockResolvedValue(mockData);

      const result = await service.getTransactions({ town: 'TAMPINES' });

      expect(result).toEqual(mockData);
      expect(mockRepo.findTransactions).toHaveBeenCalledWith({ town: 'TAMPINES' });
    });
  });

  describe('getDistinctTowns', () => {
    it('returns list of towns', async () => {
      mockRepo.getDistinctTowns.mockResolvedValue(['ANG MO KIO', 'TAMPINES']);

      const result = await service.getDistinctTowns();

      expect(result).toEqual(['ANG MO KIO', 'TAMPINES']);
    });
  });

  describe('getDistinctFlatTypes', () => {
    it('returns list of flat types', async () => {
      mockRepo.getDistinctFlatTypes.mockResolvedValue(['3 ROOM', '4 ROOM']);

      const result = await service.getDistinctFlatTypes();

      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });
  });

  describe('getMarketReport', () => {
    it('calculates statistics from transactions', async () => {
      const transactions = [
        { id: '1', month: '2024-01', town: 'TAMPINES', flatType: '4 ROOM', block: '1', streetName: 'ST', storeyRange: '01 TO 03', floorAreaSqm: 90, flatModel: 'A', leaseCommenceDate: 1995, remainingLease: null, resalePrice: new Decimal(400000), source: 'csv_seed' as const, createdAt: new Date() },
        { id: '2', month: '2024-01', town: 'TAMPINES', flatType: '4 ROOM', block: '2', streetName: 'ST', storeyRange: '04 TO 06', floorAreaSqm: 95, flatModel: 'A', leaseCommenceDate: 1995, remainingLease: null, resalePrice: new Decimal(500000), source: 'csv_seed' as const, createdAt: new Date() },
        { id: '3', month: '2024-02', town: 'TAMPINES', flatType: '4 ROOM', block: '3', streetName: 'ST', storeyRange: '07 TO 09', floorAreaSqm: 100, flatModel: 'A', leaseCommenceDate: 1995, remainingLease: null, resalePrice: new Decimal(600000), source: 'csv_seed' as const, createdAt: new Date() },
      ];
      mockRepo.findTransactions.mockResolvedValue(transactions);

      const report = await service.getMarketReport({
        town: 'TAMPINES',
        flatType: '4 ROOM',
        months: 24,
      });

      expect(report).not.toBeNull();
      expect(report!.count).toBe(3);
      expect(report!.min).toEqual(new Decimal(400000));
      expect(report!.max).toEqual(new Decimal(600000));
      expect(report!.median).toEqual(new Decimal(500000));
      expect(report!.town).toBe('TAMPINES');
    });

    it('returns null when no transactions found', async () => {
      mockRepo.findTransactions.mockResolvedValue([]);

      const report = await service.getMarketReport({
        town: 'NOWHERE',
        flatType: '4 ROOM',
        months: 24,
      });

      expect(report).toBeNull();
    });

    it('calculates median for even count', async () => {
      const transactions = [
        { id: '1', month: '2024-01', town: 'T', flatType: '4R', block: '1', streetName: 'S', storeyRange: 'R', floorAreaSqm: 90, flatModel: 'A', leaseCommenceDate: 1995, remainingLease: null, resalePrice: new Decimal(400000), source: 'csv_seed' as const, createdAt: new Date() },
        { id: '2', month: '2024-01', town: 'T', flatType: '4R', block: '2', streetName: 'S', storeyRange: 'R', floorAreaSqm: 90, flatModel: 'A', leaseCommenceDate: 1995, remainingLease: null, resalePrice: new Decimal(600000), source: 'csv_seed' as const, createdAt: new Date() },
      ];
      mockRepo.findTransactions.mockResolvedValue(transactions);

      const report = await service.getMarketReport({ town: 'T', flatType: '4R', months: 12 });

      // Median of [400000, 600000] = 500000
      expect(report!.median).toEqual(new Decimal(500000));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/service.test.ts`
Expected: FAIL — "Cannot find module '../service'"

- [ ] **Step 3: Write the service**

```typescript
// src/domains/hdb/service.ts
import { Decimal } from '@prisma/client/runtime/library';
import { HdbRepository } from './repository';
import type { HdbTransactionFilters, HdbMarketReport } from './types';

export class HdbService {
  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  async getTransactions(filters: HdbTransactionFilters) {
    return this.repo.findTransactions(filters);
  }

  async getDistinctTowns(): Promise<string[]> {
    return this.repo.getDistinctTowns();
  }

  async getDistinctFlatTypes(): Promise<string[]> {
    return this.repo.getDistinctFlatTypes();
  }

  async getMarketReport(params: {
    town: string;
    flatType: string;
    storeyRange?: string;
    months?: number;
  }): Promise<HdbMarketReport | null> {
    const months = params.months ?? 24;

    // Build filters with month cutoff
    const filters: HdbTransactionFilters = {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange,
    };

    if (months > 0) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
      filters.fromMonth = cutoffMonth;
    }

    const transactions = await this.repo.findTransactions(filters);

    if (transactions.length === 0) {
      return null;
    }

    const count = transactions.length;
    const min = transactions[0].resalePrice;
    const max = transactions[count - 1].resalePrice;

    // Median calculation
    let median: Decimal;
    if (count % 2 === 0) {
      const a = transactions[count / 2 - 1].resalePrice;
      const b = transactions[count / 2].resalePrice;
      median = a.add(b).div(2);
    } else {
      median = transactions[Math.floor(count / 2)].resalePrice;
    }

    // Average price per sqm
    let totalPricePerSqm = 0;
    for (const t of transactions) {
      totalPricePerSqm += t.resalePrice.toNumber() / t.floorAreaSqm;
    }
    const avgPricePerSqm = Math.round(totalPricePerSqm / count);

    return {
      town: params.town.toUpperCase(),
      flatType: params.flatType,
      storeyRange: params.storeyRange ?? 'All',
      months,
      count,
      min,
      max,
      median,
      avgPricePerSqm,
      recentTransactions: transactions.slice(-5).reverse(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/service.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/service.ts src/domains/hdb/__tests__/service.test.ts
git commit -m "feat: add HDB service with market report and unit tests"
```

### Task 9: Create HDB sync service with tests

**Files:**
- Create: `src/domains/hdb/sync.service.ts`
- Create: `src/domains/hdb/__tests__/sync.service.test.ts`

- [ ] **Step 1: Write the sync service test**

```typescript
// src/domains/hdb/__tests__/sync.service.test.ts
import axios from 'axios';
import { HdbSyncService } from '../sync.service';
import { HdbRepository } from '../repository';

jest.mock('axios');
jest.mock('../repository');
jest.mock('@/infra/database/prisma', () => ({
  prisma: {},
  createId: jest.fn(() => 'mock-sync-id'),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockRepo = new HdbRepository() as jest.Mocked<HdbRepository>;

describe('HdbSyncService', () => {
  const service = new HdbSyncService(mockRepo);

  beforeEach(() => jest.clearAllMocks());

  it('fetches new records and inserts them', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-01');
    mockRepo.countTransactions.mockResolvedValue(1000);
    mockRepo.createManyTransactions.mockResolvedValue(2);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-1',
      syncedAt: new Date(),
      recordsAdded: 2,
      recordsTotal: 1002,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        result: {
          records: [
            {
              month: '2024-02',
              town: 'TAMPINES',
              flat_type: '4 ROOM',
              block: '123',
              street_name: 'TAMPINES ST 21',
              storey_range: '07 TO 09',
              floor_area_sqm: '93',
              flat_model: 'Model A',
              lease_commence_date: '1995',
              remaining_lease: '68 years 03 months',
              resale_price: '500000',
            },
            {
              month: '2024-03',
              town: 'ANG MO KIO',
              flat_type: '3 ROOM',
              block: '456',
              street_name: 'AMK AVE 1',
              storey_range: '04 TO 06',
              floor_area_sqm: '67',
              flat_model: 'New Generation',
              lease_commence_date: '1985',
              remaining_lease: '58 years',
              resale_price: '350000',
            },
          ],
          total: 2,
        },
      },
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(2);
    expect(result.status).toBe('success');
    expect(mockRepo.createManyTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          town: 'TAMPINES',
          source: 'datagov_sync',
          resalePrice: 500000,
        }),
      ]),
    );
  });

  it('skips records older than latest month', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-06');
    mockRepo.countTransactions.mockResolvedValue(1000);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-2',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 1000,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        result: {
          records: [
            {
              month: '2024-01',
              town: 'TAMPINES',
              flat_type: '4 ROOM',
              block: '1',
              street_name: 'ST',
              storey_range: '01 TO 03',
              floor_area_sqm: '90',
              flat_model: 'A',
              lease_commence_date: '1995',
              resale_price: '400000',
            },
          ],
          total: 1,
        },
      },
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(0);
    expect(mockRepo.createManyTransactions).not.toHaveBeenCalled();
  });

  it('skips sync when no existing data (returns early)', async () => {
    mockRepo.getLatestMonth.mockResolvedValue(null);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-3',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 0,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('logs failure when API errors', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-01');
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-4',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 0,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'failed',
      error: 'Network error',
      createdAt: new Date(),
    });

    mockedAxios.get.mockRejectedValue(new Error('Network error'));

    await expect(service.sync()).rejects.toThrow('Network error');

    expect(mockRepo.createSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'Network error',
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/sync.service.test.ts`
Expected: FAIL — "Cannot find module '../sync.service'"

- [ ] **Step 3: Write the sync service**

```typescript
// src/domains/hdb/sync.service.ts
import axios from 'axios';
import { createId } from '@/infra/database/prisma';
import { logger } from '@/infra/logger';
import { HdbRepository } from './repository';
import type { HdbDataSyncRecord } from './types';

const DATASET_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';
const BASE_URL = 'https://data.gov.sg/api/action/datastore_search';
const PAGE_SIZE = 10000;
const REQUEST_DELAY_MS = 5000;
const MAX_RETRIES = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiRecord {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease?: string;
  resale_price: string;
}

function mapApiRecord(record: ApiRecord) {
  return {
    id: createId(),
    month: record.month,
    town: record.town,
    flatType: record.flat_type,
    block: record.block,
    streetName: record.street_name,
    storeyRange: record.storey_range,
    floorAreaSqm: parseFloat(record.floor_area_sqm),
    flatModel: record.flat_model,
    leaseCommenceDate: parseInt(record.lease_commence_date, 10),
    remainingLease: record.remaining_lease || null,
    resalePrice: parseFloat(record.resale_price),
    source: 'datagov_sync' as const,
  };
}

export class HdbSyncService {
  constructor(private readonly repo: HdbRepository = new HdbRepository()) {}

  async sync(): Promise<HdbDataSyncRecord> {
    const startTime = Date.now();
    let recordsAdded = 0;

    try {
      const latestMonth = await this.repo.getLatestMonth();

      // Guard: if no existing data, the CSV seed should be used instead
      if (!latestMonth) {
        logger.warn('No existing HDB data found. Run the CSV seed first (npx prisma db seed).');
        const syncLog = await this.repo.createSyncLog({
          id: createId(),
          recordsAdded: 0,
          recordsTotal: 0,
          source: DATASET_ID,
          status: 'success',
        });
        return syncLog;
      }

      let offset = 0;
      let hasMore = true;
      let pageNum = 0;

      while (hasMore) {
        pageNum++;
        if (pageNum > 1) await delay(REQUEST_DELAY_MS);

        const response = await this.fetchWithRetry(offset);
        const { records, total } = response.data.result;

        if (!records || records.length === 0) {
          hasMore = false;
          break;
        }

        // Filter to only new records
        const newRecords = latestMonth
          ? records.filter((r: ApiRecord) => r.month > latestMonth)
          : records;

        // Early exit: sorted newest-first
        if (latestMonth && newRecords.length === 0) {
          hasMore = false;
          break;
        }

        if (newRecords.length > 0) {
          const mapped = newRecords.map(mapApiRecord);
          const inserted = await this.repo.createManyTransactions(mapped);
          recordsAdded += inserted;
        }

        offset += PAGE_SIZE;
        hasMore = offset < total;
      }

      const totalRecords = await this.repo.countTransactions();

      const syncLog = await this.repo.createSyncLog({
        id: createId(),
        recordsAdded,
        recordsTotal: totalRecords,
        source: DATASET_ID,
        status: 'success',
      });

      logger.info(
        { recordsAdded, totalRecords, durationMs: Date.now() - startTime },
        'HDB data sync completed',
      );

      return syncLog;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'HDB data sync failed');

      await this.repo.createSyncLog({
        id: createId(),
        recordsAdded,
        recordsTotal: 0,
        source: DATASET_ID,
        status: 'failed',
        error: message,
      });

      throw error;
    }
  }

  private async fetchWithRetry(offset: number, retries = MAX_RETRIES) {
    const headers: Record<string, string> = {};
    if (process.env.DATAGOV_API_KEY) {
      headers.Authorization = process.env.DATAGOV_API_KEY;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await axios.get(BASE_URL, {
          params: {
            resource_id: DATASET_ID,
            limit: PAGE_SIZE,
            offset,
            sort: 'month desc',
          },
          headers,
        });
      } catch (err) {
        if (
          axios.isAxiosError(err) &&
          err.response?.status === 429 &&
          attempt < retries
        ) {
          const retryAfter = err.response.headers['retry-after'];
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
          const exponentialMs = 5000 * Math.pow(2, attempt - 1);
          const waitMs = Math.max(exponentialMs, retryAfterMs);
          logger.warn({ attempt, waitMs }, 'data.gov.sg rate limited, retrying');
          await delay(waitMs);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx jest src/domains/hdb/__tests__/sync.service.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/sync.service.ts src/domains/hdb/__tests__/sync.service.test.ts
git commit -m "feat: add HDB sync service with retry logic and unit tests"
```

---

## Chunk 5: CSV Seed + Cron Job + Integration Tests

### Task 10: Create HDB CSV seed script

**Files:**
- Create: `prisma/seeds/hdb-transactions.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Copy HDB CSV files from v1**

Run: `mkdir -p /Users/david/Documents/AI/sellmyhomenow-v2/data/hdb && cp /Users/david/Documents/AI/sellmyhomenow/data/hdb/*.csv /Users/david/Documents/AI/sellmyhomenow-v2/data/hdb/`

Then verify files exist:
Run: `ls -la /Users/david/Documents/AI/sellmyhomenow-v2/data/hdb/`
Expected: 5 CSV files present.

- [ ] **Step 2: Write the HDB seed script**

```typescript
// prisma/seeds/hdb-transactions.ts
import { createReadStream } from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const CSV_FILES = [
  'Resale_Flat_Prices_Based_on_Approval_Date_1990__1999.csv',
  'Resale_Flat_Prices_Based_on_Approval_Date_2000__Feb2012.csv',
  'Resale_Flat_Prices_Based_on_Registration_Date_From_Mar_2012_to_Dec_2014.csv',
  'Resale_Flat_Prices_Based_on_Registration_Date_From_Jan_2015_to_Dec_2016.csv',
  'Resale_flat_prices_based_on_registration_date_from_Jan2017_onwards.csv',
];

const BATCH_SIZE = 5000;
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'hdb');

interface CsvRow {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease?: string;
  resale_price: string;
}

function parseRemainingLease(value?: string): string | null {
  if (!value || value === '') return null;
  if (/^\d+$/.test(value.trim())) return `${value.trim()} years`;
  return value.trim();
}

function mapRow(row: CsvRow) {
  return {
    id: createId(),
    month: row.month,
    town: row.town,
    flatType: row.flat_type,
    block: row.block,
    streetName: row.street_name,
    storeyRange: row.storey_range,
    floorAreaSqm: parseFloat(row.floor_area_sqm),
    flatModel: row.flat_model,
    leaseCommenceDate: parseInt(row.lease_commence_date, 10),
    remainingLease: parseRemainingLease(row.remaining_lease),
    resalePrice: parseFloat(row.resale_price),
    source: 'csv_seed' as const,
  };
}

async function processFile(prisma: PrismaClient, filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const records: ReturnType<typeof mapRow>[] = [];
    let totalInserted = 0;

    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

    parser.on('data', (row: CsvRow) => {
      records.push(mapRow(row));
    });

    parser.on('error', reject);

    parser.on('end', async () => {
      try {
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          await prisma.hdbTransaction.createMany({ data: batch });
          totalInserted += batch.length;
          if (totalInserted % 50000 === 0 || totalInserted === records.length) {
            process.stdout.write(`\r  Inserted ${totalInserted}/${records.length} records`);
          }
        }
        console.log();
        resolve(totalInserted);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function seedHdbTransactions(prisma: PrismaClient): Promise<void> {
  const existingCount = await prisma.hdbTransaction.count();
  if (existingCount > 0) {
    console.log(`HDB transactions already seeded (${existingCount} records). Skipping.`);
    return;
  }

  let grandTotal = 0;
  for (const file of CSV_FILES) {
    const filePath = path.join(DATA_DIR, file);
    console.log(`Processing: ${file}`);
    const count = await processFile(prisma, filePath);
    grandTotal += count;
  }

  console.log(`Total HDB transactions seeded: ${grandTotal}`);
}
```

- [ ] **Step 3: Update seed entry point to include HDB seed**

Update `prisma/seed.ts`:

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { seedSystemSettings } from './seeds/system-settings';
import { seedHdbTransactions } from './seeds/hdb-transactions';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');
  await seedSystemSettings(prisma);
  await seedHdbTransactions(prisma);
  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Add data/hdb to .gitignore (CSV files are large)**

Add to `.gitignore`:
```
data/hdb/*.csv
```

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts prisma/seeds/hdb-transactions.ts .gitignore
git commit -m "feat: add HDB CSV seed script with streaming batch insert"
```

### Task 11: Register HDB sync cron job

**Files:**
- Modify: `src/infra/jobs/runner.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Update runner.ts to support timezone option**

```typescript
// src/infra/jobs/runner.ts
import cron from 'node-cron';
import { logger } from '../logger';

interface Job {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  timezone?: string;
}

const jobs: Job[] = [];

export function registerJob(
  name: string,
  schedule: string,
  handler: () => Promise<void>,
  timezone?: string,
) {
  jobs.push({ name, schedule, handler, timezone });
}

export function startJobs() {
  for (const job of jobs) {
    const options: cron.ScheduleOptions = {};
    if (job.timezone) {
      options.timezone = job.timezone;
    }
    cron.schedule(
      job.schedule,
      async () => {
        logger.info(`Running job: ${job.name}`);
        try {
          await job.handler();
          logger.info(`Job completed: ${job.name}`);
        } catch (err) {
          logger.error({ err }, `Job failed: ${job.name}`);
        }
      },
      options,
    );
    logger.info(`Registered job: ${job.name} (${job.schedule})`);
  }
}
```

- [ ] **Step 2: Update server.ts to register HDB sync job and start cron**

Replace the full content of `src/server.ts`:

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './infra/http/app';
import { logger } from './infra/logger';
import { registerJob, startJobs } from './infra/jobs/runner';
import { HdbSyncService } from './domains/hdb/sync.service';

const app = createApp();
const port = parseInt(process.env.PORT || '3000', 10);

// Register cron jobs
registerJob(
  'hdb-data-sync',
  '0 3 * * 0',  // Every Sunday at 3am
  async () => {
    const syncService = new HdbSyncService();
    await syncService.sync();
  },
  'Asia/Singapore',
);

// Start cron jobs and server
startJobs();

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test`
Expected: All unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/infra/jobs/runner.ts src/server.ts
git commit -m "feat: register HDB sync cron job (weekly Sunday 3am SGT)"
```

### Task 12: Create test fixture CSV and integration tests

**Files:**
- Create: `tests/fixtures/hdb-sample.csv`
- Create: `tests/integration/schema.test.ts`
- Create: `tests/integration/hdb.test.ts`

- [ ] **Step 1: Create test CSV fixture**

Create `tests/fixtures/hdb-sample.csv` with 15 records covering all 3 schema variants:

```csv
month,town,flat_type,block,street_name,storey_range,floor_area_sqm,flat_model,lease_commence_date,resale_price
1995-01,ANG MO KIO,3 ROOM,174,ANG MO KIO AVE 4,07 TO 09,68,New Generation,1978,115000
1995-02,TAMPINES,4 ROOM,853,TAMPINES ST 83,04 TO 06,93,Model A,1988,178000
1998-06,BEDOK,5 ROOM,417,BEDOK NORTH AVE 2,10 TO 12,122,Improved,1981,280000
2000-03,WOODLANDS,4 ROOM,789,WOODLANDS DR 72,01 TO 03,93,Model A,1995,215000
2005-11,JURONG EAST,3 ROOM,310,JURONG EAST ST 32,04 TO 06,67,New Generation,1982,175000
```

Then add records with remaining_lease as plain number (2015-2016 variant):

```csv
month,town,flat_type,block,street_name,storey_range,floor_area_sqm,flat_model,lease_commence_date,remaining_lease,resale_price
2015-01,TAMPINES,4 ROOM,497,TAMPINES ST 43,10 TO 12,91,Model A,1989,74,380000
2015-06,BEDOK,3 ROOM,108,BEDOK NORTH RD,07 TO 09,67,New Generation,1980,64,270000
2016-03,ANG MO KIO,5 ROOM,562,ANG MO KIO AVE 3,04 TO 06,123,Improved,1984,68,510000
2016-12,WOODLANDS,4 ROOM,672,WOODLANDS DR 71,01 TO 03,93,Model A,1997,80,340000
2016-08,JURONG EAST,4 ROOM,235,JURONG EAST ST 21,10 TO 12,93,Model A,1993,76,425000
```

Then add records with remaining_lease as "years months" (2017+ variant):

```csv
month,town,flat_type,block,street_name,storey_range,floor_area_sqm,flat_model,lease_commence_date,remaining_lease,resale_price
2017-01,TAMPINES,4 ROOM,497,TAMPINES ST 43,10 TO 12,91,Model A,1989,72 years 06 months,395000
2020-06,BEDOK,3 ROOM,108,BEDOK NORTH RD,07 TO 09,67,New Generation,1980,58 years 04 months,290000
2023-01,ANG MO KIO,5 ROOM,562,ANG MO KIO AVE 3,04 TO 06,123,Improved,1984,57 years 03 months,620000
2024-06,WOODLANDS,4 ROOM,672,WOODLANDS DR 71,01 TO 03,93,Model A,1997,70 years 01 months,430000
2024-12,TAMPINES,4 ROOM,853,TAMPINES ST 83,07 TO 09,93,Model A,1988,61 years 04 months,520000
```

**Important:** The CSV should be a single file with consistent columns. Since the 3 variants have different column sets, create 3 separate small files matching the production file structure:

- `tests/fixtures/hdb-pre2015.csv` (5 records, no remaining_lease column)
- `tests/fixtures/hdb-2015-2016.csv` (5 records, remaining_lease as number)
- `tests/fixtures/hdb-2017plus.csv` (5 records, remaining_lease as "years months")

- [ ] **Step 2: Write schema integration test**

```typescript
// tests/integration/schema.test.ts
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';

describe('Phase 1A Schema', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('creates an agent', async () => {
    const agent = await factory.agent({ name: 'David Tan', ceaRegNo: 'R123456A' });
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('David Tan');
    expect(agent.ceaRegNo).toBe('R123456A');
    expect(agent.role).toBe('agent');
    expect(agent.isActive).toBe(true);
  });

  it('creates a seller with agent relation', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id, name: 'Jane Lim' });

    expect(seller.agentId).toBe(agent.id);
    expect(seller.name).toBe('Jane Lim');
    expect(seller.status).toBe('lead');
    expect(seller.consentService).toBe(true);
    expect(seller.consentMarketing).toBe(false);
  });

  it('creates a property with seller relation', async () => {
    const agent = await factory.agent();
    const seller = await factory.seller({ agentId: agent.id });
    const property = await factory.property({
      sellerId: seller.id,
      town: 'BEDOK',
      askingPrice: 550000,
    });

    expect(property.sellerId).toBe(seller.id);
    expect(property.town).toBe('BEDOK');
    expect(property.askingPrice?.toString()).toBe('550000');
    expect(property.status).toBe('draft');
  });

  it('creates an HDB transaction with Decimal resalePrice', async () => {
    const txn = await factory.hdbTransaction({ resalePrice: 485000.50 });

    expect(txn.id).toBeDefined();
    expect(txn.resalePrice.toString()).toBe('485000.5');
    expect(txn.source).toBe('csv_seed');
  });

  it('queries HDB transactions by town and flat type', async () => {
    await factory.hdbTransaction({ town: 'TAMPINES', flatType: '4 ROOM' });
    await factory.hdbTransaction({ town: 'TAMPINES', flatType: '3 ROOM' });
    await factory.hdbTransaction({ town: 'BEDOK', flatType: '4 ROOM' });

    const tampines4Room = await testPrisma.hdbTransaction.findMany({
      where: { town: 'TAMPINES', flatType: '4 ROOM' },
    });

    expect(tampines4Room).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Write HDB service integration test**

```typescript
// tests/integration/hdb.test.ts
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { Decimal } from '@prisma/client/runtime/library';

describe('HDB Integration', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('HDB transaction queries', () => {
    it('returns distinct towns', async () => {
      await factory.hdbTransaction({ town: 'TAMPINES' });
      await factory.hdbTransaction({ town: 'BEDOK' });
      await factory.hdbTransaction({ town: 'TAMPINES' }); // duplicate

      const towns = await testPrisma.hdbTransaction.findMany({
        distinct: ['town'],
        select: { town: true },
        orderBy: { town: 'asc' },
      });

      expect(towns.map((t) => t.town)).toEqual(['BEDOK', 'TAMPINES']);
    });

    it('returns distinct flat types', async () => {
      await factory.hdbTransaction({ flatType: '4 ROOM' });
      await factory.hdbTransaction({ flatType: '3 ROOM' });
      await factory.hdbTransaction({ flatType: '5 ROOM' });

      const types = await testPrisma.hdbTransaction.findMany({
        distinct: ['flatType'],
        select: { flatType: true },
        orderBy: { flatType: 'asc' },
      });

      expect(types.map((t) => t.flatType)).toEqual(['3 ROOM', '4 ROOM', '5 ROOM']);
    });

    it('filters by month range', async () => {
      await factory.hdbTransaction({ month: '2023-01' });
      await factory.hdbTransaction({ month: '2023-06' });
      await factory.hdbTransaction({ month: '2024-01' });
      await factory.hdbTransaction({ month: '2024-06' });

      const results = await testPrisma.hdbTransaction.findMany({
        where: { month: { gte: '2023-06', lte: '2024-01' } },
      });

      expect(results).toHaveLength(2);
    });

    it('stores resalePrice as Decimal', async () => {
      const txn = await factory.hdbTransaction({ resalePrice: 523456.78 });

      const found = await testPrisma.hdbTransaction.findUnique({
        where: { id: txn.id },
      });

      expect(found!.resalePrice).toBeInstanceOf(Decimal);
      expect(found!.resalePrice.toString()).toBe('523456.78');
    });
  });

  describe('HDB data sync logging', () => {
    it('creates a sync log entry', async () => {
      const { createId } = await import('@paralleldrive/cuid2');
      const syncLog = await testPrisma.hdbDataSync.create({
        data: {
          id: createId(),
          recordsAdded: 150,
          recordsTotal: 972150,
          source: 'test-dataset',
          status: 'success',
        },
      });

      expect(syncLog.recordsAdded).toBe(150);
      expect(syncLog.status).toBe('success');
    });
  });
});
```

- [ ] **Step 4: Run all integration tests**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm run test:integration`
Expected: All integration tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/hdb-*.csv tests/integration/schema.test.ts tests/integration/hdb.test.ts
git commit -m "feat: add schema and HDB integration tests with CSV fixtures"
```

---

## Chunk 6: Final Verification

### Task 13: Run all tests and verify no regressions

- [ ] **Step 1: Run unit tests**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test`
Expected: All unit tests pass (existing 22 + new HDB tests).

- [ ] **Step 2: Run integration tests**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm run test:integration`
Expected: All integration tests pass (existing 3 + new schema/HDB tests).

- [ ] **Step 3: Run type check**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run lint**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm run lint`
Expected: No lint errors.

- [ ] **Step 5: Verify Prisma client has all types**

Run: `cd /Users/david/Documents/AI/sellmyhomenow-v2 && node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(Object.keys(p).filter(k => !k.startsWith('_') && !k.startsWith('$')).sort().join('\n'));"`
Expected: Lists all 29 model names (agent, auditLog, buyer, caseFlag, cddRecord, commissionInvoice, consentRecord, dataCorrectionRequest, dataDeletionRequest, estateAgencyAgreement, financialReport, hdbDataSync, hdbTransaction, listing, marketContent, notification, offer, otp, portalListing, property, referral, seller, systemSetting, testimonial, transaction, verifiedViewer, videoTutorial, viewing, viewingSlot).

- [ ] **Step 6: Final commit if any fixes needed**

If any fixes were required, commit them:
```bash
git add -A
git commit -m "fix: resolve Phase 1A test/lint issues"
```
