# Buyer Deposit Field — Sale Proceeds Estimate

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional "Buyer deposit received" field to the sale proceeds estimate so the seller's completion-day cash is correctly reduced by any deposit already in hand.

**Architecture:** The deposit is a straightforward deduction — added to the subtraction chain in `saveSaleProceeds()`. It flows through types → service → repository → router → two view partials. The Prisma column defaults to 0 so existing rows need no backfill.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Express, Nunjucks + Tailwind, Jest

---

### Task 1: Failing unit tests for the service calculation

**Files:**
- Modify: `src/domains/seller/__tests__/sale-proceeds.test.ts`

**Step 1: Add two new test cases**

After the existing `'rounds net proceeds to 2 decimal places'` test, add:

```typescript
it('deducts buyer deposit from net proceeds', async () => {
  await saveSaleProceeds({
    sellerId: 'seller5',
    sellingPrice: 500000,
    outstandingLoan: 200000,
    cpfSeller1: 50000,
    resaleLevy: 0,
    otherDeductions: 0,
    commission: 1633.91,
    buyerDeposit: 3000,
  });

  expect(prisma.saleProceeds.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        netProceeds: 245366.09,
      }),
    }),
  );
});

it('treats omitted buyer deposit as zero', async () => {
  await saveSaleProceeds({
    sellerId: 'seller6',
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
```

**Step 2: Run tests to confirm they fail**

```bash
npx jest src/domains/seller/__tests__/sale-proceeds.test.ts --no-coverage
```

Expected: 2 new tests FAIL (type error or wrong netProceeds value). Existing 4 tests pass.

---

### Task 2: Update the type

**Files:**
- Modify: `src/domains/seller/seller.types.ts:159` (after `commission: number;`)

**Step 1: Add `buyerDeposit` to `SaleProceedsInput`**

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
  buyerDeposit?: number;   // ← add this line
}
```

---

### Task 3: Update the service calculation

**Files:**
- Modify: `src/domains/seller/seller.service.ts:643-677`

**Step 1: Update `saveSaleProceeds` to subtract the deposit**

Replace lines 647–653:

```typescript
const netProceeds =
  input.sellingPrice -
  input.outstandingLoan -
  cpfTotal -
  input.resaleLevy -
  input.otherDeductions -
  input.commission -
  (input.buyerDeposit ?? 0);
```

**Step 2: Update `getSaleProceeds` mapping to expose the field**

In the return block at lines 665–676, add after `commission`:

```typescript
buyerDeposit: Number(record.buyerDeposit),
```

**Step 3: Run the unit tests — all 6 should now pass**

```bash
npx jest src/domains/seller/__tests__/sale-proceeds.test.ts --no-coverage
```

Expected: 6 PASS.

**Step 4: Commit**

```bash
git add src/domains/seller/seller.types.ts src/domains/seller/seller.service.ts src/domains/seller/__tests__/sale-proceeds.test.ts
git commit -m "feat: add buyerDeposit to sale proceeds calculation"
```

---

### Task 4: Update the repository

**Files:**
- Modify: `src/domains/seller/seller.repository.ts:94-126`

**Step 1: Add `buyerDeposit` to the upsert parameter type and `update` block**

Replace the `upsertSaleProceeds` function:

```typescript
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
  buyerDeposit?: number;
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
      buyerDeposit: data.buyerDeposit ?? 0,
      netProceeds: data.netProceeds,
    },
  });
}
```

**Step 2: Run full unit test suite to confirm no regressions**

```bash
npm test -- --no-coverage 2>&1 | tail -10
```

Expected: all suites pass (Prisma type errors will appear until the schema is updated in Task 5, but the JS tests should pass).

---

### Task 5: Add the database column (Prisma schema + migration)

**Files:**
- Modify: `prisma/schema.prisma:510` (after `otherDeductions` line)
- Create: `prisma/migrations/20260324000000_add_buyer_deposit_to_sale_proceeds/migration.sql`

**Step 1: Update the Prisma schema**

In the `SaleProceeds` model, add after `otherDeductions`:

```prisma
buyerDeposit      Decimal  @default(0) @map("buyer_deposit") @db.Decimal(12, 2)
```

The full model should now be:

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
  buyerDeposit      Decimal  @default(0) @map("buyer_deposit") @db.Decimal(12, 2)
  commission        Decimal  @map("commission") @db.Decimal(12, 2)
  netProceeds       Decimal  @map("net_proceeds") @db.Decimal(12, 2)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@map("sale_proceeds")
}
```

**Step 2: Create the migration directory and SQL file**

```bash
mkdir -p prisma/migrations/20260324000000_add_buyer_deposit_to_sale_proceeds
```

Write `prisma/migrations/20260324000000_add_buyer_deposit_to_sale_proceeds/migration.sql`:

```sql
ALTER TABLE "public"."sale_proceeds"
  ADD COLUMN "buyer_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

**Step 3: Apply the migration and regenerate the Prisma client**

> Note: `prisma migrate dev` is blocked in this project by session table drift.
> Use the deploy command instead — it applies existing migration files directly.

```bash
npm run docker:dev   # ensure dev DB is running
npx prisma migrate deploy
npx prisma generate
```

Expected output from `migrate deploy`: `1 migration applied`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260324000000_add_buyer_deposit_to_sale_proceeds/
git commit -m "feat: add buyer_deposit column to sale_proceeds table"
```

