# Sale Proceeds Calculator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a sale proceeds calculator as onboarding step 3, with persistence and agent visibility.

**Architecture:** New `SaleProceeds` model stores the seller's financial inputs. The onboarding step 3 form calculates net proceeds live in the browser. On submit, data is validated and saved server-side. The agent sees a financial summary on the seller detail page.

**Tech Stack:** Prisma, TypeScript, Express, Nunjucks, Jest, client-side JS

**Key reference files:**
- Design: `docs/plans/2026-03-22-sale-proceeds-calculator-design.md`
- Settings service: `src/domains/shared/settings.service.ts` — `getCommission()` returns `{ amount, gstRate, gstAmount, total }`
- Seller router: `src/domains/seller/seller.router.ts` — onboarding POST handler
- Seller types: `src/domains/seller/seller.types.ts`
- Seller repository: `src/domains/seller/seller.repository.ts`
- Seller service: `src/domains/seller/seller.service.ts`
- Agent types: `src/domains/agent/agent.types.ts`
- Agent service: `src/domains/agent/agent.service.ts`
- Agent repository: `src/domains/agent/agent.repository.ts`
- Onboarding step 3 partial: `src/views/partials/seller/onboarding-step-3.njk`
- Seller detail page: `src/views/pages/agent/seller-detail.njk`
- Test factory: `tests/fixtures/factory.ts`
- Migration pattern: see `MEMORY.md` for shadow DB approach

---

### Task 1: Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260322180000_sale_proceeds/migration.sql`

**Step 1: Add SaleProceeds model to schema**

In `prisma/schema.prisma`, add after the Property model:

```prisma
model SaleProceeds {
  id                String   @id
  sellerId          String   @unique @map("seller_id")
  seller            Seller   @relation(fields: [sellerId], references: [id])
  sellingPrice      Decimal  @map("selling_price") @db.Decimal(12, 2)
  outstandingLoan   Decimal  @map("outstanding_loan") @db.Decimal(12, 2)
  cpfSeller1        Decimal  @map("cpf_seller_1") @db.Decimal(12, 2)
  cpfSeller2        Decimal? @map("cpf_seller_2") @db.Decimal(12, 2)
  cpfSeller3        Decimal? @map("cpf_seller_3") @db.Decimal(12, 2)
  cpfSeller4        Decimal? @map("cpf_seller_4") @db.Decimal(12, 2)
  resaleLevy        Decimal  @default(0) @map("resale_levy") @db.Decimal(12, 2)
  otherDeductions   Decimal  @default(0) @map("other_deductions") @db.Decimal(12, 2)
  commission        Decimal  @map("commission") @db.Decimal(12, 2)
  netProceeds       Decimal  @map("net_proceeds") @db.Decimal(12, 2)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@map("sale_proceeds")
}
```

Add back-relation to the Seller model:

```prisma
  saleProceeds     SaleProceeds?
```

**Step 2: Create migration SQL**

```bash
mkdir -p prisma/migrations/20260322180000_sale_proceeds
```

Create `prisma/migrations/20260322180000_sale_proceeds/migration.sql`:

```sql
CREATE TABLE "public"."sale_proceeds" (
  "id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "selling_price" DECIMAL(12,2) NOT NULL,
  "outstanding_loan" DECIMAL(12,2) NOT NULL,
  "cpf_seller_1" DECIMAL(12,2) NOT NULL,
  "cpf_seller_2" DECIMAL(12,2),
  "cpf_seller_3" DECIMAL(12,2),
  "cpf_seller_4" DECIMAL(12,2),
  "resale_levy" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commission" DECIMAL(12,2) NOT NULL,
  "net_proceeds" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sale_proceeds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_proceeds_seller_id_key" ON "public"."sale_proceeds"("seller_id");

ALTER TABLE "public"."sale_proceeds"
  ADD CONSTRAINT "sale_proceeds_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Step 3: Run migration**

```bash
npx prisma migrate deploy
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(sale-proceeds): add SaleProceeds model and migration"
```

---

### Task 2: Seller Types + Repository + Service

**Files:**
- Modify: `src/domains/seller/seller.types.ts`
- Modify: `src/domains/seller/seller.repository.ts`
- Modify: `src/domains/seller/seller.service.ts`

**Step 1: Add SaleProceedsInput type**

In `src/domains/seller/seller.types.ts`, add:

```typescript
export interface SaleProceedsInput {
  sellerId: string;
  sellingPrice: number;
  outstandingLoan: number;
  cpfSeller1: number;
  cpfSeller2?: number;
  cpfSeller3?: number;
  cpfSeller4?: number;
  resaleLevy: number;
  otherDeductions: number;
  commission: number;
}
```

**Step 2: Add repository functions**

In `src/domains/seller/seller.repository.ts`, add:

```typescript
import { createId } from '@paralleldrive/cuid2';

export async function upsertSaleProceeds(data: {
  sellerId: string;
  sellingPrice: number;
  outstandingLoan: number;
  cpfSeller1: number;
  cpfSeller2?: number;
  cpfSeller3?: number;
  cpfSeller4?: number;
  resaleLevy: number;
  otherDeductions: number;
  commission: number;
  netProceeds: number;
}) {
  return prisma.saleProceeds.upsert({
    where: { sellerId: data.sellerId },
    create: {
      id: createId(),
      ...data,
    },
    update: {
      sellingPrice: data.sellingPrice,
      outstandingLoan: data.outstandingLoan,
      cpfSeller1: data.cpfSeller1,
      cpfSeller2: data.cpfSeller2 ?? null,
      cpfSeller3: data.cpfSeller3 ?? null,
      cpfSeller4: data.cpfSeller4 ?? null,
      resaleLevy: data.resaleLevy,
      otherDeductions: data.otherDeductions,
      commission: data.commission,
      netProceeds: data.netProceeds,
    },
  });
}

export async function findSaleProceedsBySellerId(sellerId: string) {
  return prisma.saleProceeds.findUnique({ where: { sellerId } });
}
```

**Step 3: Add service functions**

In `src/domains/seller/seller.service.ts`, add:

```typescript
import * as settingsService from '../shared/settings.service';
import type { SaleProceedsInput } from './seller.types';

export async function saveSaleProceeds(input: SaleProceedsInput) {
  const cpfTotal = input.cpfSeller1
    + (input.cpfSeller2 ?? 0)
    + (input.cpfSeller3 ?? 0)
    + (input.cpfSeller4 ?? 0);

  const netProceeds = input.sellingPrice
    - input.outstandingLoan
    - cpfTotal
    - input.resaleLevy
    - input.otherDeductions
    - input.commission;

  return sellerRepo.upsertSaleProceeds({
    ...input,
    netProceeds: Math.round(netProceeds * 100) / 100,
  });
}

export async function getSaleProceeds(sellerId: string) {
  return sellerRepo.findSaleProceedsBySellerId(sellerId);
}
```

**Step 4: Verify build**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/domains/seller/
git commit -m "feat(sale-proceeds): add types, repository, and service for SaleProceeds"
```

---

### Task 3: Onboarding Step 3 POST Handler

**Files:**
- Modify: `src/domains/seller/seller.router.ts`

**Step 1: Add step 3 handler**

In the POST `/seller/onboarding/step/:step` handler, after the `if (step === 2) { ... }` block, add:

```typescript
      if (step === 3) {
        const {
          sellingPrice,
          outstandingLoan,
          cpfSeller1,
          cpfSeller2,
          cpfSeller3,
          cpfSeller4,
          resaleLevy,
          otherDeductions,
        } = req.body;

        if (!sellingPrice || !outstandingLoan || !cpfSeller1) {
          return res.status(400).render('partials/seller/onboarding-step-3', {
            error: 'Selling price, outstanding loan, and CPF (Seller 1) are required.',
            commission: await settingsService.getCommission(),
          });
        }

        const commission = await settingsService.getCommission();

        await sellerService.saveSaleProceeds({
          sellerId,
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
      }
```

