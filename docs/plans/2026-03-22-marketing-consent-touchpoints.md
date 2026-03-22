# Marketing Consent Touchpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three in-product marketing consent opt-in touchpoints (onboarding step 4, dashboard prompt after 14 days, settings toggle + My Data grant button) plus a new `POST /seller/compliance/consent/grant` endpoint.

**Architecture:** New `grantMarketingConsent()` in the compliance service, mirroring `withdrawConsent()`. All four touchpoints converge on `POST /seller/compliance/consent/grant`. Dashboard overview gains a `showMarketingPrompt` flag computed from seller age and consent state.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, express-validator, Jest

---

### Task 1: Add types

**Files:**
- Modify: `src/domains/compliance/compliance.types.ts`
- Modify: `src/domains/seller/seller.types.ts`

**Step 1: Add `GrantConsentInput` and `ConsentGrantResult` to compliance types**

In `src/domains/compliance/compliance.types.ts`, add after the `ConsentWithdrawalResult` interface (line 26):

```typescript
export interface GrantConsentInput {
  sellerId: string;
  channel: string; // 'web' | 'email' | 'whatsapp' | 'phone' | 'in_person'
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentGrantResult {
  consentRecordId: string;
}
```

**Step 2: Add `showMarketingPrompt` to `DashboardOverview`**

In `src/domains/seller/seller.types.ts`, add `showMarketingPrompt: boolean;` to the `DashboardOverview` interface (after `totalViewings: number;` on line 48):

```typescript
export interface DashboardOverview {
  seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep' | 'emailVerified'>;
  onboarding: OnboardingStatus;
  propertyStatus: string | null;
  transactionStatus: string | null;
  unreadNotificationCount: number;
  nextSteps: NextStep[];
  property: {
    block: string;
    street: string;
    town: string;
    flatType: string;
    floorAreaSqm: number;
    askingPrice: number;
    status: string;
  } | null;
  caseFlags: Array<{ id: string; flagType: string; description: string }>;
  upcomingViewings: number;
  totalViewings: number;
  showMarketingPrompt: boolean;
}
```

**Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: build errors only for the new fields not yet used (missing `showMarketingPrompt` in service return) — those will be fixed in Task 2. No unexpected errors.

**Step 4: Commit**

```bash
git add src/domains/compliance/compliance.types.ts src/domains/seller/seller.types.ts
git commit -m "feat(consent): add GrantConsentInput and showMarketingPrompt types"
```

---

### Task 2: Add `grantMarketingConsent` to compliance service

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Test: `src/domains/compliance/__tests__/compliance.service.test.ts`

**Step 1: Write the failing tests**

In `src/domains/compliance/__tests__/compliance.service.test.ts`, add a new `describe` block after the `withdrawConsent` tests:

```typescript
describe('grantMarketingConsent', () => {
  it('sets consentMarketing to true and creates a consent record', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: false,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-1' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    const result = await complianceService.grantMarketingConsent({
      sellerId: 'seller-1',
      channel: 'web',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'seller-1',
        purposeMarketing: true,
        purposeService: true,
      }),
    );
    expect(mockRepo.updateSellerConsent).toHaveBeenCalledWith('seller-1', {
      consentMarketing: true,
    });
    expect(result.consentRecordId).toBe('record-1');
  });

  it('throws NotFoundError when seller does not exist', async () => {
    mockRepo.findSellerConsent.mockResolvedValue(null);

    await expect(
      complianceService.grantMarketingConsent({ sellerId: 'missing', channel: 'web' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('is idempotent — can grant when already true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: true,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-2' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    const result = await complianceService.grantMarketingConsent({
      sellerId: 'seller-1',
      channel: 'web',
    });

    expect(result.consentRecordId).toBe('record-2');
  });

  it('writes an audit log entry', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: false,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-3' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    await complianceService.grantMarketingConsent({ sellerId: 'seller-1', channel: 'web' });

    const mockAudit = auditService as jest.Mocked<typeof auditService>;
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.granted',
        entityType: 'seller',
        entityId: 'seller-1',
      }),
    );
  });
});
```

**Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -20
```

Expected: `grantMarketingConsent is not a function` or similar.

**Step 3: Implement `grantMarketingConsent` in compliance service**

In `src/domains/compliance/compliance.service.ts`, add after the `withdrawConsent` function. Import `GrantConsentInput` and `ConsentGrantResult` at the top alongside the existing import of `WithdrawConsentInput`:

```typescript
export async function grantMarketingConsent(
  input: GrantConsentInput,
): Promise<ConsentGrantResult> {
  const currentConsent = await complianceRepo.findSellerConsent(input.sellerId);
  if (!currentConsent) {
    throw new NotFoundError('Seller', input.sellerId);
  }

  // Append-only — always create a new record, even if already consented
  const newRecord = await complianceRepo.createConsentRecord({
    subjectId: input.sellerId,
    purposeService: currentConsent.consentService,
    purposeMarketing: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await complianceRepo.updateSellerConsent(input.sellerId, { consentMarketing: true });

  await auditService.log({
    action: 'consent.granted',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { type: 'marketing', channel: input.channel, consentRecordId: newRecord.id },
  });

  return { consentRecordId: newRecord.id };
}
```

Also update the import in `compliance.service.ts` to include the new types:

```typescript
import type {
  DncChannel,
  MessageType,
  DncAllowedResult,
  WithdrawConsentInput,
  ConsentWithdrawalResult,
  GrantConsentInput,
  ConsentGrantResult,
  // ... other existing imports
} from './compliance.types';
```

**Step 4: Run tests to verify passing**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -20
```

Expected: all compliance service tests pass.

**Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat(consent): add grantMarketingConsent service method"
```

---

### Task 3: Add `showMarketingPrompt` to `getDashboardOverview`

**Files:**
- Modify: `src/domains/seller/seller.service.ts`
- Test: `src/domains/seller/__tests__/seller.service.test.ts`

**Step 1: Write the failing test**

In `src/domains/seller/__tests__/seller.service.test.ts`, find the `getDashboardOverview` describe block and add two new cases:

```typescript
it('sets showMarketingPrompt true when seller is 14+ days old and consentMarketing is false', async () => {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
    ...baseSeller,
    createdAt: fourteenDaysAgo,
    consentMarketing: false,
  } as any);

  const result = await sellerService.getDashboardOverview('seller-1');
  expect(result.showMarketingPrompt).toBe(true);
});

it('sets showMarketingPrompt false when seller is less than 14 days old', async () => {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
    ...baseSeller,
    createdAt: twoDaysAgo,
    consentMarketing: false,
  } as any);

  const result = await sellerService.getDashboardOverview('seller-1');
  expect(result.showMarketingPrompt).toBe(false);
});

it('sets showMarketingPrompt false when consentMarketing is already true', async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  mockedSellerRepo.getSellerWithRelations.mockResolvedValue({
    ...baseSeller,
    createdAt: thirtyDaysAgo,
    consentMarketing: true,
  } as any);

  const result = await sellerService.getDashboardOverview('seller-1');
  expect(result.showMarketingPrompt).toBe(false);
});
```

Note: check the test file to see how `baseSeller` is defined and adapt accordingly.

**Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="seller.service" 2>&1 | tail -20
```

Expected: TypeScript error or test failure — `showMarketingPrompt` not in return value.

**Step 3: Implement in `seller.service.ts`**

In `getDashboardOverview` (around line 61), after computing `caseFlags` and viewing stats, add the `showMarketingPrompt` calculation before the `return` statement:

```typescript
const MARKETING_PROMPT_DELAY_DAYS = 14;
const daysSinceCreation = Math.floor(
  (Date.now() - seller.createdAt.getTime()) / (1000 * 60 * 60 * 24),
);
const showMarketingPrompt =
  !seller.consentMarketing && daysSinceCreation >= MARKETING_PROMPT_DELAY_DAYS;
```

Then add `showMarketingPrompt` to the returned object:

```typescript
return {
  seller: { ... },
  onboarding,
  propertyStatus: firstProperty?.status ?? null,
  transactionStatus: transaction?.status ?? null,
  unreadNotificationCount,
  nextSteps,
  property,
  caseFlags,
  upcomingViewings,
  totalViewings,
  showMarketingPrompt,
};
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="seller.service" 2>&1 | tail -20
```

Expected: all seller service tests pass.

**Step 5: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/__tests__/seller.service.test.ts
git commit -m "feat(consent): add showMarketingPrompt to getDashboardOverview"
```

---

### Task 4: Add grant consent validator and router endpoint

**Files:**
- Modify: `src/domains/compliance/compliance.validator.ts`
- Modify: `src/domains/compliance/compliance.router.ts`
- Test: `src/domains/compliance/__tests__/compliance.router.test.ts` (create if it doesn't exist, or add to existing)

**Step 1: Write the failing router test**

Check if `src/domains/compliance/__tests__/compliance.router.test.ts` exists. If not, create it using the same pattern as `seller.router.test.ts` (mock services, mount router via supertest). Add:

```typescript
describe('POST /seller/compliance/consent/grant', () => {
  it('returns 200 and re-renders consent panel on HTMX grant', async () => {
    mockComplianceService.grantMarketingConsent.mockResolvedValue({
      consentRecordId: 'record-1',
    });
    mockComplianceService.getMyData.mockResolvedValue({
      seller: { consentService: true, consentMarketing: true },
      consentHistory: [],
    } as any);

    const res = await request(app)
      .post('/seller/compliance/consent/grant')
      .set('HX-Request', 'true')
      .send('type=marketing&channel=web');

    expect(res.status).toBe(200);
    expect(mockComplianceService.grantMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: expect.any(String), channel: 'web' }),
    );
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app)
      .post('/seller/compliance/consent/grant')
      .set('HX-Request', 'true')
      .send('type=invalid&channel=web');

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="compliance.router" 2>&1 | tail -20
```

Expected: 404 — route does not exist yet.

**Step 3: Add `grantConsentValidator` to the validator file**

In `src/domains/compliance/compliance.validator.ts`, add after `withdrawConsentValidator`:

```typescript
export const grantConsentValidator = [
  body('type')
    .isIn(['marketing'])
    .withMessage('Only marketing consent can be granted via this endpoint'),
  body('channel')
    .optional()
    .isIn(['web', 'email', 'whatsapp', 'phone', 'in_person'])
    .withMessage('Invalid channel'),
];
```

**Step 4: Add the route to `compliance.router.ts`**

Import `grantConsentValidator` alongside `withdrawConsentValidator`. Add the new route after the withdraw route (after line ~120):

```typescript
// POST /seller/compliance/consent/grant
// Seller grants marketing consent
complianceRouter.post(
  '/seller/compliance/consent/grant',
  requireAuth(),
  requireRole('seller'),
  grantConsentValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const fields = Object.fromEntries(
        Object.entries(errors.mapped()).map(([k, v]) => [k, v.msg as string]),
      );
      return next(new ValidationError('Invalid request', fields));
    }

    try {
      const sellerId = (req.user as { id: string }).id;
      const { channel } = req.body as { channel?: string };

      await complianceService.grantMarketingConsent({
        sellerId,
        channel: (channel as string) ?? 'web',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const myData = await complianceService.getMyData(sellerId);

      if (req.headers['hx-request']) {
        return res.render('partials/compliance/consent-panel', {
          consentService: myData.seller.consentService,
          consentMarketing: myData.seller.consentMarketing,
          consentHistory: myData.consentHistory,
        });
      }

      return res.redirect('/seller/my-data');
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 5: Run tests**

```bash
npm test -- --testPathPattern="compliance.router" 2>&1 | tail -20
```

Expected: all compliance router tests pass.

**Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/domains/compliance/compliance.validator.ts src/domains/compliance/compliance.router.ts src/domains/compliance/__tests__/compliance.router.test.ts
git commit -m "feat(consent): add POST /seller/compliance/consent/grant endpoint"
```

---

### Task 5: Onboarding step 4 — marketing consent checkbox

**Files:**
- Modify: `src/views/partials/seller/onboarding-step-4.njk`
- Modify: `src/domains/seller/seller.router.ts`
- Test: `src/domains/seller/__tests__/seller.router.test.ts`

**Step 1: Write the failing test**

In `src/domains/seller/__tests__/seller.router.test.ts`, add to the onboarding step 4 section:

```typescript
it('grants marketing consent when checkbox is checked on step 4', async () => {
  mockedService.completeOnboardingStep.mockResolvedValue({ onboardingStep: 5 });
  const mockedComplianceService = complianceService as jest.Mocked<typeof complianceService>;
  mockedComplianceService.grantMarketingConsent.mockResolvedValue({ consentRecordId: 'r1' });

  await request(app)
    .post('/seller/onboarding/step/4')
    .send('marketingConsent=on')
    .set('HX-Request', 'true');

  expect(mockedComplianceService.grantMarketingConsent).toHaveBeenCalledWith(
    expect.objectContaining({ channel: 'web' }),
  );
});

it('does not call grantMarketingConsent when checkbox is unchecked on step 4', async () => {
  mockedService.completeOnboardingStep.mockResolvedValue({ onboardingStep: 5 });
  const mockedComplianceService = complianceService as jest.Mocked<typeof complianceService>;
  mockedComplianceService.grantMarketingConsent.mockResolvedValue({ consentRecordId: 'r1' });

  await request(app)
    .post('/seller/onboarding/step/4')
    .send('')
    .set('HX-Request', 'true');

  expect(mockedComplianceService.grantMarketingConsent).not.toHaveBeenCalled();
});
```

**Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="seller.router" 2>&1 | tail -20
```

**Step 3: Update `seller.router.ts` step 4 handler**

In the `POST /seller/onboarding/step/:step` handler, add a step 4 block alongside the existing step 2 and step 5 blocks (add before the `completeOnboardingStep` call):

```typescript
if (step === 4) {
  const { marketingConsent } = req.body as { marketingConsent?: string };
  if (marketingConsent === 'on') {
    await complianceService.grantMarketingConsent({
      sellerId,
      channel: 'web',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
```

**Step 4: Update `onboarding-step-4.njk`**

Replace the current button-only div at the bottom with a form that includes the checkbox:

```nunjucks
<form
  hx-post="/seller/onboarding/step/4"
  hx-target="#onboarding-step"
  hx-swap="innerHTML"
  class="mt-6 space-y-4"
>
  <label class="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      name="marketingConsent"
      value="on"
      class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    >
    <span class="text-sm text-gray-700">
      {{ "Keep me informed about market updates and the referral programme" | t }}
      <span class="block text-xs text-gray-400 mt-0.5">
        {{ "We'll send occasional updates. You can opt out any time in Settings." | t }}
      </span>
    </span>
  </label>

  <button
    type="submit"
    class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition"
  >
    {{ "Continue" | t }}
  </button>
</form>
```

Remove the standalone button that was there before.

**Step 5: Run tests**

```bash
npm test -- --testPathPattern="seller.router" 2>&1 | tail -20
```

Expected: all seller router tests pass.

**Step 6: Commit**

```bash
git add src/views/partials/seller/onboarding-step-4.njk src/domains/seller/seller.router.ts src/domains/seller/__tests__/seller.router.test.ts
git commit -m "feat(consent): add marketing consent checkbox to onboarding step 4"
```

---

### Task 6: Dashboard marketing prompt card

**Files:**
- Create: `src/views/partials/seller/referral-prompt.njk`
- Modify: `src/views/pages/seller/dashboard.njk`

No new backend code — `showMarketingPrompt` is already in the overview object from Task 3. No new test needed (router test for dashboard would be integration-level; the service logic is covered in Task 3 tests).

**Step 1: Create `referral-prompt.njk`**

Create `src/views/partials/seller/referral-prompt.njk`:

```nunjucks
<div id="marketing-prompt-card" class="card mb-6">
  <h2 class="font-semibold mb-1">{{ "Refer a friend" | t }}</h2>
  <p class="text-sm text-gray-600 mb-4">
    {{ "Know someone selling their HDB? Share the love with your friend with your referral link. Opt in to hear about market updates too." | t }}
  </p>
  <button
    hx-post="/seller/compliance/consent/grant"
    hx-vals='{"type": "marketing", "channel": "web"}'
    hx-target="#marketing-prompt-card"
    hx-swap="outerHTML"
    class="btn-primary text-sm"
  >
    {{ "Yes, keep me informed" | t }}
  </button>
</div>
```

**Step 2: Add the prompt to `dashboard.njk`**

In `src/views/pages/seller/dashboard.njk`, after the `dashboard-overview.njk` include (line 50), add:

```nunjucks
{# Marketing consent prompt — shown 14+ days after signup if not yet opted in #}
{% if overview.showMarketingPrompt %}
  {% include "partials/seller/referral-prompt.njk" %}
{% endif %}
```

**Step 3: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/views/partials/seller/referral-prompt.njk src/views/pages/seller/dashboard.njk
git commit -m "feat(consent): add marketing consent prompt card to seller dashboard"
```

---

### Task 7: Settings page — lightweight marketing consent toggle

**Files:**
- Create: `src/views/partials/seller/settings-consent.njk`
- Modify: `src/views/pages/seller/settings.njk`
- Modify: `src/domains/seller/seller.router.ts` (settings GET route — pass `consentMarketing`)

**Step 1: Find the settings GET route**

In `src/domains/seller/seller.router.ts`, find the `GET /seller/settings` handler. It currently renders `pages/seller/settings` with `settings`. Verify what data it passes.

**Step 2: Update the settings GET route to include `consentMarketing`**

The settings route needs to pass the seller's current `consentMarketing` state. Add a call to fetch the seller consent and pass it to the template. The route should look like:

```typescript
sellerRouter.get('/seller/settings', requireAuth(), requireRole('seller'), async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const [settings, consent] = await Promise.all([
      sellerService.getSellerSettings(user.id),
      complianceRepo.findSellerConsent(user.id),
    ]);
    res.render('pages/seller/settings', {
      settings,
      consentMarketing: consent?.consentMarketing ?? false,
    });
  } catch (err) {
    next(err);
  }
});
```

Note: import `complianceRepo` if not already imported in `seller.router.ts`. Check the existing imports first. If `complianceRepo` is not there, import it: `import * as complianceRepo from '../compliance/compliance.repository';`

**Step 3: Create `settings-consent.njk`**

Create `src/views/partials/seller/settings-consent.njk`:

```nunjucks
<div class="bg-white rounded-xl border border-slate-200 p-6 mt-6" id="settings-consent">
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{{ "Marketing" | t }}</p>
  <p class="text-sm text-gray-500 mb-4">
    {{ "Market updates and referral programme." | t }}
  </p>

  <div class="flex items-center justify-between">
    <span class="text-sm font-medium text-gray-900">{{ "Marketing Communications" | t }}</span>
    <div class="flex items-center gap-3">
      <span class="text-xs text-gray-500">
        {% if consentMarketing %}{{ "On" | t }}{% else %}{{ "Off" | t }}{% endif %}
      </span>
      {% if consentMarketing %}
        <button
          hx-post="/seller/compliance/consent/withdraw"
          hx-vals='{"type": "marketing", "channel": "web"}'
          hx-target="#settings-consent"
          hx-swap="outerHTML"
          class="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-pressed="true"
        >
          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow translate-x-6 transition-transform"></span>
        </button>
      {% else %}
        <button
          hx-post="/seller/compliance/consent/grant"
          hx-vals='{"type": "marketing", "channel": "web"}'
          hx-target="#settings-consent"
          hx-swap="outerHTML"
          class="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-pressed="false"
        >
          <span class="inline-block h-4 w-4 transform rounded-full bg-white shadow translate-x-1 transition-transform"></span>
        </button>
      {% endif %}
    </div>
  </div>
</div>
```

Note: the `hx-target="#settings-consent"` swap requires the grant/withdraw endpoints to return this partial when the target is `settings-consent`. Both endpoints currently return `consent-panel` partial. We need to handle this.

**Approach:** Both grant and withdraw already detect `hx-request` and return `consent-panel`. The settings page needs the `settings-consent` partial returned instead. Pass a hidden field `source=settings` in the HTMX vals, and in the router check `req.body.source` to decide which partial to render.

Update the grant route handler response to:

```typescript
if (req.headers['hx-request']) {
  const source = (req.body as { source?: string }).source;
  if (source === 'settings') {
    return res.render('partials/seller/settings-consent', {
      consentMarketing: true,
    });
  }
  return res.render('partials/compliance/consent-panel', {
    consentService: myData.seller.consentService,
    consentMarketing: myData.seller.consentMarketing,
    consentHistory: myData.consentHistory,
  });
}
```

Do the same for the withdraw route handler (check for `source === 'settings'` and render `settings-consent` with `consentMarketing: false`).

Update the vals in `settings-consent.njk` to pass the source:

```nunjucks
hx-vals='{"type": "marketing", "channel": "web", "source": "settings"}'
```

**Step 4: Update `settings.njk`**

In `src/views/pages/seller/settings.njk`, add the consent include:

```nunjucks
{% block content %}
  <div class="max-w-2xl mx-auto">
    {% set pageTitle = "Settings" %}
    {% include "partials/shared/page-header.njk" %}
    {% include "partials/seller/settings-notifications.njk" %}
    {% include "partials/seller/settings-consent.njk" %}
  </div>
{% endblock %}
```

**Step 5: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors.

**Step 6: Run full tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/views/partials/seller/settings-consent.njk src/views/pages/seller/settings.njk src/domains/seller/seller.router.ts src/domains/compliance/compliance.router.ts
git commit -m "feat(consent): add marketing consent toggle to seller settings page"
```

---

### Task 8: My Data — grant button in consent panel

**Files:**
- Modify: `src/views/partials/compliance/consent-panel.njk`

No backend changes needed — the grant endpoint already returns the updated `consent-panel` partial.

**Step 1: Update `consent-panel.njk`**

In the marketing communications row (lines 15–36), add a grant button in the `Not given` state, symmetric with the existing withdraw button:

Replace the marketing row's action area:

```nunjucks
<div class="flex items-center gap-3">
  <span class="px-3 py-1 text-xs font-medium rounded-full
    {% if consentMarketing %}bg-green-100 text-green-800{% else %}bg-gray-100 text-gray-600{% endif %}">
    {% if consentMarketing %}{{ "Active" | t }}{% else %}{{ "Not given" | t }}{% endif %}
  </span>
  {% if consentMarketing %}
  <button
    hx-post="/seller/compliance/consent/withdraw"
    hx-vals='{"type": "marketing", "channel": "web"}'
    hx-target="#consent-panel"
    hx-swap="outerHTML"
    class="text-xs text-red-600 hover:underline">
    {{ "Withdraw" | t }}
  </button>
  {% else %}
  <button
    hx-post="/seller/compliance/consent/grant"
    hx-vals='{"type": "marketing", "channel": "web"}'
    hx-target="#consent-panel"
    hx-swap="outerHTML"
    class="text-xs text-blue-600 hover:underline">
    {{ "Give consent" | t }}
  </button>
  {% endif %}
</div>
```

**Step 2: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors.

**Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/views/partials/compliance/consent-panel.njk
git commit -m "feat(consent): add grant button to My Data consent panel"
```

---

### Task 9: Final verification

**Step 1: Run full test suite**

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all unit and integration tests pass.

**Step 2: Run lint**

```bash
npm run lint 2>&1 | head -20
```

Expected: no lint errors.

**Step 3: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no TypeScript errors.
