# Phase 2: Seller Dashboard & Financial Engine — Design

**Date:** 2026-03-10
**Status:** Approved
**Prerequisites:** Phase 1 complete (auth, seller model, notification domain, AI facade, shared infrastructure)

## Overview

Phase 2 builds the seller-facing experience: onboarding wizard, dashboard, property management, financial calculations, viewing scheduler, and supporting workflows. Decomposed into 5 sub-projects executed in linear dependency order.

## Sub-project Sequence

| Sub-project | Scope | Depends on |
|---|---|---|
| **2A** | Seller Dashboard Shell + Onboarding Wizard | Phase 1 |
| **2B** | Property Domain + Photo Upload + Listing | 2A |
| **2C** | Financial Engine + AI Narratives | 2B |
| **2D** | Viewing Scheduler | 2B |
| **2E** | Case Flags + Notification Prefs + Co-Broke + Fallen-Through | 2B, 2C, 2D |

Each sub-project gets its own spec → plan → TDD cycle.

### Deferred to Phase 3 (Agent Dashboard)
The following Phase 2 doc features are agent-facing and will be built in Phase 3:
- **Agent/admin calendar view:** Month/week/day toggle, all viewings across all listings, colour-coded status, click-to-expand viewer details, filters by property/type/status/date, admin filter by agent
- **Cross-listing viewer intelligence:** Which VerifiedViewers are booking multiple properties ("hot leads"), agent notification of high-intent buyers
- **Viewing analytics:** Total viewings per week/month, conversion rate (viewings to offers), per-property breakdown

## Architecture

### New domains
- `src/domains/property/` — Property CRUD, listing management, photo upload, price history, financial calculations
- `src/domains/viewing/` — ViewingSlot, Viewing, VerifiedViewer, public booking

### Extended domains
- `src/domains/seller/` — Onboarding wizard state, dashboard data aggregation, notification preferences, case flags
- `src/domains/shared/ai/` — Financial narrative prompt template (facade already exists)
- `src/domains/notification/` — Viewing notification templates, reminder scheduling

### New views
- `views/pages/seller/` — Dashboard, onboarding wizard steps, property details, photos, viewings, financials, documents, My Data
- `views/pages/public/` — Viewing booking page
- `views/partials/seller/` — HTMX fragments for dashboard interactions

### Shared patterns
- Every route handler checks `hx-request` for fragment vs full page
- All user-facing strings wrapped in `{{ "string" | t }}`
- Services call repositories, never Prisma directly
- All mutations create audit log entries

---

## Sub-project 2A: Seller Dashboard Shell + Onboarding Wizard

### Seller domain extensions
- `onboardingStep` tracking (integer 0–5, where 0 = not started, 5 = complete)
- `seller.service.ts` — `getOnboardingStatus()`, `completeOnboardingStep()`, `getDashboardOverview()`
- `seller.repository.ts` — queries for seller profile, onboarding state

### Onboarding wizard (HTMX multi-step, single page)
- Each step loads via `hx-get="/seller/onboarding/step/{n}"` → returns step partial
- Step completion via `hx-post` → validates → advances to next step
- Steps 1 (Welcome), 4 (Photos), 5 (Agreement) are informational/acknowledgement
- Step 2 (Property Details) creates a draft Property record — stub form in 2A, fully implemented in 2B
- Step 3 (Financial Situation) collects financial inputs — stub form in 2A, connected to engine in 2C
- Progress bar showing current step

