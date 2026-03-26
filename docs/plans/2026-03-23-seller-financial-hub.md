# Seller Financial Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `/seller/financial` hub page showing the seller's SaleProceeds estimate (editable) and any approved/sent FinancialReports.

**Architecture:** Modify the existing `GET /seller/financial` route in `financial.router.ts` to fetch both SaleProceeds and filtered FinancialReports. Extract the calculator form from `onboarding-step-3.njk` into a shared partial. Create a new `financial-hub.njk` partial with read-only estimate view, inline edit via HTMX, and conditional agent reports section.

**Tech Stack:** TypeScript, Express, Nunjucks, HTMX, Tailwind CSS, Prisma, Jest + Supertest

---

### Task 1: Add `findApprovedForSeller` to financial repository

**Files:**
- Modify: `src/domains/property/financial.repository.ts:62-68`
- Test: `src/domains/property/__tests__/financial.repository.test.ts` (create)

**Step 1: Write the failing test**

Create `src/domains/property/__tests__/financial.repository.test.ts`:

```typescript
import { findApprovedForSeller } from '../financial.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    financialReport: {
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('@/infra/database/prisma');

describe('findApprovedForSeller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries for approved and sent reports only', async () => {
    prisma.financialReport.findMany.mockResolvedValue([]);

    await findApprovedForSeller('seller-1');

    expect(prisma.financialReport.findMany).toHaveBeenCalledWith({
      where: {
        sellerId: 'seller-1',
        status: { in: ['approved', 'sent'] },
      },
      orderBy: { version: 'desc' },
    });
  });

  it('returns decrypted report data', async () => {
    prisma.financialReport.findMany.mockResolvedValue([
      { id: 'r1', reportData: { inputs: {}, outputs: {} } },
    ]);

    const result = await findApprovedForSeller('seller-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/property/__tests__/financial.repository.test.ts --no-coverage`
Expected: FAIL — `findApprovedForSeller` is not exported

**Step 3: Write minimal implementation**

In `src/domains/property/financial.repository.ts`, add after `findAllForSeller`:

```typescript
export async function findApprovedForSeller(sellerId: string) {
  const records = await prisma.financialReport.findMany({
    where: {
      sellerId,
      status: { in: ['approved', 'sent'] },
    },
    orderBy: { version: 'desc' },
  });
  return records.map(withDecryptedReportData);
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/domains/property/__tests__/financial.repository.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/property/financial.repository.ts src/domains/property/__tests__/financial.repository.test.ts
git commit -m "feat(financial-hub): add findApprovedForSeller repository method"
```

---

### Task 2: Add `getApprovedReportsForSeller` to financial service

**Files:**
- Modify: `src/domains/property/financial.service.ts:177-179`
- Test: (not needed — thin wrapper, same pattern as `getReportsForSeller`)

**Step 1: Add the method**

In `src/domains/property/financial.service.ts`, add after `getReportsForSeller`:

```typescript
export async function getApprovedReportsForSeller(sellerId: string) {
  return financialRepo.findApprovedForSeller(sellerId);
}
```

**Step 2: Run existing tests to verify nothing broke**

Run: `npx jest --no-coverage -- --testPathPattern="property|seller"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/domains/property/financial.service.ts
git commit -m "feat(financial-hub): add getApprovedReportsForSeller service method"
```

---

### Task 3: Extract shared sale proceeds form partial

**Files:**
- Create: `src/views/partials/seller/sale-proceeds-form.njk`
- Modify: `src/views/partials/seller/onboarding-step-3.njk`

**Step 1: Create the shared form partial**

Create `src/views/partials/seller/sale-proceeds-form.njk`:

