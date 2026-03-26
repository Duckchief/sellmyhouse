# Phase 6: Content & Referrals — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Phase doc:** `docs/phase-6-content-referrals.md`

## Overview

Phase 6 is the final phase of the v2 rewrite. It adds four sub-systems: video tutorial management (admin CRUD), market content engine (weekly AI-generated social posts), testimonial management (post-completion request → agent review → public display), and a referral tracking program (link generation → conversion funnel → admin analytics).

All four sub-systems live in a new `src/domains/content/` domain, as planned in the v2 design spec.

## 1. Domain Structure

```
src/domains/content/
├── content.types.ts          # Types for all four sub-systems
├── content.service.ts        # Business logic
├── content.repository.ts     # All DB access (VideoTutorial, MarketContent, Testimonial, Referral)
├── content.router.ts         # Admin CRUD + seller referral page routes
├── content.validator.ts      # Input validation (slugs, social format lengths, token format, referral codes)
├── content.jobs.ts           # Cron registrations
├── content.service.test.ts   # Unit tests (mock repository)
└── content.router.test.ts    # Route-level tests
```

### Boundaries

- `content.repository.ts` owns all reads/writes for VideoTutorial, MarketContent, Testimonial, Referral
- `review.repository.ts` already queries MarketContent for the agent review queue — this stays as-is (the review domain reads; content domain owns MarketContent writes)
- Testimonial approval is handled entirely within the content domain via `/admin/content/testimonials` routes — it does NOT use the generic review queue. The `TestimonialStatus` enum is separate from `FinancialReportStatus` and the review queue's type system does not support it cleanly.
- `seller.router.ts` keeps the existing `/seller/tutorials` route and gains `/seller/referral` — both delegate to `contentService`
- Admin routes are added to `admin.router.ts`, delegating to `contentService`
- No circular dependencies

## 2. Schema Changes Required in This Phase

The following schema migrations are required before implementation:

| Model | Change |
|-------|--------|
| `Testimonial` | Add `submissionToken String? @unique @map("submission_token")` |
| `Testimonial` | Add `tokenExpiresAt DateTime? @map("token_expires_at")` |
| `Testimonial` | Make `content String` → `content String?` (nullable — not known until seller submits) |
| `Testimonial` | Make `rating Int` → `rating Int?` (nullable — not known until seller submits) |
| `Testimonial` | Change `@default(pending_review)` → `@default(pending_submission)` |
| `TestimonialStatus` | Add `pending_submission` as first value (Postgres `ALTER TYPE ... ADD VALUE`) |
| `VideoTutorial` | Accept absence of `updatedAt` — simple admin content; `createdAt` is sufficient. Note: admin edit operations will not have an updated timestamp. |

The `MarketContent` schema has `town String` and `flatType String` as non-nullable fields. The weekly aggregate record uses sentinel values `town = "ALL"` and `flatType = "ALL"` to indicate a cross-town aggregate. The review queue display in `review.repository.ts` renders `${m.town} — ${m.flatType} (${m.period})` — update this display to `Weekly Market Summary (${m.period})` when `town === "ALL"`.

The `MarketContentStatus` enum includes a `published` value. This phase does not use it — `approved` is the terminal state. The agent manually copies approved content to social media. `published` is reserved for a future automated posting feature.

## 3. Video Tutorial Management

### Admin routes

```
GET    /admin/tutorials           → list all, grouped by category
GET    /admin/tutorials/new       → create form
POST   /admin/tutorials           → create
GET    /admin/tutorials/:id/edit  → edit form
POST   /admin/tutorials/:id       → update
POST   /admin/tutorials/:id/delete → delete (hard delete, confirmation required)
POST   /admin/tutorials/reorder   → update orderIndex values (HTMX)
```

### Fields

title, slug (auto-generated from title on create, editable on update, unique), description, youtubeUrl, category (Photography/Forms/Process/Financial), orderIndex.

### Reorder

Up/down buttons per row. HTMX posts updated orderIndex values. No drag library.

### Seller side

`GET /seller/tutorials` already works — no changes needed. Tutorials ordered by `orderIndex`.

## 4. Market Content Engine

### Weekly cron

Schedule: Monday 8am SGT, configurable via `SystemSetting: market_content_schedule`.

**Duplicate guard:** If a `MarketContent` record already exists for the current period (same `period` value, e.g., `"2026-W11"`) with any status other than `rejected`, skip the run. This prevents duplicate records from manual triggers or cron restarts.

