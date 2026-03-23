# Photos Sidebar Fix + Onboarding Guard

**Date:** 2026-03-23
**Status:** Approved

## Problem

1. The Photos sidebar link in `src/views/layouts/seller.njk` points to `/seller/onboarding` instead of `/seller/photos`
2. Sellers who have completed onboarding can still navigate directly to `/seller/onboarding` and see the wizard
3. Sellers who haven't completed onboarding can access dashboard features (Property, Photos, Viewings, Documents, Financial Report) via sidebar links

## Changes

### Change 1: Fix sidebar href

**File:** `src/views/layouts/seller.njk:22`

Change Photos link from `/seller/onboarding` to `/seller/photos`.

### Change 2: Redirect completed onboarding

**File:** `src/domains/seller/seller.router.ts` — `GET /seller/onboarding` handler

If `status.isComplete`, redirect to `/seller/dashboard` instead of rendering the onboarding page.

### Change 3: Disable sidebar items during onboarding

**Middleware** (`src/domains/seller/seller.router.ts`): Call `getOnboardingStatus()` in the existing `/seller` middleware and set `res.locals.onboardingComplete`.

**Sidebar** (`src/views/layouts/seller.njk`): When `not onboardingComplete`, render these items as `<span>` elements (no `<a>`, no href) with muted/disabled styling:
- Property
- Photos
- Viewings
- Documents
- Financial Report

Items always enabled regardless of onboarding status:
- Overview (redirects to onboarding anyway)
- Video Tutorials
- Notifications
- Settings
- My Data
