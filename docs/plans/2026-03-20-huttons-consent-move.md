# Huttons Consent: Move to Onboarding Step 5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `consentHuttonsTransfer` from the lead capture form and registration form, then collect it as an append-only `ConsentRecord` at onboarding step 5 (EAA review).

**Architecture:** Three independent removal tasks (lead domain, auth domain, views) followed by one addition task (step 5). The compliance repository already has `purposeHuttonsTransfer` on `ConsentRecord` — no migration needed. A new service wrapper keeps the router clean.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest

---

### Task 1: Remove consentHuttonsTransfer from lead domain

**Files:**
- Modify: `src/domains/lead/lead.types.ts`
- Modify: `src/domains/lead/lead.validator.ts`
- Modify: `src/domains/lead/lead.router.ts`
- Modify: `src/domains/lead/lead.service.ts`
- Modify: `src/domains/lead/lead.repository.ts`
- Test: `src/domains/lead/__tests__/lead.validator.test.ts`
- Test: `src/domains/lead/__tests__/lead.service.test.ts`
- Test: `tests/integration/lead.test.ts`

**Step 1: Update the failing tests first**

In `src/domains/lead/__tests__/lead.validator.test.ts`:
- Remove `consentHuttonsTransfer: true` from the `validInput` fixture (line ~11)
- Delete the test case "rejects missing Huttons transfer consent" (the test around line 122 that tests `consentHuttonsTransfer: false`)

In `src/domains/lead/__tests__/lead.service.test.ts`:
- Remove `consentHuttonsTransfer: true` from all `LeadInput` fixture objects (lines ~30, ~89)

In `tests/integration/lead.test.ts`:
- Remove `consentHuttonsTransfer: 'true'` from ALL `.send({...})` calls in every test case
- The existing consent record assertion (`purposeService: true`) can remain — it tests service consent, not Huttons transfer

**Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="lead.validator|lead.service" 2>&1 | tail -20
```

Expected: FAIL — TypeScript compile errors about `consentHuttonsTransfer` missing from LeadInput.

**Step 3: Update lead.types.ts**

Remove `consentHuttonsTransfer: boolean;` from `LeadInput`.

Before:
```typescript
export interface LeadInput {
  name: string;
  countryCode: string;
  nationalNumber: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  consentHuttonsTransfer: boolean;
  leadSource: LeadSource;
  honeypot?: string;
  formLoadedAt?: number;
  ipAddress?: string;
  userAgent?: string;
}
```

After: remove the `consentHuttonsTransfer: boolean;` line.

**Step 4: Update lead.validator.ts**

Remove the guard that rejects missing Huttons transfer consent. Find the block (~line 44):
```typescript
if (!input.consentHuttonsTransfer) {
  return {
    valid: false,
    errors: {
      consentHuttonsTransfer:
        ...
    },
  };
}
```
Delete it entirely.

**Step 5: Update lead.router.ts**

Remove the line parsing `consentHuttonsTransfer` from `req.body`:
```typescript
consentHuttonsTransfer:
  req.body.consentHuttonsTransfer === 'true' || req.body.consentHuttonsTransfer === true,
```
Also remove it from the object passed to the validator/service call.

**Step 6: Update lead.service.ts**

Remove `consentHuttonsTransfer: input.consentHuttonsTransfer,` from the data passed to the repository (~line 32 and ~line 64).

**Step 7: Update lead.repository.ts**

In `SellerLeadInput` type (~line 84): remove `consentHuttonsTransfer: boolean;`

In `submitLeadAtomically` function (~line 106): remove `purposeHuttonsTransfer: data.consentHuttonsTransfer,`

In `createSellerLead` function (~line 56): if `purposeHuttonsTransfer?: boolean` is in its input type, remove it. Change `purposeHuttonsTransfer: data.purposeHuttonsTransfer ?? false` to just omit the field entirely (letting the Prisma default of `false` apply).

**Step 8: Run tests**

```bash
npm test -- --testPathPattern="lead" 2>&1 | tail -20
```

Expected: PASS

**Step 9: Commit**

```bash
git add src/domains/lead/lead.types.ts src/domains/lead/lead.validator.ts \
  src/domains/lead/lead.router.ts src/domains/lead/lead.service.ts \
  src/domains/lead/lead.repository.ts \
  src/domains/lead/__tests__/lead.validator.test.ts \
  src/domains/lead/__tests__/lead.service.test.ts \
  tests/integration/lead.test.ts