**Aggregation** — queries `HdbTransaction` for past 4 weeks, produces three insights in one pass:
- Top 5 towns by median resale price
- Million-dollar flats (≥ $1,000,000): count + examples
- 3-month price trend per flat type (rising/falling/stable)

Creates a single `MarketContent` record per run with:
- `town = "ALL"` (sentinel — cross-town aggregate)
- `flatType = "ALL"` (sentinel — cross-type aggregate)
- `period` = ISO week string (e.g., `"2026-W11"`)
- `rawData` = aggregations JSON
- `status = ai_generated`

If insufficient HDB data exists for the period (fewer than 10 transactions), skip the run and log a warning.

### AI generation

Calls `ai.facade.ts` to generate:
- `aiNarrative` — plain English summary of all three insights
- `tiktokFormat` — ≤ 150 chars + 3 hashtags
- `instagramFormat` — ≤ 300 chars + 5 hashtags + source attribution
- `linkedinFormat` — professional tone, ≤ 700 chars + source attribution

Source attribution on all social formats: `"Based on HDB resale data — sellmyhouse.sg"`

After AI generation: `status → pending_review` (enters agent review queue).

### Agent review

MarketContent with `status: pending_review` appears in the existing agent review queue (already plumbed in `review.repository.ts`). The queue display shows `Weekly Market Summary (${m.period})` when `town === "ALL"`. Agent reads narrative + social formats, approves or rejects. On approval: `status → approved`, `approvedAt` + `approvedByAgentId` set. Agent manually copies formatted content to post on social media — no direct API posting.

### Admin view

`/admin/content/market` — lists all MarketContent records with status badges and pagination. Shows raw data, narrative, and all three social formats.

**Manual trigger:** `POST /admin/content/market/run` — admin-only route. Respects the same duplicate guard as the weekly cron. Throws `ConflictError` (→ 409) if a non-rejected record already exists for the current period.

## 5. Testimonial Management

### Post-completion cron

Runs daily. Finds transactions completed exactly N days ago (N = `SystemSetting: post_completion_testimonial_delay_days`, default 7) where no `Testimonial` record exists yet.

For each:
1. Generates a `submissionToken` (cuid2)
2. Sets `tokenExpiresAt` = now + 30 days
3. Creates `Testimonial` record with `status: pending_submission`
4. **DNC check:** notification service checks DNC registry before sending WhatsApp
5. Sends WhatsApp + email to seller with link: `/testimonial/{submissionToken}`

### Seller form (public, token-auth only)

Route: `GET /testimonial/:token` — validates token exists and `tokenExpiresAt > now`. If expired: renders an expiry message. If already submitted (`status` is not `pending_submission`): renders a "already submitted" message.