### Dashboard shell
- Seller layout sidebar: Overview, Property, Photos, Viewings, Documents, Financial Report, Video Tutorials, Settings, My Data
- Overview page: transaction status card, next steps (dynamic based on stage), unread notifications count, onboarding progress if incomplete, visual timeline tracker showing key dates and milestones (draft → listed → viewings → offer → OTP → completion)
- Timeline tracker: renders key dates from transaction/property state, shows upcoming deadlines (OTP exercise, HDB appointment), integrates with automated reminders (WhatsApp + email + in-app via notification domain)
- Document checklist page: dynamic checklist based on transaction stage — items include NRIC, marriage cert, eligibility letter, OTP scan, estate agency agreement, etc. Each item shows status (not uploaded / uploaded / verified by agent). Shell page in 2A, dynamic content populated as sub-projects add document types.
- Video tutorials page: lists VideoTutorial records grouped by category (photography/forms/process/financial), embedded YouTube player. Reads from VideoTutorial model (admin CRUD for tutorials is Phase 6, but the display page is built here).
- Most other pages are placeholder shells in 2A — filled in by subsequent sub-projects
- Notification feed page (reads from existing notification domain)
- My Data page (PDPA) — shows seller's personal data, consent status, links to request corrections/deletion

### Routes
- `GET /seller/dashboard` — overview (redirects to onboarding if incomplete)
- `GET /seller/onboarding` — wizard page
- `GET /seller/onboarding/step/:n` — HTMX step partial
- `POST /seller/onboarding/step/:n` — complete step
- `GET /seller/notifications` — notification feed
- `GET /seller/my-data` — PDPA data view
- `GET /seller/documents` — document checklist page
- `GET /seller/tutorials` — video tutorials page

### Tests
- Unit: onboarding step validation, step advancement logic, dashboard data aggregation, timeline milestone rendering from transaction state, document checklist status computation
- Integration: onboarding flow end-to-end, auth-guarded routes, HTMX partial responses

---

## Sub-project 2B: Property Domain + Photo Upload + Listing

### New domain: `src/domains/property/`
- `property.types.ts` — Property, Listing, PortalListing enums and types, state machine transitions
- `property.repository.ts` — CRUD, price history append, listing status management
- `property.service.ts` — create/update property, price change logic (auto-reverts listing to `pending_review`), photo management
- `property.validator.ts` — flat details validation, price validation
- `property.router.ts` — seller-facing routes

### Photo upload flow
- Seller uploads via drag-and-drop interface (max 20 photos, 5MB each, JPG/PNG only)
- On upload: validate type + size → `sharp` resizes to 2000px max, JPEG quality 80 → store original + optimized in `/uploads/photos/{sellerId}/{propertyId}/`
- Minimum 800px on longest edge (reject too-small images)
- Each photo gets status: `uploaded → pending_review → approved/rejected`
- Uses `infra/storage/` interface (already built in Phase 1)
- Photo reordering (seller drags to set display order)

### Listing management
- Listing created from property data + approved photos + AI-generated description (description generation stubbed in 2B, connected in 2C)
- Listing state machine: `draft → pending_review → approved → live → paused → closed`
- Agent reviews listing before it goes live (review gate — agent action built in Phase 3, state machine set up here)

### Price change on live listing
- Seller updates asking price → new price appended to `Property.priceHistory` JSON array
- If listing is `live` → auto-revert to `pending_review`
- Agent notified: "Seller changed asking price from $X to $Y"
- Audit log: `property.price_changed`

### Onboarding wizard connection
- Step 2 (Property Details) saves to a real Property record instead of stub
- Pre-population from HDB report tool data if seller came through as a lead

### Routes
- `GET /seller/property` — property details page
- `PUT /seller/property` — update property details (HTMX)
- `GET /seller/photos` — photo management page
- `POST /seller/photos` — upload photos
- `DELETE /seller/photos/:id` — remove photo
- `PUT /seller/photos/reorder` — update photo display order

### Tests
- Unit: property CRUD, price history tracking, listing state machine transitions, photo validation (type, size, dimensions), price change → listing revert logic
- Integration: photo upload end-to-end, property update with live listing triggers revert, storage interface integration

---

## Sub-project 2C: Financial Engine + AI Narratives

### Financial service: `src/domains/property/financial.service.ts`

Lives in the property domain because it operates on property + seller financial data.

