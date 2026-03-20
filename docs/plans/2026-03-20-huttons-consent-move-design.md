# Huttons Consent: Move from Lead/Registration to Onboarding Step 5

**Date:** 2026-03-20
**Status:** Approved

## Problem

`consentHuttonsTransfer` is collected on both the lead capture form and the registration form, but the Huttons data transfer relationship only becomes relevant when a seller is about to sign the Estate Agency Agreement. Collecting it at lead/registration is premature and legally out of context.

## Design

### Section 1: Removals

**Lead form (`src/views/pages/public/home.njk`)**
- Remove the `consentHuttonsTransfer` checkbox entirely
- `ConsentRecord` created at lead capture will have `purposeHuttonsTransfer: false` (existing default)

**Lead backend**
- `lead.validator.ts` — remove `consentHuttonsTransfer` validation rule
- `lead.router.ts` — stop parsing `consentHuttonsTransfer` from req.body
- `lead.service.ts` — stop passing `consentHuttonsTransfer` to repository
- `lead.types.ts` — remove `consentHuttonsTransfer` from `LeadInput`
- `lead.repository.ts` — stop writing `purposeHuttonsTransfer` on the initial ConsentRecord

**Registration form (`src/views/pages/auth/register.njk`)**
- Remove the `consentHuttonsTransfer` required checkbox

**Registration backend**
- `auth.validator.ts` — remove `consentHuttonsTransfer` validation rule
- `auth.service.ts` — remove the `if (!consentHuttonsTransfer) throw ValidationError` guard
- `auth.registration.router.ts` — stop parsing `consentHuttonsTransfer` from req.body
- `auth.types.ts` — remove `consentHuttonsTransfer` from `RegistrationInput`

### Section 2: Additions to Onboarding Step 5

**Template (`src/views/partials/seller/onboarding-step-5.njk`)**

Add a second mandatory checkbox below the existing "I have watched the video" checkbox:

```html
<label class="flex items-start gap-2 mb-4">
  <input type="checkbox" id="huttons-consent-checkbox" class="mt-1 rounded border-gray-300" data-action="toggle-complete-btn">
  <span class="text-sm text-gray-700">
    {{ "I consent to my personal data being transferred to Huttons Asia Pte Ltd for the purpose of processing my HDB resale transaction." | t }}
  </span>
</label>
```

Both checkboxes must be ticked before the Complete Onboarding button enables. The existing `toggle-complete-btn` JS checks all `[data-action="toggle-complete-btn"]` checkboxes — no JS changes needed.

**Backend (`src/domains/seller/seller.router.ts`)**

In the step 5 POST handler, after `completeOnboardingStep` succeeds, create a new `ConsentRecord` via `complianceService.createConsentRecord(sellerId, { purposeHuttonsTransfer: true })`.

This creates an append-only record. `ConsentRecord.purposeHuttonsTransfer` already exists in the schema — no migration needed.

## Notes

- No new database columns required
- Append-only ConsentRecord rule means duplicate submissions are harmless and auditable
- Both checkboxes use the same `data-action="toggle-complete-btn"` pattern — the button only enables when all such checkboxes are ticked