Also add import for `settingsService` at the top of the file:

```typescript
import * as settingsService from '../shared/settings.service';
```

**Step 2: Update the GET step handler to pass commission to step 3**

In the GET `/seller/onboarding/step/:step` handler, add a case for step 3 similar to step 2:

```typescript
      if (stepNum === 3) {
        const commission = await settingsService.getCommission();
        const saleProceeds = await sellerService.getSaleProceeds(sellerId);
        const property = await propertyService.getPropertyForSeller(sellerId);
        return res.render('partials/seller/onboarding-step-3', {
          commission,
          saleProceeds,
          askingPrice: property?.askingPrice ? Number(property.askingPrice) : null,
        });
      }
```

**Step 3: Update the HTMX step transition to pass commission for step 3**

In the `nextStep` rendering block, add:

```typescript
        if (nextStep === 3) {
          const commission = await settingsService.getCommission();
          const property = await propertyService.getPropertyForSeller(sellerId);
          stepData['commission'] = commission;
          stepData['askingPrice'] = property?.askingPrice ? Number(property.askingPrice) : null;
        }
```

**Step 4: Verify build**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/domains/seller/seller.router.ts
git commit -m "feat(sale-proceeds): add step 3 POST handler and GET data passing"
```

---

### Task 4: Onboarding Step 3 Template

**Files:**
- Modify: `src/views/partials/seller/onboarding-step-3.njk`

**Step 1: Replace the entire template**

```nunjucks
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="text-xl font-semibold mb-4">{{ "Estimated Sale Proceeds" | t }}</h2>

  <p class="text-gray-600 mb-4">{{ "Enter your financial details to estimate your net sale proceeds." | t }}</p>

  {% if error %}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
      {{ error }}
    </div>
  {% endif %}

  <form id="sale-proceeds-form"
    hx-post="/seller/onboarding/step/3"
    hx-target="#onboarding-step"
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
        <a href="https://my.cpf.gov.sg" target="_blank" rel="noopener" class="text-blue-600 hover:underline">{{ "Not sure? Check my.cpf.gov.sg →" | t }}</a>
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
        {{ "Save & Continue" | t }}
      </button>
    </div>
  </form>
</div>
```

**Step 2: Commit**

```bash
git add src/views/partials/seller/onboarding-step-3.njk
git commit -m "feat(sale-proceeds): replace step 3 template with calculator form"
```

---

### Task 5: Client-Side Live Calculation

**Files:**
- Modify: `public/js/app.js`

**Step 1: Add calculation logic**

At the end of `app.js` (before the final `})();`), add:

```javascript
  // ── Sale Proceeds Calculator ──────────────────────────────────
  function calculateProceeds() {
    var form = document.getElementById('sale-proceeds-form');
    if (!form) return;

    var val = function (id) {
      var el = document.getElementById(id);
      return el ? (parseFloat(el.value) || 0) : 0;
    };

    var selling = val('sellingPrice');
    var loan = val('outstandingLoan');
    var cpf1 = val('cpfSeller1');
    var cpf2 = val('cpfSeller2');
    var cpf3 = val('cpfSeller3');
    var cpf4 = val('cpfSeller4');
    var levy = val('resaleLevy');
    var other = val('otherDeductions');

    var commissionEl = form.querySelector('[name="commissionTotal"]');
    var commission = commissionEl ? parseFloat(commissionEl.value) || 0 : 0;

    var net = selling - loan - cpf1 - cpf2 - cpf3 - cpf4 - levy - other - commission;
    net = Math.round(net * 100) / 100;

    var display = document.getElementById('net-proceeds-display');
    var warning = document.getElementById('negative-warning');
    if (display) {
      display.textContent = '$' + net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      display.className = 'text-2xl font-bold ' + (net >= 0 ? 'text-green-600' : 'text-red-600');
    }
    if (warning) {
      warning.classList.toggle('hidden', net >= 0);
    }
  }

  document.body.addEventListener('input', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('sale-proceeds-input')) {
      calculateProceeds();
    }
  });

  // Trigger on HTMX load (step 3 loaded with existing data)
  document.body.addEventListener('htmx:afterSettle', function () {
    if (document.getElementById('sale-proceeds-form')) {
      calculateProceeds();
    }
  });

  // CPF "Add contributor" button
  document.body.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'add-cpf-contributor') {
      var rows = ['cpf-row-2', 'cpf-row-3', 'cpf-row-4'];
      for (var i = 0; i < rows.length; i++) {
        var row = document.getElementById(rows[i]);
        if (row && row.classList.contains('hidden')) {
          row.classList.remove('hidden');
          if (i === rows.length - 1) {
            e.target.classList.add('hidden');
          }
          break;
        }
      }
    }
  });
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat(sale-proceeds): add client-side live calculation and CPF contributor toggle"
```

---

### Task 6: Agent Visibility — Types, Service, Repository

**Files:**
- Modify: `src/domains/agent/agent.types.ts`
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/agent.repository.ts`