### Core calculation
```
Net Cash Proceeds = Sale Price
  - Outstanding Loan
  - CPF Refund (OA used + accrued interest at 2.5% p.a.)
  - Resale Levy (if applicable)
  - Commission ($1,633.91 from SystemSetting)
  - Legal Fees (estimate range $2,000–$3,000)
```

### CPF accrued interest
- 2.5% p.a. compounded on OA amount used
- Calculated from year of purchase to current year
- Joint owners: separate CPF inputs for Owner 1 and Owner 2, individual accrued interest calculations, per-owner breakdown in report

### Resale levy
- Lookup table from HDB rates (based on flat type, subsidised/non-subsidised, first/second timer)
- Hardcoded reference table with source URL — rates rarely change, admin can update via SystemSetting override if needed

### Edge case handling
- Seller doesn't know CPF usage → accept "unknown", estimate based on flat type + purchase year + typical LTV ratios, clearly mark as "rough estimate"
- Zero loan / zero CPF → proceed normally, those deductions are simply $0
- Negative net proceeds → warning (not error): "Based on the figures provided, the sale proceeds may not cover all deductions."
- All optional fields default to $0 with note in report

### Financial report entity (`FinancialReport`)
- Stores all calculation inputs and outputs in `reportData` JSON
- `aiNarrative` — AI-generated plain-language summary
- `aiProvider` / `aiModel` — tracks which AI generated it
- `version` — incremented on recalculation
- Review flow: `generated → pending_review → approved → sent`

### AI narrative generation
- **Note:** Phase doc section 2.3 "AI Integration (Provider-Agnostic)" describes the full AI facade architecture. This is already satisfied by Phase 1 (`src/domains/shared/ai/`). Sub-project 2C only adds the financial narrative prompt template and calls the existing facade.
- New prompt template: `src/domains/shared/ai/prompts/financial-narrative.ts`
- Template includes: Singapore HDB context, disclaimer instructions, seller's specific numbers
- Calls existing AI facade → gets narrative text + provider/model metadata
- Stores metadata on FinancialReport record

### Onboarding wizard connection
- Step 3 (Financial Situation) inputs now feed into the financial engine
- After onboarding completes, a draft financial report is auto-generated

### Commission
- Always read from `SystemSetting` at runtime:
  - `commission_amount`: seeded as `1499` (Decimal)
  - `gst_rate`: seeded as `0.09` (9% GST, current Singapore rate)
- Never hardcoded in calculation logic
- `$1,499 × 1.09 = $1,633.91` — verified in regression tests

### Routes
- `GET /seller/financial` — financial report page
- `POST /seller/financial/calculate` — run/re-run calculation
- `GET /seller/financial/report/:id` — view a specific report version
- `POST /api/v1/financial/report/:id/approve` — agent approves (agent auth required)
- `POST /api/v1/financial/report/:id/send` — send to seller via chosen channel

### Tests
- Unit: standard case calculation, CPF accrued interest (known 10-year and 20-year cases), resale levy for each flat type, zero CPF/loan, negative net proceeds warning, joint owner breakdown, commission always $1,633.91, unknown CPF estimation
- Integration: calculate endpoint returns correct report structure, agent approve creates audit log, send triggers notification
- Regression: 20+ edge cases (zero CPF, zero loan, max levy, old lease, million-dollar flat, negative net proceeds, joint owners, GST calculation)

---

## Sub-project 2D: Viewing Scheduler

### New domain: `src/domains/viewing/`
- `viewing.types.ts` — ViewingSlot, Viewing, VerifiedViewer types, slot state machine (`available → booked → full → cancelled`), viewing state machine (`pending_otp → scheduled → completed → cancelled → no_show`)
- `viewing.repository.ts` — slot CRUD, booking with row-level locking (`SELECT FOR UPDATE` via Prisma `$transaction`), verified viewer lookup/create
- `viewing.service.ts` — slot management, booking flow, cancellation, feedback, OTP generation/verification
- `viewing.validator.ts` — slot creation, booking form, OTP input
- `viewing.router.ts` — seller routes + public booking routes