---

### Task 6: Update the router

**Files:**
- Modify: `src/domains/property/financial.router.ts:130-180`

**Step 1: Destructure `buyerDeposit` and add validation**

Replace the handler body (lines 134–168):

```typescript
const user = req.user as AuthenticatedUser;
const {
  sellingPrice,
  outstandingLoan,
  cpfSeller1,
  cpfSeller2,
  cpfSeller3,
  cpfSeller4,
  resaleLevy,
  otherDeductions,
  buyerDeposit: buyerDepositRaw,
} = req.body;

if (!sellingPrice || !outstandingLoan || !cpfSeller1) {
  const commission = await settingsService.getCommission();
  return res.status(400).render('partials/seller/financial-estimate-edit', {
    error: 'Selling price, outstanding loan, and CPF (Seller 1) are required.',
    commission,
  });
}

const buyerDeposit = parseFloat(buyerDepositRaw || '0');
if (isNaN(buyerDeposit) || buyerDeposit < 0 || buyerDeposit > 5000) {
  const commission = await settingsService.getCommission();
  return res.status(400).render('partials/seller/financial-estimate-edit', {
    error: 'Buyer deposit must be between $0 and $5,000.',
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
  buyerDeposit,
  commission: commission.total,
});
```

**Step 2: Update the router test to cover the new field**

In `src/domains/property/__tests__/financial-hub.router.test.ts`, in the `'saves sale proceeds and returns updated estimate summary'` test, add `buyerDeposit: '3000'` to the `.send({...})` body and add an assertion:

```typescript
expect(mockedSellerService.saveSaleProceeds).toHaveBeenCalledWith(
  expect.objectContaining({ buyerDeposit: 3000 }),
);
```

Also add a new test in the same `describe` block:

```typescript
it('returns 400 when buyer deposit exceeds $5000', async () => {
  const res = await request(app)
    .post('/seller/financial/estimate')
    .set('HX-Request', 'true')
    .send({
      sellingPrice: '500000',
      outstandingLoan: '200000',
      cpfSeller1: '50000',
      resaleLevy: '0',
      otherDeductions: '0',
      buyerDeposit: '9999',
    });

  expect(res.status).toBe(400);
});
```

**Step 3: Run router tests**

```bash
npx jest src/domains/property/__tests__/financial-hub.router.test.ts --no-coverage
```

Expected: all tests PASS.

**Step 4: Commit**

```bash
git add src/domains/property/financial.router.ts src/domains/property/__tests__/financial-hub.router.test.ts src/domains/seller/seller.repository.ts
git commit -m "feat: wire buyerDeposit through router and repository"
```

---

### Task 7: Update the views

**Files:**
- Modify: `src/views/partials/seller/sale-proceeds-form.njk:13-18` (after CPF section, before Resale Levy)
- Modify: `src/views/partials/seller/estimate-summary.njk:17` (after CPF Refund row)

**Step 1: Add the form input in `sale-proceeds-form.njk`**

After the closing `</div>` of the CPF section (after the `id="cpf-contributors"` block, around line 70), add a new field div **before** the Resale Levy section:

```njk
  <div class="flex items-start gap-3">
    <label class="text-sm font-medium text-gray-700 w-48 shrink-0 pt-2" for="buyerDeposit">{{ "Buyer deposit received ($)" | t }}</label>
    <div class="flex-1">
      <input type="number" id="buyerDeposit" name="buyerDeposit"
        value="{{ saleProceeds.buyerDeposit if saleProceeds else '0' }}"
        placeholder="0" min="0" max="5000" step="1"
        class="w-full border border-gray-300 rounded-md px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 sale-proceeds-input">
      <p class="text-xs text-gray-500 mt-1">{{ "Option fee + exercise fee already paid to you (max $5,000)" | t }}</p>
    </div>
  </div>
```

**Step 2: Add the summary row in `estimate-summary.njk`**

After the CPF Refund `<tr>` block (after line 24 `</tr>`), add:

```njk
      {% if saleProceeds.buyerDeposit > 0 %}
      <tr class="border-b border-gray-100">
        <td class="py-2 text-gray-600">{{ "Buyer Deposit (already received)" | t }}</td>
        <td class="py-2 text-right text-red-600">-${{ saleProceeds.buyerDeposit | formatPrice }}</td>
      </tr>
      {% endif %}
```

**Step 3: Run the full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -15
```

Expected: all suites pass.

**Step 4: Run integration tests**

```bash
npm run test:integration 2>&1 | tail -15
```

Expected: all integration tests pass.

**Step 5: Manual smoke test**

```bash
npm run dev
```

Navigate to `/seller/financial` → click "Edit Estimate" → verify:
- "Buyer deposit received ($)" field appears after CPF section
- Enter `3000` → save → summary shows "Buyer Deposit (already received) -$3,000.00"
- Enter `0` or leave blank → summary row does not appear
- Enter `9999` → form submission returns "Buyer deposit must be between $0 and $5,000."

**Step 6: Final commit**

```bash
git add src/views/partials/seller/sale-proceeds-form.njk src/views/partials/seller/estimate-summary.njk
git commit -m "feat: add buyer deposit field to sale proceeds form and summary"
```
