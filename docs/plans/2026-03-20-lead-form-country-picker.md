# Lead Form Country Picker + Validation Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken Submit button on the homepage lead form by adding a country code picker, fixing silent HTMX validation failures, and handling HTMX error responses.

**Architecture:** Add `countryCode` and `nationalNumber` columns to Seller. Backend validates phone per-country (strict SG, loose others), constructs E.164 `phone`. Frontend gets a searchable ASEAN country dropdown and two global HTMX event handlers (validation + error swaps).

**Tech Stack:** TypeScript, Express, Prisma, PostgreSQL, HTMX, Nunjucks, Tailwind CSS

---

### Task 1: Database Migration — Add countryCode and nationalNumber to Seller

**Files:**
- Modify: `prisma/schema.prisma:369-419` (Seller model)
- Create: `prisma/migrations/YYYYMMDDHHMMSS_add_seller_country_code/migration.sql`

**Step 1: Update Prisma schema**

Add two new fields to the Seller model, after the `phone` field (line 373):

```prisma
  countryCode             String                 @default("+65") @map("country_code")
  nationalNumber          String?                @map("national_number")
```

`nationalNumber` is nullable because existing records need backfill. `phone` remains the E.164 source of truth for lookups.

**Step 2: Generate migration SQL**

Use the shadow database approach (documented in MEMORY.md):

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" \
  --script
```

Save the output to `prisma/migrations/YYYYMMDDHHMMSS_add_seller_country_code/migration.sql`. The SQL should be:

```sql
ALTER TABLE "sellers" ADD COLUMN "country_code" TEXT NOT NULL DEFAULT '+65';
ALTER TABLE "sellers" ADD COLUMN "national_number" TEXT;
UPDATE "sellers" SET "national_number" = "phone" WHERE "national_number" IS NULL;
```

**Step 3: Apply migration and generate client**

```bash
npx prisma migrate deploy
npx prisma generate
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

**Step 4: Verify migration**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "SELECT id, phone, country_code, national_number FROM sellers LIMIT 5;"
```

Expected: existing rows have `country_code = '+65'` and `national_number` = same as `phone`.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add countryCode and nationalNumber to Seller"
```

---

### Task 2: Backend — Update Lead Types

**Files:**
- Modify: `src/domains/lead/lead.types.ts`

**Step 1: Update LeadInput interface**

Replace `phone: string` with three fields:

```typescript
export type LeadSource = 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';

export interface LeadInput {
  name: string;
  countryCode: string;
  nationalNumber: string;
  phone: string; // E.164 format, constructed by router
  consentService: boolean;
  consentMarketing: boolean;
  consentHuttonsTransfer: boolean;
  leadSource: LeadSource;
  honeypot?: string;
  formLoadedAt?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface LeadResult {
  sellerId: string;
}
```

**Step 2: Commit**

```bash
git add src/domains/lead/lead.types.ts
git commit -m "feat(lead): add countryCode and nationalNumber to LeadInput"
```

---

### Task 3: Backend — Update Lead Validator (TDD)

**Files:**
- Modify: `src/domains/lead/lead.validator.ts`
- Modify: `src/domains/lead/__tests__/lead.validator.test.ts`

**Step 1: Write failing tests**

Add these test cases to `lead.validator.test.ts`. Update the existing `validInput` to include the new fields, and add new tests:

```typescript
import { validateLeadInput } from '../lead.validator';

describe('validateLeadInput', () => {
  const validInput = {
    name: 'John Tan',
    countryCode: '+65',
    nationalNumber: '91234567',
    phone: '+6591234567',
    consentService: true,
    consentMarketing: false,
    consentHuttonsTransfer: true,
    leadSource: 'website' as const,
    formLoadedAt: Date.now() - 10000,
  };

  it('accepts valid Singapore input', () => {
    const result = validateLeadInput(validInput);
    expect(result).toBeNull();
  });

  it('accepts valid Malaysia input with loose validation', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '123456789',
      phone: '+60123456789',
    });
    expect(result).toBeNull();
  });

  it('rejects Singapore phone not starting with 8 or 9', () => {
    const result = validateLeadInput({
      ...validInput,
      nationalNumber: '61234567',
      phone: '+6561234567',
    });
    expect(result).toEqual({ nationalNumber: 'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)' });
  });

  it('rejects non-SG phone with too few digits', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '123',
      phone: '+60123',
    });
    expect(result).toEqual({ nationalNumber: 'Please enter a valid phone number (7-15 digits)' });
  });

  it('rejects non-SG phone with non-digits', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '12-345-6789',
      phone: '+6012-345-6789',
    });
    expect(result).toEqual({ nationalNumber: 'Please enter a valid phone number (7-15 digits)' });
  });

  it('rejects unknown country code', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+999',
      nationalNumber: '12345678',
      phone: '+99912345678',
    });
    expect(result).toEqual({ countryCode: 'Please select a valid country' });
  });

  // Keep all existing tests for name, consent, honeypot, timing — update
  // their validInput to include the new fields (already done above).
  // The existing tests for 'rejects empty name', 'rejects missing service consent', etc.
  // remain unchanged except for the updated validInput fixture.
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/lead/__tests__/lead.validator.test.ts --verbose
```