```njk
{# Shared sale proceeds calculator form.
   Expects: postTarget (string), swapTarget (string), commission, saleProceeds (or null), askingPrice (or null)
#}
{% if error %}
  <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
    {{ error }}
  </div>
{% endif %}

<form id="sale-proceeds-form"
  hx-post="{{ postTarget }}"
  hx-target="{{ swapTarget }}"
  hx-swap="innerHTML"
  class="space-y-4"
>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1" for="sellingPrice">{{ "Selling Price ($)" | t }} *</label>
    <input type="number" id="sellingPrice" name="sellingPrice"
      value="{{ saleProceeds.sellingPrice if saleProceeds else (askingPrice if askingPrice else '') }}"
      placeholder="e.g. 500000" min="0" step="0.01" required
      class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1" for="outstandingLoan">{{ "Outstanding Mortgage Loan ($)" | t }} *</label>
    <input type="number" id="outstandingLoan" name="outstandingLoan"
      value="{{ saleProceeds.outstandingLoan if saleProceeds else '' }}"
      placeholder="e.g. 200000" min="0" step="0.01" required
      class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
    <p class="text-xs text-gray-500 mt-1">{{ "Check your latest HDB or bank statement" | t }}</p>
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">{{ "CPF Used + Accrued Interest ($)" | t }} *</label>
    <div class="space-y-2" id="cpf-contributors">
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500 w-16">{{ "Seller 1" | t }}</span>
        <input type="number" id="cpfSeller1" name="cpfSeller1"
          value="{{ saleProceeds.cpfSeller1 if saleProceeds else '' }}"
          placeholder="e.g. 50000" min="0" step="0.01" required
          class="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
      </div>
      <div class="flex items-center gap-2 {% if not saleProceeds or not saleProceeds.cpfSeller2 %}hidden{% endif %}" id="cpf-row-2">
        <span class="text-xs text-gray-500 w-16">{{ "Seller 2" | t }}</span>
        <input type="number" id="cpfSeller2" name="cpfSeller2"
          value="{{ saleProceeds.cpfSeller2 if saleProceeds and saleProceeds.cpfSeller2 else '' }}"
          placeholder="e.g. 30000" min="0" step="0.01"
          class="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
      </div>
      <div class="flex items-center gap-2 {% if not saleProceeds or not saleProceeds.cpfSeller3 %}hidden{% endif %}" id="cpf-row-3">
        <span class="text-xs text-gray-500 w-16">{{ "Seller 3" | t }}</span>
        <input type="number" id="cpfSeller3" name="cpfSeller3"
          value="{{ saleProceeds.cpfSeller3 if saleProceeds and saleProceeds.cpfSeller3 else '' }}"
          placeholder="e.g. 0" min="0" step="0.01"
          class="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
      </div>
      <div class="flex items-center gap-2 {% if not saleProceeds or not saleProceeds.cpfSeller4 %}hidden{% endif %}" id="cpf-row-4">
        <span class="text-xs text-gray-500 w-16">{{ "Seller 4" | t }}</span>
        <input type="number" id="cpfSeller4" name="cpfSeller4"
          value="{{ saleProceeds.cpfSeller4 if saleProceeds and saleProceeds.cpfSeller4 else '' }}"
          placeholder="e.g. 0" min="0" step="0.01"
          class="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
      </div>
    </div>
    <button type="button" id="add-cpf-contributor"
      class="text-xs text-blue-600 hover:underline mt-1">{{ "+ Add contributor" | t }}</button>
    <p class="text-xs text-gray-500 mt-1">
      <a href="https://www.cpf.gov.sg/member" target="_blank" rel="noopener" class="text-blue-600 hover:underline">{{ "Not sure? Check www.cpf.gov.sg/member" | t }} &rarr;</a>
    </p>
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1" for="resaleLevy">{{ "Resale Levy ($)" | t }}</label>
    <input type="number" id="resaleLevy" name="resaleLevy"
      value="{{ saleProceeds.resaleLevy if saleProceeds else '0' }}"
      placeholder="0" min="0" step="0.01"
      class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
    <p class="text-xs text-gray-500 mt-1">{{ "Applies if you previously bought a subsidised flat" | t }}</p>
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1" for="otherDeductions">{{ "Other Deductions ($)" | t }}</label>
    <input type="number" id="otherDeductions" name="otherDeductions"
      value="{{ saleProceeds.otherDeductions if saleProceeds else '0' }}"
      placeholder="0" min="0" step="0.01"
      class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
    <p class="text-xs text-gray-500 mt-1">{{ "Upgrading levies, outstanding costs, etc." | t }}</p>
  </div>

  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">{{ "Agent Commission ($)" | t }}</label>
    <input type="text" id="commissionDisplay"
      value="${{ commission.total }}" disabled
      class="w-full border border-gray-200 rounded-md px-3 py-2 bg-gray-50 text-gray-500">
    <input type="hidden" name="commissionTotal" value="{{ commission.total }}">
    <p class="text-xs text-gray-500 mt-1">{{ "Fixed fee: $" | t }}{{ commission.amount }}{{ " + GST" | t }}</p>
  </div>

  <div class="border-t border-gray-200 pt-4 mt-4">
    <div class="flex justify-between items-center">
      <span class="text-lg font-semibold text-gray-900">{{ "Estimated Net Proceeds" | t }}</span>
      <span id="net-proceeds-display" class="text-2xl font-bold text-green-600">$0.00</span>
    </div>
    <div id="negative-warning" class="hidden mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
      {{ "Your estimated sale proceeds are negative. You may need to top up the difference." | t }}
    </div>
  </div>

  <p class="text-xs text-gray-400 italic">{{ "This is an estimate based on your inputs. Actual proceeds depend on final figures from HDB and CPF Board. This is not financial advice." | t }}</p>

  <div class="mt-6">
    <button type="submit"
      class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition">
      {{ submitLabel | default("Save Estimate") | t }}
    </button>
  </div>
</form>
```

