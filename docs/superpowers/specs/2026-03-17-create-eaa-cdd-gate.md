# Spec: Gate Create EAA Button on CDD Verified Status

**Date:** 2026-03-17
**Branch:** feature/eaa-activate-button-throb

## Problem

The "Create EAA" button on the seller detail page is always enabled, even when the seller's CDD status is not `verified`. A user could manually remove the `disabled` attribute via DevTools and bypass the UI restriction.

## Solution

Two-layer defence: UI disables and tooltips the button when CDD is not verified; backend rejects the request if CDD is not verified regardless of how the request was made.

## Frontend (`compliance-eaa-card.njk`)

When `compliance.eaa.status == 'not_started'`:

- If `compliance.cdd.status != 'verified'`: render button with `disabled` attribute, gray Tailwind classes (`bg-gray-300 text-gray-500 cursor-not-allowed`), wrapped in `<span title="CDD must be Verified before creating an EAA">` so the tooltip shows on hover (disabled buttons suppress native tooltips in some browsers).
- If `compliance.cdd.status == 'verified'`: render the existing enabled button unchanged.

No new data fetching required — `compliance.cdd.status` is already in template scope.

## Backend (`compliance.service.ts` → `createEaa`)

At the top of `createEaa`, before any DB writes:

1. Call `complianceRepo.findLatestSellerCddRecord(sellerId)` to fetch the CDD record.
2. If no record exists or `identityVerified` is not true, throw `ComplianceError('CDD must be verified before creating an EAA')`.

This guard fires regardless of browser state, closing the DevTools bypass.

## Files Changed

- `src/views/partials/agent/compliance-eaa-card.njk` — conditional button rendering
- `src/domains/compliance/compliance.service.ts` — CDD guard in `createEaa`
- `src/domains/compliance/__tests__/compliance.service.test.ts` — tests for the new guard

## Out of Scope

- No changes to the CDD verification flow itself
- No changes to other EAA status transitions
