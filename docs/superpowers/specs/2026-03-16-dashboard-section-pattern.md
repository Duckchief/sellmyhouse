# Dashboard Section Pattern — Design Spec
**Date:** 2026-03-16
**Status:** Approved

## Problem
The agent dashboard uses `<fieldset>` + `<legend>` for section grouping on several pages, and `<h2>` titles inside white cards on others. Both patterns feel dated and are visually inconsistent across agent, admin, and seller views.

## Decision
Adopt **Option A — Flat Cards with Uppercase Section Labels** as the single section pattern across the entire dashboard.

## The Pattern

### HTML Structure
```html
<section class="mb-6">
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Section Title" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6">
    <!-- section content -->
  </div>
</section>
```

### Rules
- Section label: `text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1`
- Card: `bg-white rounded-xl border border-slate-200 p-6`
- No `shadow` or `shadow-sm` on section cards
- No `<fieldset>` + `<legend>` for visual sections (fieldset is still valid for radio/checkbox groups for accessibility — keep semantic-only fieldsets without visual box styling)
- No `<h2>` / `<h3>` section titles inside cards — the label above the card serves this role
- Page background remains `bg-bg` (slate-50, `#f8fafc`)
- Section spacing: `space-y-6` between sections

### Status Badges (unchanged)
Inline `<span>` badges remain inside the card content as before.

## Files to Update

### Agent
- `src/views/pages/agent/seller-detail.njk` — 8 fieldsets → new pattern
- `src/views/pages/agent/settings.njk` — 2 `bg-white shadow rounded-lg` cards with inner h2
- `src/views/pages/agent/transaction.njk` — audit for section cards
- `src/views/pages/agent/offers.njk` — audit for section cards
- `src/views/pages/agent/portals.njk` — audit for section cards
- `src/views/pages/agent/correction-requests.njk` — audit for section cards

### Admin
- `src/views/pages/admin/settings.njk` — grouped sections with inner h2
- `src/views/pages/admin/team.njk` — audit for section cards
- `src/views/pages/admin/hdb.njk` — audit for section cards
- `src/views/pages/admin/market-content.njk` — audit for section cards
- `src/views/pages/admin/tutorials.njk` — audit for section cards

### Seller
- `src/views/pages/seller/settings.njk` — audit for section cards
- `src/views/pages/seller/property.njk` — audit for section cards
- `src/views/pages/seller/financial.njk` — audit for section cards
- `src/views/pages/seller/onboarding.njk` — audit for section cards
- `src/views/pages/seller/my-data.njk` — audit for section cards
- `src/views/partials/seller/settings-notifications.njk` — outer card only (inner fieldset for radio group stays)

## What Does NOT Change
- Auth pages (login, register, 2fa) — not dashboard pages
- Public pages — separate layout
- Email templates
- Semantic `<fieldset>` wrapping radio/checkbox groups (e.g. `settings-notifications.njk`) — keep for accessibility, just ensure no visual box styling
- Logic, routes, TypeScript — zero backend changes

## Success Criteria
- No `<fieldset>` with border/background styling remains on any dashboard page
- No section titles (`<h2>`, `<h3>`) with `font-semibold` inside card containers
- All section cards use `rounded-xl border border-slate-200` (no `shadow`)
- Pattern is visually consistent across agent, admin, and seller views