**Step 1: Update SellerDetail type**

In `src/domains/agent/agent.types.ts`, add to the `SellerDetail` interface:

```typescript
  saleProceeds: {
    sellingPrice: number;
    outstandingLoan: number;
    cpfTotal: number;
    resaleLevy: number;
    otherDeductions: number;
    commission: number;
    netProceeds: number;
  } | null;
```

**Step 2: Update agent repository**

In `src/domains/agent/agent.repository.ts`, find the `getSellerDetail` function and add `saleProceeds: true` to the include/select.

**Step 3: Update agent service**

In `src/domains/agent/agent.service.ts`, in the `getSellerDetail` function, map the saleProceeds:

```typescript
      saleProceeds: seller.saleProceeds ? {
        sellingPrice: Number(seller.saleProceeds.sellingPrice),
        outstandingLoan: Number(seller.saleProceeds.outstandingLoan),
        cpfTotal: Number(seller.saleProceeds.cpfSeller1)
          + Number(seller.saleProceeds.cpfSeller2 ?? 0)
          + Number(seller.saleProceeds.cpfSeller3 ?? 0)
          + Number(seller.saleProceeds.cpfSeller4 ?? 0),
        resaleLevy: Number(seller.saleProceeds.resaleLevy),
        otherDeductions: Number(seller.saleProceeds.otherDeductions),
        commission: Number(seller.saleProceeds.commission),
        netProceeds: Number(seller.saleProceeds.netProceeds),
      } : null,
```

**Step 4: Commit**

```bash
git add src/domains/agent/
git commit -m "feat(sale-proceeds): add saleProceeds to agent seller detail"
```

---

### Task 7: Agent Seller Detail View

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

**Step 1: Add financial summary to Overview card**

In the Overview card, after the "Reason to Sell" row, add:

```nunjucks
          {% if seller.saleProceeds %}
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Selling Price" | t }}</dt><dd>${{ seller.saleProceeds.sellingPrice | formatPrice }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Net Proceeds" | t }}</dt><dd class="{% if seller.saleProceeds.netProceeds >= 0 %}text-green-600{% else %}text-red-600{% endif %} font-medium">${{ seller.saleProceeds.netProceeds | formatPrice }}</dd></div>
          {% endif %}
```

