# SellMyHouse.sg — Phase 6: Content, Video, Testimonials & Referrals
# Prerequisites: Phases 1-5 must be complete. Read phase-0-shared-context.md for schema reference.
# This phase builds: video tutorial management, market data content engine,
# testimonial management, referral program.

## Phase 6: Content & Video Integration

### 6.1 Video Tutorial Management
Admin CRUD, categories (Photography/Forms/Process/Financial), YouTube embeds, seller viewing tracking.

### 6.2 Market Data Content Engine
Weekly scheduled job: top towns, million-dollar flats, price trends. AI narrative. Agent review. Export formatted for TikTok/Instagram/LinkedIn with source attribution.

### Tests for Phase 6:
```
Unit Tests:
- Market data aggregation accuracy
- Content export formatting per platform

Integration Tests:
- Video tutorials display correctly
- Market content generation and approval flow
```


---

## Phase 6 Additions (from Addendum)

## Phase 6 Additions

### 6.3 Testimonial Management
- Post-completion (day 7): system sends testimonial request to seller via WhatsApp + email
- Link takes seller to a simple form: rating (1-5 stars), written testimonial, display name (defaults to first name + last initial, e.g., "John T."), display town (e.g., "Seller in Tampines")
- Submitted testimonials stored in `Testimonial` model with status `pending_review`
- Agent/admin reviews → approves or rejects
- Approved testimonials with `displayOnWebsite: true` appear on the sellmyhouse.sg landing page in a testimonials section
- Admin can feature/unfeature testimonials from the dashboard
- Seller can request removal of their testimonial at any time (PDPA — their data)

### 6.4 Referral Program
- After transaction completion (day 14, same time as buyer follow-up): seller receives a unique referral link
- Referral link format: `sellmyhouse.sg/?ref={referralCode}`
- When someone visits via referral link:
  - `Referral.clickCount` incremented
  - Referral code stored in session/cookie
  - If visitor submits lead form: `Seller.leadSource` set to "referral", `Referral.status` updated to `lead_created`, `Referral.referredSellerId` linked
  - If referred lead completes a transaction: `Referral.status` updated to `transaction_completed`
- Admin analytics: referral conversion funnel (links generated → clicked → leads → completed transactions)
- Admin can see top referrers
- Note: NO cash incentive or commission sharing for referrals (prohibited by CEA PC 04/2018 — no benefits to induce engagement). The referral program is purely for tracking and organic word-of-mouth. The seller's incentive is simply helping friends save money.

---
