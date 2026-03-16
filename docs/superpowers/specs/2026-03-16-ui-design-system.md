# UI Design System — Consistent Page Layout
**Date:** 2026-03-16
**Status:** Approved
**Scope:** All admin, agent, and seller portal pages (detail, dashboard, single-focus, settings)

---

## Goal

Apply the layout structure from `/admin/sellers` detail page consistently across every non-public page in the platform. The visual card style (rounded-lg, border-gray-200, shadow-sm) is unchanged — this spec covers layout structure and shared partials only.

---

## What Changes

### Not changing
- Card visual style (`.card` stays as-is: `rounded-lg border border-gray-200 shadow-sm p-6`)
- List pages and tables (sellers list, leads list, team list, etc.)
- Forms and multi-step onboarding
- Public pages
- Any router, service, repository, or domain code
- Tests

### New additions
- 1 new Nunjucks partial: `src/views/partials/shared/page-header.njk`
- 3 new CSS classes in `src/infra/styles/input.css`: `.info-grid`, `.page-section`, `.page-section-title`
- ~30 page templates updated to use the new partial and classes

---

## Shared Partials

### `src/views/partials/shared/page-header.njk`

Renders the top of every page: optional back link, h1 title, optional status badge, optional subtitle.

**Variables (set before include):**
- `pageTitle` — required, the h1 text
- `backUrl` — optional, renders `← Back to [backLabel]` link
- `backLabel` — optional (default: "Back"), used with backUrl
- `pageBadge` — optional object `{ text, color }` — renders inline pill badge
- `pageSubtitle` — optional, small gray text below the title row

**Usage:**
```njk
{% set pageTitle = seller.name %}
{% set backUrl = "/admin/sellers" %}
{% set backLabel = "Back to Sellers" %}
{% set pageBadge = { text: seller.status, color: "blue" } %}
{% include "partials/shared/page-header.njk" %}
```

---

## New CSS Classes

Added to the `@layer components` block in `src/infra/styles/input.css`:

```css
.info-grid {
  @apply grid grid-cols-1 md:grid-cols-2 gap-6 mb-6;
}

.page-section {
  @apply mb-6;
}

.page-section-title {
  @apply text-lg font-bold text-gray-900 mb-4;
}
```

**`info-grid`** — wraps pairs of `.card` blocks in a 2-column responsive grid. Collapses to 1 column on mobile.

**`page-section`** — wraps a full-width section (timeline, audit log, notifications, etc.) with consistent bottom spacing.

**`page-section-title`** — the heading inside a page-section.

---

## Page Archetypes

Every page maps to one of four archetypes:

### Type 1 — Detail pages
Back nav + title + status badge + 2-column info grid + full-width sections below.

**Pages:** admin/seller-detail, admin/team (agent detail), agent/seller-detail, agent/transaction

**Structure:**
```
page-header (backUrl + title + badge)
<div class="info-grid">
  [card pair] × N
</div>
<div class="page-section">
  <h2 class="page-section-title">Timeline</h2>
  <div class="card">...</div>
</div>
<div class="page-section">
  <h2 class="page-section-title">Status History</h2>
  <div class="card">...</div>
</div>
```

### Type 2 — Dashboards
Title only (no back nav, no badge) + stat cards row + workflow sections below.

**Pages:** admin/dashboard, agent/dashboard, seller/dashboard

**Structure:**
```
page-header (title only)
[existing stat cards row — unchanged]
<div class="page-section">
  <h2 class="page-section-title">...</h2>
  <div class="card">...</div>
</div>
```

### Type 3 — Single-focus pages
Title + optional back nav + full-width page-sections wrapping cards.

**Pages:** seller/property, seller/documents, seller/financial, seller/photos, seller/my-data, seller/referral, seller/tutorials, seller/case-flags, agent/portals, agent/offers, agent/reviews, agent/leads, agent/sellers, agent/correction-requests, admin/pipeline, admin/audit-log, admin/review-queue, admin/hdb, admin/market-content, admin/referrals, admin/notifications, admin/tutorials

**Structure:**
```
page-header (title, optional backUrl)
<div class="page-section">
  <h2 class="page-section-title">...</h2>
  <div class="card">...</div>
</div>
```

### Type 4 — Settings pages
Title only + grouped form sections.

**Pages:** seller/settings, seller/notifications, agent/settings, admin/settings

**Structure:**
```
page-header (title only)
<div class="page-section">
  <h2 class="page-section-title">Section Label</h2>
  <div class="card">
    [form group]
  </div>
</div>
```

---

## Implementation Order

1. Add CSS classes to `input.css`, rebuild Tailwind
2. Create `partials/shared/page-header.njk`
3. Update Type 1 detail pages (highest visibility, reference: admin/seller-detail)
4. Update Type 2 dashboards
5. Update Type 4 settings pages
6. Update Type 3 single-focus pages (bulk of the work)

---

## Out of Scope

- seller/onboarding (multi-step wizard — separate design)
- Public pages (home, privacy, terms, testimonials)
- auth pages (login, 2FA, forgot password)
- Email templates