git commit -m "refactor(lead): remove consentHuttonsTransfer from lead capture"
```

---

### Task 2: Remove consentHuttonsTransfer from auth domain

**Files:**
- Modify: `src/domains/auth/auth.types.ts`
- Modify: `src/domains/auth/auth.validator.ts`
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/auth.registration.router.ts`
- Test: `src/domains/auth/__tests__/auth.service.test.ts`
- Test: `src/domains/auth/__tests__/auth.router.test.ts`

**Step 1: Update the failing tests first**

In `src/domains/auth/__tests__/auth.service.test.ts`:
- Remove `consentHuttonsTransfer: true` from the `RegistrationInput` fixture (lines ~38, ~703)
- If there is a test case asserting that registration fails when `consentHuttonsTransfer: false`, delete that test

In `src/domains/auth/__tests__/auth.router.test.ts`:
- Remove `consentHuttonsTransfer: 'true'` from form body (~line 98)

**Step 2: Run tests to see failures**

```bash
npm test -- --testPathPattern="auth.service|auth.router" 2>&1 | tail -20
```

Expected: FAIL — TypeScript errors about missing field.

**Step 3: Update auth.types.ts**

In `RegistrationInput`, remove `consentHuttonsTransfer: boolean;` (line ~19).

**Step 4: Update auth.validator.ts**

Remove the express-validator rule for `consentHuttonsTransfer` (~line 14). It will look like:
```typescript
body('consentHuttonsTransfer')
  .equals('true')
  .withMessage('...'),
```
Delete it.

**Step 5: Update auth.service.ts**

Remove the guard at ~line 33:
```typescript
if (!input.consentHuttonsTransfer) {
  throw new ValidationError({ consentHuttonsTransfer: '...' });
}
```