### Seller slot management (dashboard)
- Create slots: pick date, start time → end time auto-calculated from `viewing_slot_duration` SystemSetting (default 15 min)
- Slot type: Single (1 party) or Group (open house, seller sets max viewers, default from `viewing_max_group_size`)
- Bulk creation: "Add weekly recurring slots" — e.g. every Saturday 10am–12pm, auto-creates 15-min slots for next 4 weeks
- Calendar view: available (green), booked (blue), full (grey), cancelled (red)
- Cancel slot → cascade: all Viewing records for that slot → `cancelled`, viewers notified, `currentBookings` reset
- Post-viewing: seller logs text feedback per viewing
- No-show tracking: seller can mark a viewing as `no_show` from the dashboard. When marked, the VerifiedViewer record is flagged (e.g. `noShowCount` incremented). Agent can see no-show history for any viewer — useful for identifying unreliable bookers. Viewers are not blocked from future bookings, but agent has visibility.
- Stats: total viewings conducted, upcoming count, feedback history, no-show count

### Public booking page (`/view/{propertySlug}`)
- No login required — fully public
- Shows: property summary (town, flat type, floor area, storey, asking price — no seller personal details), available slots
- Booking form: name, phone, "Are you buying for myself / I am a property agent" radio, PDPA consent checkbox
- If agent: additional fields for agent name, CEA reg, agency name

### Phone OTP verification flow
- New phone → send 6-digit OTP via WhatsApp (using existing notification domain) → 5 min expiry → max 3 attempts → on success: create VerifiedViewer + Viewing
- SMS fallback: if WhatsApp delivery fails (API error or timeout), automatically retry OTP via SMS. Uses notification domain's existing fallback logic. SMS provider configured via SystemSetting.
- Returning phone (exists in VerifiedViewer) → skip OTP entirely → auto-fill name → create Viewing immediately
- Max 3 OTP requests per phone per hour

### Booking confirmation (both paths)
- Update VerifiedViewer counters (`totalBookings`, `lastBookingAt`)
- Update ViewingSlot.currentBookings (with row lock to prevent race conditions)
- Single slot + first booking → slot becomes `booked`
- Group slot + `currentBookings >= maxViewers` → slot becomes `full`
- Notifications: confirmation to viewer (WhatsApp), alert to seller (WhatsApp + in-app), log for agent (in-app)
- Generate unique cancellation link with cancel token

### Cancellation
- One-click via `/view/cancel/{viewingId}/{cancelToken}` — no login required
- Decrements `currentBookings`, re-opens slot if it was `booked`/`full`
- Notifies seller

### Notification lifecycle (extends notification domain)
- New templates: booking confirmed (buyer + seller), cancellation (seller), morning reminder (buyer + seller, consolidated), 1-hour reminder (buyer), post-viewing feedback prompt (seller)
- Morning reminders: daily 9am cron job queries today's viewings, sends batch
- 1-hour reminders: 15-minute cron job checks viewings in next 60–75 minutes
- Post-viewing prompt: same 15-minute job checks for passed viewing end times

### Multi-layer spam protection
1. Honeypot hidden field — bots fill it, silently reject with fake success
2. Phone OTP (first-time only) — eliminates all bots
3. Rate limit per phone: 3 bookings/phone/day
4. Rate limit per IP: 10 booking attempts/IP/hour
5. Time-based form validation: reject if submitted in under 3 seconds
6. Duplicate detection: same phone can't book same slot twice
- No reCAPTCHA (PDPA-conscious positioning)

### Routes
- `GET /seller/viewings` — seller viewing management page
- `POST /seller/viewings/slots` — create slot(s)
- `DELETE /seller/viewings/slots/:id` — cancel slot
- `POST /seller/viewings/:id/feedback` — log viewing feedback
- `GET /view/:propertySlug` — public booking page
- `POST /view/:propertySlug/book` — submit booking
- `POST /view/:propertySlug/verify-otp` — verify OTP
- `GET /view/cancel/:viewingId/:cancelToken` — one-click cancellation