Expected: new tests FAIL (validator doesn't accept countryCode/nationalNumber yet).

**Step 3: Update the validator**

Replace `src/domains/lead/lead.validator.ts`:

```typescript
import type { LeadInput } from './lead.types';

const SG_MOBILE_REGEX = /^[89]\d{7}$/;
const LOOSE_PHONE_REGEX = /^\d{7,15}$/;
const MIN_FORM_TIME_MS = 3000;

const VALID_COUNTRY_CODES = [
  '+65', '+60', '+62', '+66', '+63', '+84', '+95', '+855', '+856', '+673',
];

export function validateLeadInput(
  input: Omit<LeadInput, 'ipAddress' | 'userAgent'>,
): Record<string, string> | null {
  // Honeypot check — silent rejection
  if (input.honeypot) {
    return { _bot: 'Submission rejected' };
  }

  // Timing check — reject if submitted too fast
  if (input.formLoadedAt && Date.now() - input.formLoadedAt < MIN_FORM_TIME_MS) {
    return { _bot: 'Submission rejected' };
  }

  if (!input.name || !input.name.trim()) {
    return { name: 'Name is required' };
  }

  if (!VALID_COUNTRY_CODES.includes(input.countryCode)) {
    return { countryCode: 'Please select a valid country' };
  }

  if (input.countryCode === '+65') {
    if (!SG_MOBILE_REGEX.test(input.nationalNumber)) {
      return { nationalNumber: 'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)' };
    }
  } else {
    if (!LOOSE_PHONE_REGEX.test(input.nationalNumber)) {
      return { nationalNumber: 'Please enter a valid phone number (7-15 digits)' };
    }
  }

  if (!input.consentService) {
    return { consentService: 'Service consent is required' };
  }

  if (!input.consentHuttonsTransfer) {
    return {
      consentHuttonsTransfer:
        'You must consent to data transfer to Huttons Asia Pte Ltd to proceed',
    };
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/lead/__tests__/lead.validator.test.ts --verbose
```

Expected: ALL tests PASS.

**Step 5: Commit**

```bash
git add src/domains/lead/lead.validator.ts src/domains/lead/__tests__/lead.validator.test.ts
git commit -m "feat(lead): country-aware phone validation with strict SG, loose others"
```

---

### Task 4: Backend — Update Lead Router

**Files:**
- Modify: `src/domains/lead/lead.router.ts`

**Step 1: Update the router to parse new fields and construct E.164**

In `lead.router.ts`, update the `input` object construction inside the POST handler:

```typescript
    const countryCode = req.body.countryCode ?? '+65';
    const nationalNumber = (req.body.nationalNumber ?? req.body.phone ?? '').replace(/\D/g, '');
    const phone = countryCode + nationalNumber;

    const input = {
      name: req.body.name ?? '',
      countryCode,
      nationalNumber,
      phone,
      consentService: req.body.consentService === 'true' || req.body.consentService === true,
      consentMarketing: req.body.consentMarketing === 'true' || req.body.consentMarketing === true,
      consentHuttonsTransfer:
        req.body.consentHuttonsTransfer === 'true' || req.body.consentHuttonsTransfer === true,
      leadSource,
      honeypot: req.body.website ?? '',
      formLoadedAt: req.body.formLoadedAt ? parseInt(req.body.formLoadedAt, 10) : undefined,
    };
```

Note: `nationalNumber` strips non-digits to normalize input (spaces, dashes).

**Step 2: Commit**

```bash
git add src/domains/lead/lead.router.ts
git commit -m "feat(lead): parse countryCode/nationalNumber in lead router, construct E.164"
```

---

### Task 5: Backend — Update Lead Repository and Service

**Files:**
- Modify: `src/domains/lead/lead.repository.ts`
- Modify: `src/domains/lead/lead.service.ts`
- Modify: `src/domains/lead/__tests__/lead.service.test.ts`

**Step 1: Update `createSellerLead` in lead.repository.ts**

Add `countryCode` and `nationalNumber` to the `data` parameter and the `tx.seller.create` call:

```typescript
export async function createSellerLead(
  tx: Prisma.TransactionClient,
  data: {
    name: string;
    phone: string;
    countryCode: string;
    nationalNumber: string;
    consentService: boolean;
    consentMarketing: boolean;
    leadSource: string;
    retentionExpiresAt?: Date;
  },
) {
  const id = createId();
  return tx.seller.create({
    data: {
      id,
      name: data.name,
      phone: data.phone,
      countryCode: data.countryCode,
      nationalNumber: data.nationalNumber,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      consentTimestamp: new Date(),
      leadSource: data.leadSource as LeadSource,
      status: 'lead',
      retentionExpiresAt: data.retentionExpiresAt,
    },
  });
}
```

Update `submitLeadAtomically` to pass through `countryCode` and `nationalNumber`:

```typescript
export async function submitLeadAtomically(data: {
  name: string;
  phone: string;
  countryCode: string;
  nationalNumber: string;
  consentService: boolean;
  consentMarketing: boolean;
  consentHuttonsTransfer: boolean;
  leadSource: string;
  retentionExpiresAt?: Date;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const seller = await createSellerLead(tx, {
      name: data.name,
      phone: data.phone,
      countryCode: data.countryCode,
      nationalNumber: data.nationalNumber,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      leadSource: data.leadSource,
      retentionExpiresAt: data.retentionExpiresAt,
    });

    await createConsentRecord(tx, {
      sellerId: seller.id,
      purposeService: data.consentService,
      purposeMarketing: data.consentMarketing,
      purposeHuttonsTransfer: data.consentHuttonsTransfer,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });

    return seller;
  });
}
```

**Step 2: Update lead.service.ts**

Add `countryCode` and `nationalNumber` to the `submitLeadAtomically` call:

```typescript
  const seller = await leadRepo.submitLeadAtomically({
    name: input.name.trim(),
    phone: input.phone,
    countryCode: input.countryCode,
    nationalNumber: input.nationalNumber,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
    consentHuttonsTransfer: input.consentHuttonsTransfer,
    leadSource: input.leadSource,
    retentionExpiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
```

**Step 3: Update lead.service.test.ts**

Update `validInput` and `sellerFixture` to include the new fields:

```typescript
  const validInput = {
    name: 'John Tan',
    countryCode: '+65',
    nationalNumber: '91234567',
    phone: '+6591234567',
    consentService: true,
    consentMarketing: false,
    consentHuttonsTransfer: true,
    leadSource: 'website' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  const sellerFixture = {
    id: 'seller-1',
    name: 'John Tan',
    phone: '+6591234567',
    countryCode: '+65',
    nationalNumber: '91234567',
    // ... rest of existing fields unchanged
  };
```

Update the assertion for `submitLeadAtomically`:

```typescript
    expect(mockLeadRepo.submitLeadAtomically).toHaveBeenCalledWith({
      name: 'John Tan',
      phone: '+6591234567',
      countryCode: '+65',
      nationalNumber: '91234567',
      consentService: true,
      consentMarketing: false,
      consentHuttonsTransfer: true,
      leadSource: 'website',
      retentionExpiresAt: expect.any(Date),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });
```

Update the `findActiveSellerByPhone` assertion:

```typescript
    expect(mockLeadRepo.findActiveSellerByPhone).toHaveBeenCalledWith('+6591234567');
```

**Step 4: Run tests**

```bash
npx jest src/domains/lead/__tests__/lead.service.test.ts --verbose
```

Expected: ALL tests PASS.

**Step 5: Commit**

```bash
git add src/domains/lead/lead.repository.ts src/domains/lead/lead.service.ts src/domains/lead/__tests__/lead.service.test.ts
git commit -m "feat(lead): pass countryCode/nationalNumber through service and repository"
```

---

### Task 6: Frontend — HTMX Global Error Handlers

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add the `htmx:validation:failed` handler**

Add this to the end of `app.js`, inside the IIFE (before the final `})();`):

```javascript
  // ── HTMX: show browser validation on failed form submit ────────
  document.addEventListener('htmx:validation:failed', function (e) {
    var form = e.detail.elt;
    if (form && form.reportValidity) {
      form.reportValidity();
    }
  });
```

**Step 2: Add the `htmx:beforeOnLoad` handler for error responses**

Add this to the end of `app.js`, inside the IIFE (before the final `})();`):

```javascript
  // ── HTMX: swap server error responses (4xx/5xx) into target ────
  document.addEventListener('htmx:beforeOnLoad', function (e) {
    if (e.detail.xhr.status >= 400) {
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });
```

**Step 3: Run the app and verify both handlers work**

1. Open `http://localhost:3000/#get-started`
2. Click Submit without filling the form → browser validation tooltip should appear
3. Fill valid data, disconnect network → error response should render in the form container

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "fix(htmx): show browser validation tooltips and swap error responses"
```

---

### Task 7: Frontend — Country Picker and Updated Lead Form

**Files:**
- Modify: `src/views/pages/public/home.njk:64-112`
- Modify: `public/js/app.js`

**Step 1: Update the phone field in home.njk**

Replace the phone `<div class="mb-4">` block (lines 82-86) with the country picker + phone input:

```html
      <div class="mb-4">
        <label for="nationalNumber" class="block text-sm font-semibold mb-1">{{ "Mobile Number" | t }}</label>
        <div class="flex gap-2">
          <div class="relative" id="country-picker">
            <input type="hidden" name="countryCode" id="countryCode" value="+65">
            <button type="button" id="country-picker-btn"
              class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white hover:bg-gray-50 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none whitespace-nowrap"
              aria-haspopup="listbox" aria-expanded="false">
              <span id="country-picker-flag">\u{1F1F8}\u{1F1EC}</span>
              <span id="country-picker-code">+65</span>
              <svg class="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <div id="country-picker-dropdown" class="hidden absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-64">
              <input type="text" id="country-picker-search" placeholder="Search country..." class="w-full border-b border-gray-200 px-3 py-2 text-sm outline-none focus:ring-0" autocomplete="off">
              <ul id="country-picker-list" class="max-h-48 overflow-y-auto" role="listbox"></ul>
            </div>
          </div>
          <input type="tel" id="nationalNumber" name="nationalNumber" placeholder="91234567" required pattern="[89]\d{7}"
            class="flex-1 min-w-0 border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
        </div>
      </div>
```

Also remove the old `name="phone"` hidden input if present. The router now constructs `phone` from `countryCode` + `nationalNumber`.

**Step 2: Add country picker JS to app.js**

Add this inside the IIFE, after the form-loaded timestamp section:

```javascript
  // ── Country code picker (lead form) ─────────────────────────────
  (function () {
    var COUNTRIES = [
      { name: 'Singapore', code: '+65', flag: '\u{1F1F8}\u{1F1EC}', pattern: '[89]\\d{7}', placeholder: '91234567' },
      { name: 'Malaysia', code: '+60', flag: '\u{1F1F2}\u{1F1FE}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Indonesia', code: '+62', flag: '\u{1F1EE}\u{1F1E9}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Thailand', code: '+66', flag: '\u{1F1F9}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Philippines', code: '+63', flag: '\u{1F1F5}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Vietnam', code: '+84', flag: '\u{1F1FB}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Myanmar', code: '+95', flag: '\u{1F1F2}\u{1F1F2}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Cambodia', code: '+855', flag: '\u{1F1F0}\u{1F1ED}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Laos', code: '+856', flag: '\u{1F1F1}\u{1F1E6}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
      { name: 'Brunei', code: '+673', flag: '\u{1F1E7}\u{1F1F3}', pattern: '\\d{7,15}', placeholder: 'Phone number' },
    ];

    var btn = document.getElementById('country-picker-btn');
    var dropdown = document.getElementById('country-picker-dropdown');
    var searchInput = document.getElementById('country-picker-search');
    var list = document.getElementById('country-picker-list');
    var hiddenInput = document.getElementById('countryCode');
    var flagEl = document.getElementById('country-picker-flag');
    var codeEl = document.getElementById('country-picker-code');
    var phoneInput = document.getElementById('nationalNumber');

    if (!btn || !dropdown || !list || !hiddenInput) return;

    function renderList(filter) {
      var lc = (filter || '').toLowerCase();
      list.innerHTML = '';
      COUNTRIES.forEach(function (c) {
        if (lc && c.name.toLowerCase().indexOf(lc) === -1 && c.code.indexOf(lc) === -1) return;
        var li = document.createElement('li');
        li.className = 'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-100';
        li.setAttribute('role', 'option');
        li.dataset.code = c.code;
        li.innerHTML = '<span>' + c.flag + '</span><span class="flex-1">' + c.name + '</span><span class="text-gray-400">' + c.code + '</span>';
        li.addEventListener('click', function () {
          selectCountry(c);
        });
        list.appendChild(li);
      });
    }

    function selectCountry(c) {
      hiddenInput.value = c.code;
      flagEl.textContent = c.flag;
      codeEl.textContent = c.code;
      if (phoneInput) {
        phoneInput.setAttribute('pattern', c.pattern);
        phoneInput.setAttribute('placeholder', c.placeholder);
      }
      closeDropdown();
    }

    function openDropdown() {
      dropdown.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      renderList('');
      searchInput.focus();
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    searchInput.addEventListener('input', function () {
      renderList(searchInput.value);
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!dropdown.classList.contains('hidden') && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
        closeDropdown();
      }
    });

    // Initial render
    renderList('');
  })();
```

**Step 3: Verify manually**

1. Open `http://localhost:3000/#get-started`
2. Country picker shows `🇸🇬 +65` by default
3. Click picker → dropdown appears with searchable list
4. Select Malaysia → phone pattern changes, placeholder changes
5. Select Singapore → phone pattern reverts to `[89]\d{7}`
6. Click outside dropdown → closes
7. Type "mal" in search → filters to Malaysia
8. Fill form and submit → lead created with E.164 phone

**Step 4: Commit**

```bash
git add src/views/pages/public/home.njk public/js/app.js
git commit -m "feat(lead): country code picker with searchable ASEAN dropdown"
```

---

### Task 8: Integration Tests

**Files:**
- Modify: `tests/integration/lead.test.ts`

**Step 1: Update existing tests with new field names**

Update the form `send()` calls to use `countryCode` + `nationalNumber` instead of `phone`:

```typescript
  it('creates a lead with valid input and service consent', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        consentHuttonsTransfer: 'true',
        consentMarketing: 'false',
        leadSource: 'website',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify seller was created with E.164 phone
    const seller = await testPrisma.seller.findFirst({ where: { phone: '+6591234567' } });
    expect(seller).not.toBeNull();
    expect(seller!.status).toBe('lead');
    expect(seller!.countryCode).toBe('+65');
    expect(seller!.nationalNumber).toBe('91234567');
  });
```

**Step 2: Add test for non-SG country code**

```typescript
  it('creates a lead with Malaysian phone number', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'Ahmad Bin Ali',
        countryCode: '+60',
        nationalNumber: '123456789',
        consentService: 'true',
        consentHuttonsTransfer: 'true',
        consentMarketing: 'false',
        leadSource: 'website',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(201);

    const seller = await testPrisma.seller.findFirst({ where: { phone: '+60123456789' } });
    expect(seller).not.toBeNull();
    expect(seller!.countryCode).toBe('+60');
    expect(seller!.nationalNumber).toBe('123456789');
  });
```

**Step 3: Update existing phone-related tests**

Update the 'rejects invalid phone format' test:

```typescript
  it('rejects invalid Singapore phone format', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '61234567',
        consentService: 'true',
        consentHuttonsTransfer: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(400);
  });
```

Update the duplicate phone test to use `countryCode` + `nationalNumber`:

```typescript
  it('rejects duplicate phone number', async () => {
    const { agent: agent1, csrfToken: token1 } = await csrfAgent();
    await agent1
      .post('/api/leads')
      .set('x-csrf-token', token1)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        consentHuttonsTransfer: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    const { agent: agent2, csrfToken: token2 } = await csrfAgent();
    const res = await agent2
      .post('/api/leads')
      .set('x-csrf-token', token2)
      .type('form')
      .send({
        name: 'Another Person',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        consentHuttonsTransfer: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(409);
  });
```

**Step 4: Run integration tests**

```bash
npm run test:integration -- --testPathPattern=lead
```

Expected: ALL tests PASS.

**Step 5: Commit**

```bash
git add tests/integration/lead.test.ts
git commit -m "test(lead): update integration tests for country code support"
```

---

### Task 9: Full Test Suite Verification

**Step 1: Run all unit tests**

```bash
npm test
```

Expected: ALL tests PASS. If any other tests reference `phone: '91234567'` in Seller fixtures, update them to include `countryCode` and `nationalNumber`.

**Step 2: Run all integration tests**

```bash
npm run test:integration
```

Expected: ALL tests PASS.

**Step 3: Build check**

```bash
npm run build
```

Expected: No TypeScript compilation errors.

**Step 4: Commit any remaining test fixture updates**

```bash
git add -A
git commit -m "fix: update test fixtures for countryCode/nationalNumber fields"
```

Only commit if there were changes. If all tests pass without changes, skip this step.
