# Spec: Merge CDD Status + Consent into single Compliance card

**Date:** 2026-03-17
**Scope:** `seller-detail.njk` and `compliance-cdd-card.njk`

## What changes

On `/agent/sellers/:id`, the two separate cards — "CDD Status" (box #3) and "Consent" (box #6) — are merged into one card titled **"Compliance"**.

### Layout

Single card, stacked with a horizontal divider:

1. **Consent** (top section)
   - Service consent: ✓ / ✗
   - Marketing consent: ✓ / ✗
   - If withdrawn: withdrawal date in red
2. `<hr>` divider
3. **CDD Status** (bottom section)
   - All existing states and behaviour unchanged (dropdown, verify modal, admin unlock, locked badge)

### Text change

Remove the brand name from the CDD pending warning. Change:

> "CDD must be marked Verified in Huttons' system before you can proceed to the Estate Agency Agreement."

To:

> "CDD must be marked Verified before you can proceed to the Estate Agency Agreement."

## Files affected

- `src/views/pages/agent/seller-detail.njk` — remove separate CDD and Consent cards; add merged "Compliance" card containing both sections inline
- `src/views/partials/agent/compliance-cdd-card.njk` — update warning text only

## What does NOT change

- All CDD logic (HTMX patch, verify modal, admin bypass, locked state)
- Consent data rendering logic
- All other cards on the page
- Any backend code