Fields:
- Rating (1–5 stars)
- Written testimonial text
- Display name (pre-filled: "John T." format from seller's name — truncation/formatting done in `contentService.formatDisplayName()`, not in the router)
- Display town (pre-filled from seller's property town)

All user-facing strings in Nunjucks templates use the `| t` filter.

On submit (`POST /testimonial/:token`): `status → pending_review`. Token fields remain set (for audit trail) but are no longer valid for re-submission.

### Agent review

Agent reviews testimonials via `/admin/content/testimonials` — dedicated admin routes, not the generic review queue. Approve → `status: approved`. Reject → `status: rejected`.

### Admin management

`/admin/content/testimonials` — lists all testimonials with status filters (pending_submission / pending_review / approved / rejected). Approve/reject actions for `pending_review` items. Toggle `displayOnWebsite: true/false` for approved testimonials.

Admin routes:
```
GET  /admin/content/testimonials             → list with filters
POST /admin/content/testimonials/:id/approve → approve
POST /admin/content/testimonials/:id/reject  → reject
POST /admin/content/testimonials/:id/feature → toggle displayOnWebsite
```

### Public display

Approved testimonials with `displayOnWebsite: true` appear in a testimonials section on the existing landing page (`pages/public/home.njk`). Rendered server-side at request time — no caching layer — so removal is immediate.

### Seller removal

Button in seller dashboard (my-data page). Immediately hard-deletes the `Testimonial` record. Writes audit log entry: `action: testimonial_removed`, `entityType: testimonial`, `entityId: testimonialId`, `agentId: undefined`, `details: { sellerId, reason: 'seller_requested' }`. No agent approval required. Because the homepage is server-side rendered at request time, the testimonial disappears from the public page immediately.

### PDPA deletion cascade

The existing `hardDeleteSeller` in `compliance.repository.ts` calls `prisma.seller.delete()` directly. The Prisma schema has no `onDelete: Cascade` annotations — the default is `Restrict`, meaning FK-constrained related records must be deleted first or the delete will fail. The `hardDeleteSeller` function must be extended in this phase to explicitly hard-delete `Testimonial` (if any) and `Referral` records (both `referralsGiven` and `referralsReceived`) before the seller delete call.

## 6. Referral Program

### Post-completion cron

Runs daily. Finds transactions completed exactly N days ago (N = `SystemSetting: post_completion_referral_delay_days`, default 14) where no `Referral` record exists yet.

For each:
1. Generates unique `referralCode` (cuid2, 8 chars)
2. Creates `Referral` record with `status: link_generated`
3. **DNC check:** notification service checks DNC registry before sending WhatsApp
4. Sends WhatsApp + email to seller with link: `sellmyhouse.sg/?ref={referralCode}`

### Tracking middleware

Runs on all public routes:
- If `?ref=` query param present:
  - Store `referralCode` in session (30-day expiry)
  - Atomically increment `Referral.clickCount` using `prisma.referral.update({ data: { clickCount: { increment: 1 } } })` to handle concurrent requests safely
  - If `status === 'link_generated'`: transition `status → clicked`

### Lead conversion

Existing lead form submission checks session for stored `referralCode`. If found:
- Set `Seller.leadSource = 'referral'`
- Link `Referral.referredSellerId`
- Set `Referral.status → lead_created`

### Transaction conversion

When a referred seller completes a transaction: `Referral.status → transaction_completed`.

### Seller dashboard

New `/seller/referral` page. States:
- **Before referral record exists** (transaction not yet complete, or within 14-day window): renders a placeholder — "Your referral link will be available 14 days after your transaction completes."
- **After referral record exists**: shows referral link with copy button, click count, conversion status (lead created / transaction completed — no referred seller names shown)

### Admin analytics

`/admin/content/referrals`:
- Conversion funnel: links generated → clicked → leads → completed
- Top referrers table: seller name, clicks, leads, completions

### PDPA deletion cascade

When the referrer seller is hard-deleted: hard-delete their `Referral` records (all entries in `referralsGiven`). When the referred seller is hard-deleted: nullify `Referral.referredSellerId` (set to `null`) to preserve the referral click and lead tracking record without retaining the referred seller's identity. Both of these must be handled in the extended `hardDeleteSeller` function alongside the testimonial cascade.

### CEA compliance

No cash incentive or reward of any kind. Purely tracking organic word-of-mouth (CEA PC 04/2018).

## 7. Testing

### Unit tests (`content.service.test.ts`)

- Market data aggregation accuracy (top towns, million-dollar threshold, trend calculation)
- Social format generation (character limits enforced: TikTok ≤ 150, Instagram ≤ 300, LinkedIn ≤ 700)
- Market cron duplicate guard (skips if non-rejected record exists for current period)
- Market cron data-insufficient guard (skips if fewer than 10 transactions)
- Testimonial token generation and expiry validation
- Testimonial re-submission rejected if not `pending_submission`
- Referral code uniqueness
- Referral status transition logic (link_generated → clicked → lead_created → transaction_completed)
- Referral clickCount uses atomic increment

### Integration tests

- Video tutorials CRUD and reorder
- Market content generation and approval flow
- Market content manual trigger returns 409 on duplicate
- Testimonial submission via token → review → approval → public display
- Testimonial submission via expired token returns error
- Testimonial removal hard-deletes record and writes audit log entry
- Referral tracking: first click transitions status to `clicked`, click count increments
- Referral tracking: lead linkage sets leadSource and referredSellerId
- Referral transaction conversion updates status to `transaction_completed`

### Compliance tests

- Testimonial removal audit log entry is written (`action: testimonial_removed`) with `sellerId` in `details`
- DNC check is invoked before WhatsApp send in testimonial cron
- DNC check is invoked before WhatsApp send in referral cron
- `seller.notificationPreference` is checked before sending email/WhatsApp in both crons
- Review queue displays `Weekly Market Summary (period)` for cross-town aggregate MarketContent records (`town === "ALL"`)
- PDPA deletion cascade: `hardDeleteSeller` deletes Testimonial and referralsGiven, nullifies referredSellerId on referralsReceived

## 8. New SystemSettings

| Key | Default | Description |
|-----|---------|-------------|
| `market_content_schedule` | `0 8 * * 1` | Cron expression for weekly market content job (Monday 8am SGT) |
| `post_completion_testimonial_delay_days` | `7` | Days after completion to send testimonial request |
| `post_completion_referral_delay_days` | `14` | Days after completion to send referral link |