**Step 2: Refactor onboarding-step-3 to use the shared partial**

Replace `src/views/partials/seller/onboarding-step-3.njk` with:

```njk
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Estimated Sale Proceeds" | t }}</h2>

  <p class="text-gray-600 mb-4">{{ "Enter your financial details to estimate your net sale proceeds." | t }}</p>

  {% set postTarget = "/seller/onboarding/step/3" %}
  {% set swapTarget = "#onboarding-step" %}
  {% set submitLabel = "Save & Continue" %}
  {% include "partials/seller/sale-proceeds-form.njk" %}

  <div class="mt-4">
    <button type="button"
      hx-get="/seller/onboarding/step/2"
      hx-target="#onboarding-step"
      hx-swap="innerHTML"
      class="text-gray-500 hover:text-gray-700 text-sm py-3 px-4 transition">
      {{ "← Back" | t }}
    </button>
  </div>
</div>
```

**Step 3: Run existing tests to verify nothing broke**

Run: `npx jest --no-coverage -- --testPathPattern="seller"`
Expected: PASS — onboarding step 3 still works via the included partial

**Step 4: Commit**

```bash
git add src/views/partials/seller/sale-proceeds-form.njk src/views/partials/seller/onboarding-step-3.njk
git commit -m "refactor(financial-hub): extract shared sale proceeds form partial"
```

---

### Task 4: Create financial hub partial

**Files:**
- Create: `src/views/partials/seller/financial-hub.njk`

**Step 1: Create the template**

Create `src/views/partials/seller/financial-hub.njk`:

```njk
{# Financial Hub — shows seller estimate + agent reports.
   Expects: saleProceeds (or null), reports (array), commission
#}
<div id="financial-hub">

  {# ── My Estimate Section ─────────────────────────── #}
  <div class="mb-8">
    <h2 class="text-lg font-semibold text-gray-900 mb-4">{{ "My Estimate" | t }}</h2>

    <div id="estimate-section">
      {% if saleProceeds %}
        {% include "partials/seller/estimate-summary.njk" %}
      {% else %}
        <div class="bg-white rounded-lg shadow p-6 text-center">
          <p class="text-gray-600 mb-4">{{ "You haven't calculated your estimated proceeds yet." | t }}</p>
          <button type="button"
            hx-get="/seller/financial/estimate/edit"
            hx-target="#estimate-section"
            hx-swap="innerHTML"
            class="bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition">
            {{ "Calculate Your Estimated Proceeds" | t }}
          </button>
        </div>
      {% endif %}
    </div>
  </div>

  {# ── Agent Reports Section (conditional) ─────────── #}
  {% if reports.length > 0 %}
  <div>
    <h2 class="text-lg font-semibold text-gray-900 mb-4">{{ "Agent Financial Reports" | t }}</h2>

    <div class="space-y-4">
      {% for report in reports %}
        {% set data = report.reportData %}
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex justify-between items-start mb-3">
            <div>
              <span class="text-xs font-medium px-2 py-1 rounded-full
                {% if report.status === 'sent' %}bg-green-100 text-green-700
                {% else %}bg-blue-100 text-blue-700{% endif %}">
                {% if report.status === 'sent' %}{{ "Sent to you" | t }}{% else %}{{ "Approved" | t }}{% endif %}
              </span>
              <span class="text-xs text-gray-400 ml-2">{{ "v" | t }}{{ report.version }} — {{ report.createdAt | date }}</span>
            </div>
          </div>

          <div class="flex justify-between items-center mb-3">
            <span class="text-sm text-gray-600">{{ "Net Cash Proceeds" | t }}</span>
            <span class="text-2xl font-bold {% if data.outputs.netCashProceeds >= 0 %}text-green-600{% else %}text-red-600{% endif %}">
              ${{ data.outputs.netCashProceeds | formatPrice }}
            </span>
          </div>

          <div class="text-sm text-gray-500 mb-3">
            {{ "Total Deductions: $" | t }}{{ data.outputs.totalDeductions | formatPrice }}
          </div>

          {% if report.aiNarrative %}
            <div class="bg-gray-50 rounded-md p-4 text-sm text-gray-700">
              {{ report.aiNarrative }}
            </div>
          {% endif %}
        </div>
      {% endfor %}
    </div>

    <p class="mt-4 text-xs text-gray-400 italic">
      {{ "These reports are estimates prepared by your agent. They do not constitute financial advice. Please verify all figures with HDB and CPF Board directly." | t }}
    </p>
  </div>
  {% endif %}

</div>
```

