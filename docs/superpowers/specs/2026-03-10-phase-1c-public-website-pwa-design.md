# Phase 1C Design Spec: Public Website, HDB Market Report, Lead Capture & PWA

**Date:** 2026-03-10
**Status:** Approved

## Overview

Build the public-facing website for sellmyhomenow.sg: homepage (landing page), HDB Market Report tool, lead capture form, privacy policy, terms of service, cookie consent banner, and Progressive Web App (PWA) support.

## Brand

- Ink: #1a1a2e (dark navy)
- Accent: #c8553d (terracotta)
- Background: #fafaf7 (warm off-white)
- Agent: (David) Ng Chun Fai, CEA Reg No. R011998B
- Agency: Huttons Asia Pte Ltd, CEA Licence No. L3008899K

## 1. Routes

| Route | Method | Page/Handler | Description |
|-------|--------|-------------|-------------|
| `/` | GET | Homepage | Landing page |
| `/market-report` | GET | HDB Market Report | Search form + results page |
| `/privacy` | GET | Privacy Policy | Static legal text |
| `/terms` | GET | Terms of Service | Static legal text |
| `/api/leads` | POST | Lead capture | Processes lead form, returns HTMX partial or JSON |
| `/api/hdb/report` | GET | HDB report data | Returns price stats + recent transactions as HTMX partial |

## 2. Domain Modules

### 2.1 Public Domain (`src/domains/public/`)

Thin routing layer — serves templates, no business logic.

- `public.router.ts` — serves homepage, market report page, privacy, terms
- Homepage: renders `pages/public/home.njk`
- Market report: queries HDB service for distinct town/flatType/storeyRange values, passes to template
- Privacy/terms: renders static templates

### 2.2 Lead Domain (`src/domains/lead/`)

Full domain module for lead capture.

- `lead.types.ts` — `LeadInput` interface, `LeadSource` type (website/tiktok/instagram/referral/walkin/other)
- `lead.validator.ts` — validation rules:
  - Name: required, non-empty
  - Phone: 8 digits, starts with 8 or 9 (Singapore mobile)
  - Service consent: must be true
  - Honeypot: hidden field must be empty
  - Timing: reject submissions under 3 seconds (bot detection)
- `lead.service.ts` — business logic:
  - Check for duplicate phone (existing lead/engaged/active seller)
  - Create Seller record (status: `lead`, `agentId: null` — assigned later by agent, leadSource from UTM/referrer)
  - Create ConsentRecord (service consent required, marketing consent optional)
  - Log to AuditLog
  - Notify agent: look up agents with `role: admin` and send in-app notification. If no admin agents exist, log a warning.
- `lead.repository.ts` — Prisma operations: find seller by phone, create seller, create consent record
- `lead.router.ts` — `POST /api/leads` with dedicated rate limiter (3 submissions/hour/IP), separate from the global API rate limiter

### 2.3 HDB Domain (existing — `src/domains/hdb/`)

`getMarketReport()` already exists in `service.ts` with tests. Extend it to support the storey range filter and ensure it returns the data the template needs.

- `service.ts` — update existing `getMarketReport()` to accept optional `storeyRange` parameter
- `repository.ts` — add `getDistinctStoreyRanges()` for populating the dropdown; update `findTransactions()` to support optional storey range filter
- Recent transactions: top 5 most recent by month, then sorted by price descending
- Date range mapping: 6M=6, 1Y=12, 2Y=24 (default), 5Y=60, 10Y=120, 20Y=240, All=0 (no date filter applied)

Note: HDB domain files use `service.ts`/`repository.ts` naming (without `hdb.` prefix) from Phase 1A. Retain existing naming for consistency within the domain.

## 3. Homepage Layout

Sections in order:

1. **Header** — dark nav (#1a1a2e): "SellMyHome**Now**.sg" logo, nav links (Market Report, Login), "Get Started" pill button (accent). The dark header is specific to the public layout. Create a separate `partials/public/header.njk` for public pages; the existing `partials/header.njk` remains for authenticated layouts.
2. **Hero** — dark background, "Sell Your HDB for **$1,499**" ($1,499 in accent), subtitle, dual CTAs: "Get Started" (accent pill) + "Free Market Report" (dark pill)
3. **Accent bar** — 4px #c8553d strip
4. **How It Works** — 3 cards with numbered accent circles:
   - 1: Tell Us About Your Flat
   - 2: We Guide You
   - 3: Sell & Save
5. **Why SellMyHomeNow.sg?** — 2×2 grid with accent icon squares:
   - Fixed Fee: $1,499 + GST
   - Licensed Agent Guidance
   - AI-Powered Tools
   - Pay Only on Completion
6. **Get Started** — Lead capture form (Full Name, Mobile Number, PDPA consent checkboxes, Submit)
7. **Footer** — 3 columns: brand description, Quick Links (HDB Market Report, Privacy Policy, Terms of Service), Regulatory (Huttons, CEA licence, agent name + CEA reg)

"Get Started" CTA scrolls to the lead capture section. "Free Market Report" links to `/market-report`.

**Layout note:** The homepage has full-width sections (hero, accent bar, dark backgrounds). The `public.njk` layout's `max-w-7xl` wrapper is too restrictive. The homepage should extend `base.njk` directly and manage its own width per section. Other public pages (privacy, terms, market report) can use `public.njk`.

## 4. HDB Market Report Page

Own page at `/market-report` (not inline on homepage).

**Search form:**
- Town dropdown — populated from distinct HdbTransaction towns
- Flat Type dropdown — populated from distinct flat types
- Storey Range dropdown — populated from distinct storey ranges
- Search button — `hx-get="/api/hdb/report"` swaps results into target div
- Date Range slider — default 2Y, options: 6M, 1Y, 2Y, 5Y, 10Y, 20Y, All

**Results partial** (HTMX swap):
- 4 stat cards: Transactions count, Min Price, Median Price (accent highlight), Max Price
- Average Price per sqm row
- Recent Transactions table: Block, Street, Storey, Model, Price — top 5, sorted by price desc
- Disclaimer: "This is an indicative range based on publicly available HDB resale data and does not constitute a formal valuation. Data source: data.gov.sg."

**Dropdown population:** Pre-query distinct values on page load in the public router, pass to template.

## 5. Lead Capture Form

**Fields:**
- Full Name (required)
- Mobile Number (required, placeholder: 91234567)

Email is not collected at lead stage. It is captured during seller onboarding (Phase 2).

**PDPA consent checkboxes:**
- "I consent to SellMyHomeNow.sg collecting and using my personal data to provide property selling services. [Privacy Policy link] *" (required)
- "I consent to receiving marketing communications about property market updates. (Optional)"

**Spam protection:**
- Honeypot hidden field (reject if filled)
- Time-based validation (reject if submitted in < 3 seconds)
- Rate limit: 3 submissions per hour per IP

**UTM tracking:** Hidden field captures leadSource from URL params (`?utm_source=tiktok`) or defaults to `website`.

**Success response:** HTMX swaps form with success message partial.

## 6. Privacy Policy & Terms of Service

Draft placeholder content based on Phase 1 requirements. Marked clearly as drafts to be replaced with lawyer-reviewed text.

**Privacy Policy** covers: data collection (name, phone, email, HDB details), purpose (property selling services), PDPA rights (access, correction, deletion), data retention, third-party sharing (Huttons, HDB portals), cookies (essential only), contact info.

**Terms of Service** covers: service description ($1,499 fixed fee), non-exclusive engagement, payment terms (pay on completion only), cancellation (seller can terminate any time), limitation of liability (no formal valuations, no financial advice, estimates only), intellectual property, governing law (Singapore), dispute resolution.

## 7. Cookie Consent Banner

Simple informational bottom banner: "This site uses essential cookies only." with "OK" dismiss button. No tracking cookies — no opt-in needed. Dismissal stored in localStorage to hide on return visits.

## 8. PWA

**manifest.json** (`public/manifest.json`):
- name: "SellMyHomeNow.sg", short_name: "SellMyHome"
- start_url: "/", display: "standalone"
- background_color: "#fafaf7", theme_color: "#1a1a2e"
- Icons: 192x192, 512x512, 512x512 maskable

**Service worker** (`public/sw.js`):
- Strategy: Network First with Cache Fallback
- Pre-cache on install: homepage, market report page, offline fallback, CSS, app icons
- Do NOT cache: API responses, authenticated pages, personal data
- Offline fallback: `public/offline.html`
- Cache versioning: bump cache name on deploy

**Base layout updates** (`src/views/layouts/base.njk`):
- `<link rel="manifest" href="/manifest.json">`
- `<meta name="theme-color" content="#1a1a2e">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<link rel="apple-touch-icon" href="/icons/icon-192.png">`
- Service worker registration script

**App icons:** Placeholder SVG-based icons using brand colours with "SMH" text. Replace with designed icons later.

**CSP:** The existing CSP in `app.ts` allows `'self'` for scripts and `'unsafe-inline'`, which is sufficient for service worker registration. Explicitly add `worker-src: 'self'` to CSP directives for clarity.

## 9. Testing

### Unit Tests
- `lead.service` — creates seller + consent record, rejects missing service consent, rejects duplicate phone, detects honeypot, rejects fast submissions
- `lead.validator` — valid/invalid phone formats, empty name, honeypot detection
- `hdb.service.getMarketReport` — correct aggregates, date range filtering, optional storey range, empty results

### Integration Tests
- `POST /api/leads` — success with consent, rejects without consent, rejects duplicate phone, rate limited
- `GET /api/hdb/report` — correct stats for known town/type, handles unknown town, respects date range
- `GET /` — returns 200
- `GET /market-report` — returns 200 with populated dropdowns
- `GET /privacy` — returns 200
- `GET /terms` — returns 200

### E2E Tests (deferred to Phase 1 completion)
- Homepage loads, nav links work
- Market report form → results display
- Lead form submission with consent
- PWA: manifest served, service worker registers

## 10. File Changes

### New Files
- `src/domains/public/public.router.ts`
- `src/domains/lead/lead.types.ts`
- `src/domains/lead/lead.validator.ts`
- `src/domains/lead/lead.service.ts`
- `src/domains/lead/lead.repository.ts`
- `src/domains/lead/lead.router.ts`
- `src/domains/lead/__tests__/lead.service.test.ts`
- `src/domains/lead/__tests__/lead.validator.test.ts`
- `src/views/pages/public/home.njk`
- `src/views/pages/public/market-report.njk`
- `src/views/pages/public/privacy.njk`
- `src/views/pages/public/terms.njk`
- `src/views/partials/public/report-results.njk`
- `src/views/partials/public/lead-success.njk`
- `public/manifest.json`
- `public/sw.js`
- `public/offline.html`
- `public/icons/` (placeholder icons)
- `tests/integration/public.test.ts`
- `tests/integration/lead.test.ts`

### New Files (additional)
- `src/views/partials/public/header.njk` — dark nav header for public pages
- `src/views/partials/public/footer.njk` — 3-column footer with regulatory info

### Modified Files
- `src/domains/hdb/service.ts` — update `getMarketReport()` to accept storey range filter
- `src/domains/hdb/repository.ts` — add `getDistinctStoreyRanges()`, update `findTransactions()` for storey range
- `src/domains/hdb/__tests__/service.test.ts` — tests for storey range filter
- `src/infra/http/app.ts` — register public + lead routers, add `worker-src: 'self'` to CSP
- `src/views/layouts/base.njk` — PWA meta tags + service worker registration
- `src/views/layouts/public.njk` — include public-specific header/footer partials
- `tests/fixtures/factory.ts` — add lead/consent factories

### Not Changed
- Prisma schema (Seller, ConsentRecord, HdbTransaction already exist)
- Notification domain (reused as-is)