Remove the field from the `ConsentRecord` creation at ~line 60:
```typescript
purposeHuttonsTransfer: input.consentHuttonsTransfer,
```
Change to: `purposeHuttonsTransfer: false,` (registration still creates a ConsentRecord, it just defaults to false for Huttons consent since that's collected at step 5).

**Step 6: Update auth.registration.router.ts**

Remove the lines parsing `consentHuttonsTransfer` from `req.body` (~lines 52-53):
```typescript
consentHuttonsTransfer:
  req.body.consentHuttonsTransfer === 'true' || req.body.consentHuttonsTransfer === 'on',
```

**Step 7: Run tests**

```bash
npm test -- --testPathPattern="auth" 2>&1 | tail -20
```

Expected: PASS

**Step 8: Commit**

```bash
git add src/domains/auth/auth.types.ts src/domains/auth/auth.validator.ts \
  src/domains/auth/auth.service.ts src/domains/auth/auth.registration.router.ts \
  src/domains/auth/__tests__/auth.service.test.ts \
  src/domains/auth/__tests__/auth.router.test.ts
git commit -m "refactor(auth): remove consentHuttonsTransfer from registration"
```

---

### Task 3: Remove consentHuttonsTransfer from views

**Files:**
- Modify: `src/views/pages/public/home.njk`
- Modify: `src/views/pages/auth/register.njk`

No tests for templates — verify visually or run unit tests to confirm no regressions.

**Step 1: Update home.njk**

Find and remove the entire `consentHuttonsTransfer` checkbox block in the `#get-started` form. It will look like:
```html
<div class="...">
  <input type="checkbox" name="consentHuttonsTransfer" ...>
  <label ...>I consent to my personal data being transferred to Huttons Asia Pte Ltd...</label>
</div>
```
Delete the whole block.

**Step 2: Update register.njk**

Find and remove the `consentHuttonsTransfer` checkbox block (~lines 66-74):
```html
<div class="flex items-start">
  <input type="checkbox" id="consentHuttonsTransfer" name="consentHuttonsTransfer" value="true" required ...>
  <label for="consentHuttonsTransfer" ...>...</label>
</div>
{% if errors and errors.consentHuttonsTransfer %}
  <p ...>{{ errors.consentHuttonsTransfer }}</p>
{% endif %}
```
Delete the whole block including the error display.

**Step 3: Run unit tests to confirm no regressions**

```bash
npm test 2>&1 | tail -10
```

Expected: All passing (same count as before).

**Step 4: Commit**

```bash
git add src/views/pages/public/home.njk src/views/pages/auth/register.njk
git commit -m "refactor(views): remove Huttons consent checkbox from lead form and registration"
```

---

### Task 4: Add Huttons consent to onboarding step 5

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/seller/seller.router.ts`
- Modify: `src/views/partials/seller/onboarding-step-5.njk`
- Modify: `public/js/app.js`
- Test: `src/domains/seller/__tests__/seller.router.test.ts`
- Test: `tests/integration/seller-dashboard.test.ts`

**Step 1: Add service wrapper to compliance.service.ts**

At the end of the exported functions in `compliance.service.ts`, add:

```typescript
export async function recordHuttonsTransferConsent(sellerId: string): Promise<void> {
  await complianceRepo.createConsentRecord({
    subjectId: sellerId,
    purposeService: true,
    purposeMarketing: false,
    purposeHuttonsTransfer: true,
  });
}
```

Note: `purposeService: true` and `purposeMarketing: false` are copied from the existing consent state. This is an _additional_ record expressing the Huttons transfer consent specifically — the append-only model means previous consent records remain authoritative for service/marketing purposes. However, since `createConsentRecord` requires `purposeService` and `purposeMarketing`, pass `true` and `false` as defaults (they will not override the seller's existing consent — the latest record per purpose is used by `findSellerConsent`). Actually, to avoid any risk of resetting consent values, read the existing values first:

```typescript
export async function recordHuttonsTransferConsent(sellerId: string): Promise<void> {
  const existing = await complianceRepo.findSellerConsent(sellerId);
  await complianceRepo.createConsentRecord({
    subjectId: sellerId,
    purposeService: existing?.consentService ?? true,
    purposeMarketing: existing?.consentMarketing ?? false,
    purposeHuttonsTransfer: true,
  });
}
```

**Step 2: Write the failing unit test in seller.router.test.ts**

First, find the existing mock setup at the top of `seller.router.test.ts`. There will be a `jest.mock(...)` call for services used by the router. Add a mock for compliance service if it's not there:

```typescript
jest.mock('@/domains/compliance/compliance.service', () => ({
  recordHuttonsTransferConsent: jest.fn().mockResolvedValue(undefined),
}));
```

Then add to the `POST /seller/onboarding/step/:step` describe block:

```typescript
it('records Huttons transfer consent when completing step 5', async () => {
  const mockedComplianceService = jest.requireMock('@/domains/compliance/compliance.service');
  mockedComplianceService.recordHuttonsTransferConsent.mockResolvedValue(undefined);
  mockedService.completeOnboardingStep.mockResolvedValue({
    onboardingStep: TOTAL_ONBOARDING_STEPS,
  });

  const res = await request(app)
    .post(`/seller/onboarding/step/5`)
    .set('HX-Request', 'true');

  expect(res.status).toBe(200);
  expect(mockedComplianceService.recordHuttonsTransferConsent).toHaveBeenCalledWith('seller-1');
});
```

**Step 3: Run test to see it fail**

```bash
npm test -- --testPathPattern="seller.router" 2>&1 | tail -20
```

Expected: FAIL — `recordHuttonsTransferConsent` is never called.

**Step 4: Update seller.router.ts to call the service**

Add the compliance service import at the top of `seller.router.ts`:
```typescript
import * as complianceService from '../compliance/compliance.service';
```

In the POST `/seller/onboarding/step/:step` handler, find the step 5 block. Currently it falls through to the generic `completeOnboardingStep` call. Add a specific handler for step 5 just before the generic call:

```typescript
if (step === 5) {
  await complianceService.recordHuttonsTransferConsent(sellerId);
}

const result = await sellerService.completeOnboardingStep({
  sellerId,
  step,
});
```

**Step 5: Run unit test to see it pass**

```bash
npm test -- --testPathPattern="seller.router" 2>&1 | tail -20
```

Expected: PASS

**Step 6: Update the template — onboarding-step-5.njk**

Add a second checkbox after the existing "I have watched the video" checkbox, before the `<button>`:

```html
<label class="flex items-start gap-2 mb-4">
  <input type="checkbox" id="huttons-consent-checkbox" class="mt-1 rounded border-gray-300" data-action="toggle-complete-btn">
  <span class="text-sm text-gray-700">{{ "I consent to my personal data being transferred to Huttons Asia Pte Ltd for the purpose of processing my HDB resale transaction." | t }}</span>
</label>
```

Full updated `<div class="mt-6">` section:

```html
<div class="mt-6">
  <label class="flex items-start gap-2 mb-4">
    <input type="checkbox" id="agreement-checkbox" class="mt-1 rounded border-gray-300" data-action="toggle-complete-btn">
    <span class="text-sm text-gray-700">{{ "I have watched the video and understand the terms" | t }}</span>
  </label>

  <label class="flex items-start gap-2 mb-4">
    <input type="checkbox" id="huttons-consent-checkbox" class="mt-1 rounded border-gray-300" data-action="toggle-complete-btn">
    <span class="text-sm text-gray-700">{{ "I consent to my personal data being transferred to Huttons Asia Pte Ltd for the purpose of processing my HDB resale transaction." | t }}</span>
  </label>

  <button
    id="complete-btn"
    hx-post="/seller/onboarding/step/5"
    hx-target="#onboarding-step"
    hx-swap="innerHTML"
    class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
    disabled
  >
    {{ "Complete Onboarding" | t }}
  </button>
</div>
```

**Step 7: Fix toggle-complete-btn JS in app.js**

The current logic (~line 392) only checks the single checkbox that fired the event:
```javascript
if (action === 'toggle-complete-btn') {
  var completeBtn = document.getElementById('complete-btn');
  if (completeBtn) completeBtn.disabled = !el.checked;
}
```

Replace with a check of ALL `data-action="toggle-complete-btn"` checkboxes:
```javascript
if (action === 'toggle-complete-btn') {
  var completeBtn = document.getElementById('complete-btn');
  if (completeBtn) {
    var allChecked = Array.from(
      document.querySelectorAll('[data-action="toggle-complete-btn"]')
    ).every(function (cb) { return cb.checked; });
    completeBtn.disabled = !allChecked;
  }
}
```

**Step 8: Update the integration test**

In `tests/integration/seller-dashboard.test.ts`, find the test "completes steps 1-5 sequentially and redirects to dashboard" (~line 150). After the loop, add a DB assertion that a ConsentRecord with `purposeHuttonsTransfer: true` was created for the seller:

```typescript
// Verify Huttons transfer consent was recorded at step 5
const consentRecord = await testPrisma.consentRecord.findFirst({
  where: { sellerId: seller.id, purposeHuttonsTransfer: true },
});
expect(consentRecord).not.toBeNull();
```

**Step 9: Run all tests**

```bash
npm test 2>&1 | tail -20
```

Expected: All passing.

**Step 10: Commit**

```bash
git add src/domains/compliance/compliance.service.ts \
  src/domains/seller/seller.router.ts \
  src/views/partials/seller/onboarding-step-5.njk \
  public/js/app.js \
  src/domains/seller/__tests__/seller.router.test.ts \
  tests/integration/seller-dashboard.test.ts
git commit -m "feat(onboarding): collect Huttons transfer consent at step 5 EAA review"
```