### Tests
- Unit: slot creation/validation, bulk slot generation, booking flow (new + returning viewer), OTP generation/expiry/max attempts, cancellation cascade, slot state transitions, spam protection checks, consolidated morning reminder logic
- Integration: full booking flow with OTP, concurrent booking race condition (two requests for last single slot — only one succeeds), cancellation updates slot availability, notification dispatch on booking/cancel

---

## Sub-project 2E: Case Flags + Notification Prefs + Co-Broke + Fallen-Through

### Case flags (`src/domains/seller/case-flag.service.ts`)
- Lives in the seller domain — case flags are about the seller's situation
- Agent flags a complex case from seller detail view (agent UI built in Phase 3, service + data layer built here)
- `CaseFlag` types: `deceased_estate`, `divorce`, `mop_not_met`, `eip_spr_quota` (buyer-side EIP/SPR restriction on the block), `pr_seller` (seller is a Permanent Resident — different levy/eligibility rules), `bank_loan`, `court_order`, `other`
- Status flow: `identified → in_progress → resolved → out_of_scope`
- Each type has a guided checklist template (static content — stored as typed constants, not in DB)
- Seller sees a banner on dashboard when flagged: "Your agent has noted a special circumstance. Review the guidance below."
- MOP enforcement: if `mop_not_met` flag is active, listing creation is blocked (service-level check). Agent can override with documented reason.
- Routes: `GET /seller/case-flags` (seller views flags + guidance), API routes for agent CRUD

### Notification preferences (extends seller domain)
- Seller sets preference in dashboard Settings: `whatsapp_and_email` (default) or `email_only`
- `seller.notificationPreference` field already exists in schema
- Extend notification service: check preference before sending — if `email_only`, skip WhatsApp
- In-app notifications always sent regardless of preference
- Preference change logged in audit trail
- Routes: `GET /seller/settings`, `PUT /seller/settings/notifications`

### Co-broking policy (extends property domain)
- When an offer has `buyerAgentName` filled → auto-set `Offer.isCoBroke = true`
- Co-broking terms stored in `EstateAgencyAgreement.coBrokingTerms` (static text)
- Terms included in portal-ready listing output
- No commission splitting logic — commission is always $1,633.91 from the seller

### Fallen-through & relisting (extends property + viewing domains)
- Agent updates Transaction status to `fallen_through` with reason
- Cascade:
  - Listing → `draft`
  - Property → `draft`
  - Clear transaction link from property (property is no longer under transaction)
  - Active ViewingSlots (`available`, `booked`, `full` only — already-cancelled slots are left alone) → `cancelled`, triggers viewer notifications via viewing service, `currentBookings` reset
  - OTP → `expired` if still active
  - **Preserved (not deleted):** Transaction record, all viewing history, all previous offer data — useful context for relisting
- Seller notified via WhatsApp + in-app with reason
- Seller can update photos/price/details, agent re-reviews, listing goes live again
- Seller must create new viewing slots (old slots are cancelled, not reused)
- Previous PortalListings marked `expired`
- No additional charge — relisting is part of the service
- Audit log: `transaction.fallen_through` with reason

### Routes
- `GET /seller/settings` — settings page
- `PUT /seller/settings/notifications` — update notification preference
- `GET /seller/case-flags` — view case flags and guidance
- `POST /api/v1/sellers/:id/case-flags` — agent creates flag
- `PUT /api/v1/sellers/:id/case-flags/:flagId` — agent updates flag
- `POST /api/v1/transactions/:id/fallen-through` — agent marks fallen through

### Tests
- Unit: case flag creation/validation, checklist template lookup by type, MOP enforcement blocks listing, notification preference check in notification service, co-broke auto-detection from offer data, fallen-through cascade logic
- Integration: fallen-through cascade end-to-end, notification preference respected in send flow, case flag CRUD with audit logging