**Step 2: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk
git commit -m "feat(sale-proceeds): show financial summary on agent seller detail page"
```

---

### Task 8: Test Factory + Tests

**Files:**
- Modify: `tests/fixtures/factory.ts`
- Create: `src/domains/seller/__tests__/sale-proceeds.test.ts`

**Step 1: Add saleProceeds factory**

In `tests/fixtures/factory.ts`, add:

```typescript
  async saleProceeds(overrides: {
    sellerId: string;
    sellingPrice?: number;
    outstandingLoan?: number;
    cpfSeller1?: number;
    cpfSeller2?: number;
    cpfSeller3?: number;
    cpfSeller4?: number;
    resaleLevy?: number;
    otherDeductions?: number;
    commission?: number;
    netProceeds?: number;
  }) {
    return testPrisma.saleProceeds.create({
      data: {
        id: createId(),
        sellerId: overrides.sellerId,
        sellingPrice: overrides.sellingPrice ?? 500000,
        outstandingLoan: overrides.outstandingLoan ?? 200000,
        cpfSeller1: overrides.cpfSeller1 ?? 50000,
        cpfSeller2: overrides.cpfSeller2 ?? null,
        cpfSeller3: overrides.cpfSeller3 ?? null,
        cpfSeller4: overrides.cpfSeller4 ?? null,
        resaleLevy: overrides.resaleLevy ?? 0,
        otherDeductions: overrides.otherDeductions ?? 0,
        commission: overrides.commission ?? 1633.91,
        netProceeds: overrides.netProceeds ?? 248366.09,
      },
    });
  },
```

**Step 2: Write unit test for saveSaleProceeds**

Create `src/domains/seller/__tests__/sale-proceeds.test.ts`:

```typescript
import { saveSaleProceeds, getSaleProceeds } from '../seller.service';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    saleProceeds: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../shared/settings.service');

const { prisma } = jest.requireMock('@/infra/database/prisma');

describe('saveSaleProceeds', () => {
  it('calculates net proceeds correctly with all CPF contributors', async () => {
    prisma.saleProceeds.upsert.mockResolvedValue({ id: 'sp1' });

    await saveSaleProceeds({
      sellerId: 'seller1',
      sellingPrice: 600000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      cpfSeller2: 30000,
      cpfSeller3: 10000,
      cpfSeller4: 5000,
      resaleLevy: 40000,
      otherDeductions: 5000,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 258366.09,
        }),
      }),
    );
  });

  it('calculates net proceeds with only one CPF contributor', async () => {
    prisma.saleProceeds.upsert.mockResolvedValue({ id: 'sp2' });

    await saveSaleProceeds({
      sellerId: 'seller2',
      sellingPrice: 500000,
      outstandingLoan: 200000,
      cpfSeller1: 50000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: 248366.09,
        }),
      }),
    );
  });

  it('handles negative proceeds', async () => {
    prisma.saleProceeds.upsert.mockResolvedValue({ id: 'sp3' });

    await saveSaleProceeds({
      sellerId: 'seller3',
      sellingPrice: 300000,
      outstandingLoan: 250000,
      cpfSeller1: 100000,
      resaleLevy: 0,
      otherDeductions: 0,
      commission: 1633.91,
    });

    expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          netProceeds: -51633.91,
        }),
      }),
    );
  });
});
```

**Step 3: Run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add tests/fixtures/factory.ts src/domains/seller/__tests__/sale-proceeds.test.ts
git commit -m "test(sale-proceeds): add factory and unit tests for sale proceeds calculation"
```

---

### Task 9: Final Verification

**Step 1: Build**

```bash
npm run build 2>&1 | grep -E "error" | head -10
```

Expected: 0 errors.

**Step 2: Run all tests**

```bash
npm test && npm run test:integration
```

Expected: all pass.

**Step 3: Smoke test in browser**

1. Log in as a seller in onboarding
2. Complete step 2 (property details)
3. Step 3 shows the sale proceeds calculator
4. Enter: Selling Price 500000, Outstanding Loan 200000, CPF Seller 1: 50000
5. Net Proceeds updates live: ~$248,366.09
6. Click "+ Add contributor", enter CPF Seller 2: 30000 — proceeds decrease
7. Click "Save & Continue" — advances to step 4
8. As agent: check seller detail page — shows Selling Price and Net Proceeds

**Step 4: Commit if any cleanup needed**

```bash
git add -p
git commit -m "chore(sale-proceeds): final cleanup"
```