**Step 2: Create the read-only estimate summary sub-partial**

Create `src/views/partials/seller/estimate-summary.njk`:

```njk
{# Read-only sale proceeds summary card.
   Expects: saleProceeds, commission (in parent scope)
#}
<div class="bg-white rounded-lg shadow p-6">
  <div class="flex justify-between items-center mb-4">
    <span class="text-2xl font-bold {% if saleProceeds.netProceeds >= 0 %}text-green-600{% else %}text-red-600{% endif %}">
      ${{ saleProceeds.netProceeds | formatPrice }}
    </span>
    <button type="button"
      hx-get="/seller/financial/estimate/edit"
      hx-target="#estimate-section"
      hx-swap="innerHTML"
      class="text-sm text-blue-600 hover:underline">
      {{ "Edit Estimate" | t }}
    </button>
  </div>

  {% if saleProceeds.netProceeds < 0 %}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
      {{ "Your estimated sale proceeds are negative. You may need to top up the difference." | t }}
    </div>
  {% endif %}

  <table class="w-full text-sm">
    <tbody>
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Selling Price" | t }}</td>
        <td class="py-2 text-right font-medium">${{ saleProceeds.sellingPrice | formatPrice }}</td>
      </tr>
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Outstanding Loan" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ saleProceeds.outstandingLoan | formatPrice }}</td>
      </tr>
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "CPF Refund" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ (saleProceeds.cpfSeller1 + (saleProceeds.cpfSeller2 or 0) + (saleProceeds.cpfSeller3 or 0) + (saleProceeds.cpfSeller4 or 0)) | formatPrice }}</td>
      </tr>
      {% if saleProceeds.resaleLevy > 0 %}
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Resale Levy" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ saleProceeds.resaleLevy | formatPrice }}</td>
      </tr>
      {% endif %}
      {% if saleProceeds.otherDeductions > 0 %}
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Other Deductions" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ saleProceeds.otherDeductions | formatPrice }}</td>
      </tr>
      {% endif %}
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Agent Commission" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ saleProceeds.commission | formatPrice }}</td>
      </tr>
    </tbody>
  </table>

  <p class="mt-3 text-xs text-gray-400 italic">
    {{ "This is an estimate based on your inputs. Actual proceeds depend on final figures from HDB and CPF Board. This is not financial advice." | t }}
  </p>
</div>
```

**Step 3: Commit**

```bash
git add src/views/partials/seller/financial-hub.njk src/views/partials/seller/estimate-summary.njk
git commit -m "feat(financial-hub): add financial hub and estimate summary partials"
```

---

### Task 5: Update `GET /seller/financial` route and add estimate routes

**Files:**
- Modify: `src/domains/property/financial.router.ts:72-88`

**Step 1: Write the failing test**

Add to `src/domains/seller/__tests__/seller.router.test.ts`. First, the test app needs to also mount the `financialRouter`. But since the financial router is in the property domain and has its own auth middleware, it's cleaner to test these routes in a new test file.

Create `src/domains/property/__tests__/financial-hub.router.test.ts`:

```typescript
import * as financialService from '../financial.service';
import * as sellerService from '@/domains/seller/seller.service';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('../financial.service');
jest.mock('@/domains/seller/seller.service');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/shared/audit.service', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const mockedFinancialService = jest.mocked(financialService);
const mockedSellerService = jest.mocked(sellerService);
const mockedSettingsService = jest.mocked(settingsService);

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { financialRouter } from '../financial.router';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
  });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (d: unknown) => (d ? String(d) : ''));
  env.addFilter('formatPrice', (n: unknown) => String(n));
  app.set('view engine', 'njk');

  app.use((req, _res, next) => {
    req.user = {
      id: 'seller-1',
      role: 'seller',
      email: 'test@test.local',
      name: 'Test',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });

  app.use(financialRouter);
  return app;
}

describe('GET /seller/financial (hub)', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      total: 1633.91,
    });
  });

  it('renders financial hub with saleProceeds and reports', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue({
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: null,
      cpfSeller3: null,
      cpfSeller4: null,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
      netProceeds: 248366.09,
    });
    mockedFinancialService.getApprovedReportsForSeller = jest.fn().mockResolvedValue([]);

    const res = await request(app).get('/seller/financial');

    expect(res.status).toBe(200);
    expect(mockedSellerService.getSaleProceeds).toHaveBeenCalledWith('seller-1');
    expect(mockedFinancialService.getApprovedReportsForSeller).toHaveBeenCalledWith('seller-1');
  });

  it('returns HTMX partial when hx-request is set', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue(null);
    mockedFinancialService.getApprovedReportsForSeller = jest.fn().mockResolvedValue([]);

    const res = await request(app).get('/seller/financial').set('HX-Request', 'true');

    expect(res.status).toBe(200);
  });
});

describe('GET /seller/financial/estimate/edit', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      total: 1633.91,
    });
  });

  it('renders the sale proceeds form for editing', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue({
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: null,
      cpfSeller3: null,
      cpfSeller4: null,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
      netProceeds: 248366.09,
    });

    const res = await request(app).get('/seller/financial/estimate/edit');

    expect(res.status).toBe(200);
  });
});

describe('POST /seller/financial/estimate', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      total: 1633.91,
    });
  });

  it('saves sale proceeds and returns updated estimate summary', async () => {
    mockedSellerService.saveSaleProceeds = jest.fn().mockResolvedValue({
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: null,
      cpfSeller3: null,
      cpfSeller4: null,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
      netProceeds: 248366.09,
    });
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue({
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: null,
      cpfSeller3: null,
      cpfSeller4: null,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
      netProceeds: 248366.09,
    });

    const res = await request(app)
      .post('/seller/financial/estimate')
      .set('HX-Request', 'true')
      .send({
        sellingPrice: '500000',
        outstandingLoan: '200000',
        cpfSeller1: '50000',
        resaleLevy: '0',
        otherDeductions: '0',
      });

    expect(res.status).toBe(200);
    expect(mockedSellerService.saveSaleProceeds).toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/seller/financial/estimate')
      .set('HX-Request', 'true')
      .send({ sellingPrice: '500000' });

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/property/__tests__/financial-hub.router.test.ts --no-coverage`
Expected: FAIL — routes don't have the expected behavior yet

**Step 3: Update the routes**

Replace the `GET /seller/financial` handler in `src/domains/property/financial.router.ts` (lines 72-88) and add two new routes:

```typescript
// --- Hub page: shows seller estimate + approved agent reports ---
financialRouter.get(
  '/seller/financial',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const [saleProceeds, reports, commission] = await Promise.all([
        sellerService.getSaleProceeds(user.id),
        financialService.getApprovedReportsForSeller(user.id),
        settingsService.getCommission(),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-hub', {
          saleProceeds,
          reports,
          commission,
        });
      }
      return res.render('pages/seller/financial', {
        saleProceeds,
        reports,
        commission,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Inline edit form for sale proceeds estimate ---
financialRouter.get(
  '/seller/financial/estimate/edit',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const [saleProceeds, commission] = await Promise.all([
        sellerService.getSaleProceeds(user.id),
        settingsService.getCommission(),
      ]);
      const property = await propertyService.getPropertyForSeller(user.id);

      res.render('partials/seller/financial-estimate-edit', {
        saleProceeds,
        commission,
        askingPrice: property?.askingPrice ? Number(property.askingPrice) : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Save updated estimate from financial hub ---
financialRouter.post(
  '/seller/financial/estimate',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { sellingPrice, outstandingLoan, cpfSeller1, cpfSeller2, cpfSeller3, cpfSeller4, resaleLevy, otherDeductions } = req.body;

      if (!sellingPrice || !outstandingLoan || !cpfSeller1) {
        const commission = await settingsService.getCommission();
        return res.status(400).render('partials/seller/financial-estimate-edit', {
          error: 'Selling price, outstanding loan, and CPF (Seller 1) are required.',
          commission,
        });
      }

      const commission = await settingsService.getCommission();

      await sellerService.saveSaleProceeds({
        sellerId: user.id,
        sellingPrice: parseFloat(sellingPrice),
        outstandingLoan: parseFloat(outstandingLoan),
        cpfSeller1: parseFloat(cpfSeller1),
        cpfSeller2: cpfSeller2 ? parseFloat(cpfSeller2) : undefined,
        cpfSeller3: cpfSeller3 ? parseFloat(cpfSeller3) : undefined,
        cpfSeller4: cpfSeller4 ? parseFloat(cpfSeller4) : undefined,
        resaleLevy: parseFloat(resaleLevy || '0'),
        otherDeductions: parseFloat(otherDeductions || '0'),
        commission: commission.total,
      });

      const saleProceeds = await sellerService.getSaleProceeds(user.id);

      res.render('partials/seller/estimate-summary', {
        saleProceeds,
        commission,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

You will also need to add the missing imports at the top of `financial.router.ts`:

```typescript
import * as settingsService from '@/domains/shared/settings.service';
import * as propertyService from '@/domains/property/property.service';
```

**Step 4: Create the edit wrapper partial**

Create `src/views/partials/seller/financial-estimate-edit.njk`:

```njk
{# Inline edit form for sale proceeds on the financial hub page.
   Expects: saleProceeds (or null), commission, askingPrice (or null)
#}
<div class="bg-white rounded-lg shadow p-6">
  <div class="flex justify-between items-center mb-4">
    <h3 class="text-lg font-semibold text-gray-900">{{ "Edit Your Estimate" | t }}</h3>
    <button type="button"
      hx-get="/seller/financial"
      hx-target="#estimate-section"
      hx-swap="innerHTML"
      hx-select="#estimate-section > *"
      class="text-sm text-gray-500 hover:text-gray-700">
      {{ "Cancel" | t }}
    </button>
  </div>

  {% set postTarget = "/seller/financial/estimate" %}
  {% set swapTarget = "#estimate-section" %}
  {% set submitLabel = "Save Estimate" %}
  {% include "partials/seller/sale-proceeds-form.njk" %}
</div>
```

**Step 5: Run test to verify it passes**

Run: `npx jest src/domains/property/__tests__/financial-hub.router.test.ts --no-coverage`
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/property/financial.router.ts src/views/partials/seller/financial-estimate-edit.njk src/domains/property/__tests__/financial-hub.router.test.ts
git commit -m "feat(financial-hub): update routes and add estimate edit/save handlers"
```

---

### Task 6: Update the financial page layout

**Files:**
- Modify: `src/views/pages/seller/financial.njk`

**Step 1: Update the page**

Replace `src/views/pages/seller/financial.njk` with:

```njk
{% extends "layouts/seller.njk" %}

{% block title %}{{ "Financial Overview" | t }} — SellMyHouse.sg{% endblock %}

{% block content %}
{% set pageTitle = "Financial Overview" %}
{% include "partials/shared/page-header.njk" %}

<div id="financial-hub-container">
  {% include "partials/seller/financial-hub.njk" %}
</div>
{% endblock %}
```

Note: The page now server-renders the hub content directly (no lazy HTMX load), since the `GET /seller/financial` route already fetches all data. The HTMX partial response path still works for in-page navigation.

**Step 2: Run all tests to verify nothing broke**

Run: `npx jest --no-coverage -- --testPathPattern="seller|property|financial"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/views/pages/seller/financial.njk
git commit -m "feat(financial-hub): update financial page layout to use hub partial"
```

---

### Task 7: Run full test suite and verify

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Manual verification checklist**

Start dev server (`npm run dev`) and verify:
- [ ] `GET /seller/financial` shows "My Estimate" section with CTA if no SaleProceeds
- [ ] `GET /seller/financial` shows read-only summary card if SaleProceeds exists
- [ ] Clicking "Edit Estimate" loads the calculator form inline
- [ ] Submitting the form saves and swaps back to read-only summary
- [ ] "Cancel" button dismisses the edit form
- [ ] Agent Reports section appears only when approved/sent reports exist
- [ ] Report cards show net proceeds, total deductions, AI narrative, version, status badge
- [ ] Live calculation JS works in the edit form
- [ ] CPF contributor toggle works in the edit form
- [ ] Onboarding step 3 still works identically (shared form partial)

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(financial-hub): address issues from manual verification"
```
