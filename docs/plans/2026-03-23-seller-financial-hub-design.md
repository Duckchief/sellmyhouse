# Seller Financial Hub — Design

**Date:** 2026-03-23
**Route:** `GET /seller/financial`

## Summary

A single-page financial hub for sellers that displays their self-service sale proceeds estimate and any agent-approved financial reports. The seller can view and edit their estimate inline. Agent reports appear conditionally when approved/sent reports exist.

## Approach

Approach A: Inline Everything — one route handler, one new partial, refactored calculator form shared between onboarding and the financial hub.

## Route & Data Flow

### `GET /seller/financial`

1. Fetch `SaleProceeds` for the logged-in seller via `sellerService.getSaleProceeds`
2. Fetch `FinancialReport[]` where `sellerId` matches AND status is `approved` or `sent` via `financialService`
3. Fetch commission from SystemSetting (for the edit form)
4. Render `partials/seller/financial-hub.njk` with `{ saleProceeds, reports, commission }`

### `POST /seller/financial/estimate`

- Same validation/logic as the existing step 3 POST handler
- Calls `sellerService.saveSaleProceeds()`
- Returns the updated "My Estimate" section via HTMX swap (not a redirect)

## Template Structure

### `partials/seller/financial-hub.njk`

Two sections on a single scrollable page.

#### "My Estimate" Section

- **Default (read-only):** Summary card showing selling price, deductions breakdown (loan, CPF total, resale levy, other deductions, commission), and net proceeds (green if ≥0, red if <0).
- **"Edit Estimate" button:** HTMX GET loads the calculator form inline, swapping the summary card.
- **Calculator form:** Refactored step 3 form. Same fields, same live JS calculation. POST targets `/seller/financial/estimate`. On save, HTMX swaps back to the updated read-only summary.
- **No data state:** If no SaleProceeds exists, show a "Calculate your estimated proceeds" CTA that loads the form directly.

#### "Agent Reports" Section (Conditional)

- Only rendered if `reports.length > 0`.
- Each report is a read-only summary card showing:
  - Net cash proceeds (prominent, green/red)
  - Total deductions
  - AI narrative text
  - Date calculated and version number
  - Status badge: "Approved" or "Sent to you"
- Standard disclaimer: "This is an estimate only and does not constitute financial advice."

## Calculator Form Refactoring

Extract a shared form partial: `partials/seller/sale-proceeds-form.njk`

- Contains form fields, live calculation display, and submit button
- Accepts `postTarget` variable for `hx-post` URL
- Accepts `swapTarget` variable for `hx-target`
- No onboarding navigation (back/next buttons)

### Usage

- **Onboarding step 3:** Includes the shared form with `postTarget = '/seller/onboarding/step/3'`, adds its own back/next navigation around it.
- **Financial hub edit mode:** Includes the shared form with `postTarget = '/seller/financial/estimate'`, adds a "Cancel" button that swaps back to read-only view.

### Client-Side JS

Existing `calculateProceeds()` in `app.js` works unchanged — binds to `.sale-proceeds-input` class.

## Visibility Rules

- SaleProceeds: always visible to the seller (their own data)
- FinancialReports: only `approved` or `sent` status visible to seller
- Agent controls (approve, send, recalculate) are NOT shown on this page
