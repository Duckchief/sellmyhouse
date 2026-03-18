# CPF Seller-Provided Figures Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace app-calculated CPF accrued interest with a single seller-provided combined figure (principal + accrued interest), aligning strictly with HDB's own sales proceeds calculator, and add a server-side disclaimer acknowledgement mechanism.

**Architecture:** The CPF calculation is removed entirely — sellers self-report one combined CPF refund figure per owner (up to 4 owners, matching HDB's limit). The disclaimer that CPF figures are self-provided is shown server-side on form load, recorded on the Seller record, and archived in each FinancialReport's JSON data. No client-supplied acknowledgement field is trusted.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Express, Nunjucks (HTMX partials), Jest

**Spec:** `docs/superpowers/specs/2026-03-18-cpf-seller-provided-figures.md`

---

## Chunk 1: Migration, Types, Calculator, Regression Tests

### Task 1: Database migration — add cpfDisclaimerShownAt to Seller

**Files:**
- Modify: `prisma/schema.prisma` (Seller model)
- Create: `prisma/migrations/20260318100000_seller_cpf_disclaimer_shown_at/migration.sql`

**Context:** The shadow DB migration approach is required because `prisma migrate dev` is blocked by session table drift. See `MEMORY.md` for the full procedure. The new column records when an authenticated seller was last served the CPF disclaimer form — used server-side to verify they saw the disclaimer before submitting a calculation.

- [ ] **Step 1: Add field to schema**

First verify `retentionExpiresAt` exists in the Seller model (it was added in the cross-phase migration `20260314100000`):

```bash
grep retentionExpiresAt prisma/schema.prisma
```

Expected: one match inside `model Seller`. Then add the new field after it in `prisma/schema.prisma`, inside the `model Seller` block:

```prisma
cpfDisclaimerShownAt      DateTime?              @map("cpf_disclaimer_shown_at")
```

- [ ] **Step 2: Create shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
```

- [ ] **Step 3: Generate migration SQL**

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" \
  --script
```

Expected output contains:
```sql
ALTER TABLE "sellers" ADD COLUMN "cpf_disclaimer_shown_at" TIMESTAMP(3);
```

- [ ] **Step 4: Create migration file**

```bash
mkdir -p prisma/migrations/20260318100000_seller_cpf_disclaimer_shown_at
```

Create `prisma/migrations/20260318100000_seller_cpf_disclaimer_shown_at/migration.sql`:

```sql
-- AddColumn: cpf_disclaimer_shown_at on sellers
ALTER TABLE "sellers" ADD COLUMN "cpf_disclaimer_shown_at" TIMESTAMP(3);
```

- [ ] **Step 5: Deploy migration and regenerate client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied`, no errors.

- [ ] **Step 6: Drop shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260318100000_seller_cpf_disclaimer_shown_at/
git commit -m "feat: add cpf_disclaimer_shown_at column to sellers"
```

---

### Task 2: Rewrite financial types

**Files:**
- Modify: `src/domains/property/financial.types.ts`

**Context:** `CpfOwnerInput` changes from `{ oaUsed: number | null, purchaseYear: number }` to `{ cpfRefund: number }`. The input takes an array of 1–4 owners. `CpfBreakdown` is removed — the output just holds `ownerCpfRefunds: number[]`. `CreateReportInput.metadata` gains `cpfDisclaimerShownAt` so it can be archived in the JSON blob. `FinancialReportData.metadata` likewise.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/domains/property/financial.types.ts` with:

```typescript
/** Flat types for resale levy lookup */
export type FlatType = '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE' | 'MULTI-GENERATION';

export type SubsidyType = 'subsidised' | 'non_subsidised';

/**
 * One combined CPF figure per owner — principal + accrued interest combined.
 * Seller self-reports this from my.cpf.gov.sg → Home Ownership.
 * Mirrors HDB's own sales proceeds calculator approach.
 */
export interface CpfOwnerInput {
  cpfRefund: number; // total CPF monies utilised including accrued interest
}

export interface FinancialCalculationInput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfs: CpfOwnerInput[]; // 1–4 owners, matching HDB's calculator limit
  flatType: FlatType;
  subsidyType: SubsidyType;
  isFirstTimer: boolean;
  legalFeesEstimate?: number; // defaults to 2500 if not provided
}

export interface FinancialCalculationOutput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfRefunds: number[]; // parallel array to ownerCpfs — one entry per owner
  totalCpfRefund: number;
  resaleLevy: number;
  commission: number; // always from SystemSetting ($1,633.91)
  legalFees: number;
  totalDeductions: number;
  netCashProceeds: number;
  warnings: string[];
}

export interface FinancialReportData {
  inputs: FinancialCalculationInput;
  outputs: FinancialCalculationOutput;
  metadata: {
    flatType: string;
    town: string;
    leaseCommenceDate: number;
    calculatedAt: string; // ISO timestamp
    cpfDisclaimerShownAt: string; // ISO timestamp — when seller was shown the disclaimer
  };
}

export interface CreateReportInput {
  sellerId: string;
  propertyId: string;
  calculationInput: FinancialCalculationInput;
  metadata: {
    flatType: string;
    town: string;
    leaseCommenceDate: number;
    cpfDisclaimerShownAt: string; // ISO timestamp from Seller.cpfDisclaimerShownAt
  };
}

export interface ApproveReportInput {
  reportId: string;
  agentId: string;
  reviewNotes?: string;
}

export interface SendReportInput {
  reportId: string;
  agentId: string;
  channel: 'whatsapp' | 'email' | 'in_app';
}
```

- [ ] **Step 2: Verify TypeScript compiles (errors expected — will fix in subsequent tasks)**

```bash
npm run build 2>&1 | head -40
```

Expected: TypeScript errors in `financial.calculator.ts`, `financial.validator.ts`, `financial.service.ts`, and `src/domains/shared/ai/prompts/financial-narrative.ts`. All are fixed in Tasks 3–8. The errors confirm the type change propagated correctly — this is intentional at this stage.

- [ ] **Step 3: Commit**

```bash
git add src/domains/property/financial.types.ts
git commit -m "refactor: replace CpfOwnerInput with single cpfRefund field, support 1-4 owners"
```

---

### Task 3: Delete cpf-interest.ts and rewrite calculator

**Files:**
- Delete: `src/domains/property/cpf-interest.ts`
- Modify: `src/domains/property/financial.calculator.ts`
- Modify: `src/domains/property/__tests__/financial.calculator.regression.test.ts`

**Context:** The CPF interest calculation is removed entirely. The calculator now just sums seller-provided refund figures. The `currentYear` parameter is dropped since no time-based calculation exists. The regression test suite is rewritten from 26 cases to 18, covering the new array-based structure.

- [ ] **Step 1: Write the new regression test file first (TDD)**

Replace the entire contents of `src/domains/property/__tests__/financial.calculator.regression.test.ts`:

```typescript
import { calculateNetProceeds } from '../financial.calculator';
import type { FinancialCalculationInput } from '../financial.types';

/**
 * Regression suite for financial calculations.
 * CPF figures are seller-provided — the calculator performs no CPF calculation.
 * Commission is always $1,633.91 (from SystemSetting, passed in as argument).
 */
describe('Financial Calculator — Regression Suite', () => {
  const COMMISSION = 1633.91;

  const makeInput = (overrides: Partial<FinancialCalculationInput>): FinancialCalculationInput => ({
    salePrice: 500000,
    outstandingLoan: 200000,
    ownerCpfs: [{ cpfRefund: 128000 }],
    flatType: '4 ROOM',
    subsidyType: 'subsidised',
    isFirstTimer: false,
    legalFeesEstimate: 2500,
    ...overrides,
  });

  // --- Single owner ---

  it('1. Standard 4-ROOM subsidised, single owner', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION);
    expect(r.ownerCpfRefunds).toEqual([128000]);
    expect(r.totalCpfRefund).toBe(128000);
    expect(r.netCashProceeds).toBeCloseTo(500000 - 200000 - 128000 - 40000 - 1633.91 - 2500, 2);
    expect(r.warnings).toEqual([]);
  });

  it('2. Zero CPF refund (paid cash, no CPF used)', () => {
    const r = calculateNetProceeds(makeInput({ ownerCpfs: [{ cpfRefund: 0 }] }), COMMISSION);
    expect(r.totalCpfRefund).toBe(0);
    expect(r.ownerCpfRefunds).toEqual([0]);
  });

  it('3. Zero outstanding loan', () => {
    const r = calculateNetProceeds(makeInput({ outstandingLoan: 0 }), COMMISSION);
    expect(r.outstandingLoan).toBe(0);
    expect(r.netCashProceeds).toBeGreaterThan(0);
  });

  it('4. Zero loan and zero CPF — only levy, commission, legal', () => {
    const r = calculateNetProceeds(
      makeInput({ outstandingLoan: 0, ownerCpfs: [{ cpfRefund: 0 }] }),
      COMMISSION,
    );
    expect(r.totalDeductions).toBeCloseTo(40000 + 1633.91 + 2500, 2);
  });

  // --- Multiple owners ---

  it('5. Two owners', () => {
    const r = calculateNetProceeds(
      makeInput({ ownerCpfs: [{ cpfRefund: 80000 }, { cpfRefund: 70000 }] }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toEqual([80000, 70000]);
    expect(r.totalCpfRefund).toBe(150000);
  });

  it('6. Three owners', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 700000,
        ownerCpfs: [{ cpfRefund: 50000 }, { cpfRefund: 40000 }, { cpfRefund: 30000 }],
      }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toHaveLength(3);
    expect(r.totalCpfRefund).toBe(120000);
  });

  it('7. Four owners (HDB maximum)', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 800000,
        ownerCpfs: [
          { cpfRefund: 40000 },
          { cpfRefund: 35000 },
          { cpfRefund: 30000 },
          { cpfRefund: 25000 },
        ],
      }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toHaveLength(4);
    expect(r.totalCpfRefund).toBe(130000);
  });

  it('8. ownerCpfRefunds is parallel array to ownerCpfs', () => {
    const ownerCpfs = [{ cpfRefund: 60000 }, { cpfRefund: 55000 }, { cpfRefund: 45000 }];
    const r = calculateNetProceeds(makeInput({ ownerCpfs }), COMMISSION);
    expect(r.ownerCpfRefunds).toEqual([60000, 55000, 45000]);
  });

  // --- Negative net proceeds ---

  it('9. Negative net proceeds — warning, not error', () => {
    const r = calculateNetProceeds(
      makeInput({ salePrice: 100000, outstandingLoan: 300000 }),
      COMMISSION,
    );
    expect(r.netCashProceeds).toBeLessThan(0);
    expect(r.warnings).toContain(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  });

  // --- Resale levy by flat type (subsidised, second-timer) ---

  it('10. 2-ROOM levy = $15,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '2 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(15000);
  });

  it('11. 3-ROOM levy = $30,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '3 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(30000);
  });

  it('12. 5-ROOM levy = $45,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '5 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(45000);
  });

  it('13. EXECUTIVE levy = $50,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: 'EXECUTIVE' }), COMMISSION);
    expect(r.resaleLevy).toBe(50000);
  });

  it('14. Non-subsidised flat — no resale levy', () => {
    const r = calculateNetProceeds(
      makeInput({ flatType: '5 ROOM', subsidyType: 'non_subsidised' }),
      COMMISSION,
    );
    expect(r.resaleLevy).toBe(0);
  });

  it('15. First-timer — no resale levy even if subsidised', () => {
    const r = calculateNetProceeds(makeInput({ isFirstTimer: true }), COMMISSION);
    expect(r.resaleLevy).toBe(0);
  });

  // --- Commission ---

  it('16. Commission passed through unchanged', () => {
    const r = calculateNetProceeds(makeInput({}), 1633.91);
    expect(r.commission).toBe(1633.91);
  });

  // --- Legal fees ---

  it('17. Custom legal fees', () => {
    const r = calculateNetProceeds(makeInput({ legalFeesEstimate: 3000 }), COMMISSION);
    expect(r.legalFees).toBe(3000);
  });

  it('18. Default legal fees when not provided', () => {
    const r = calculateNetProceeds(makeInput({ legalFeesEstimate: undefined }), COMMISSION);
    expect(r.legalFees).toBe(2500);
  });

  // --- Consistency checks ---

  it('19. totalDeductions = sum of all components', () => {
    const r = calculateNetProceeds(
      makeInput({ ownerCpfs: [{ cpfRefund: 80000 }, { cpfRefund: 50000 }] }),
      COMMISSION,
    );
    const expected =
      r.outstandingLoan + r.totalCpfRefund + r.resaleLevy + r.commission + r.legalFees;
    expect(r.totalDeductions).toBeCloseTo(expected, 2);
  });

  it('20. netCashProceeds = salePrice - totalDeductions', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION);
    expect(r.netCashProceeds).toBeCloseTo(r.salePrice - r.totalDeductions, 2);
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL (calculator not updated yet)**

```bash
npx jest financial.calculator.regression --no-coverage 2>&1 | tail -20
```

Expected: Tests fail because `calculateNetProceeds` still has the old signature.

- [ ] **Step 3: Delete cpf-interest.ts**

```bash
git rm src/domains/property/cpf-interest.ts
```

- [ ] **Step 4: Rewrite financial.calculator.ts**

Replace the entire contents of `src/domains/property/financial.calculator.ts`:

```typescript
import type {
  FinancialCalculationInput,
  FinancialCalculationOutput,
} from './financial.types';
import { getResaleLevy } from './resale-levy';

const DEFAULT_LEGAL_FEES = 2500;

/**
 * Calculate net cash proceeds from HDB resale.
 *
 * CPF figures are seller-provided (from my.cpf.gov.sg → Home Ownership).
 * The platform performs no CPF calculations — this aligns with HDB's own
 * sales proceeds calculator approach.
 *
 * Formula:
 *   totalCpfRefund  = sum of all owner cpfRefund values
 *   totalDeductions = outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees
 *   netCashProceeds = salePrice − totalDeductions
 */
export function calculateNetProceeds(
  input: FinancialCalculationInput,
  commission: number,
): FinancialCalculationOutput {
  const warnings: string[] = [];

  const ownerCpfRefunds = input.ownerCpfs.map((o) => o.cpfRefund);
  const totalCpfRefund = Math.round(
    ownerCpfRefunds.reduce((sum, r) => sum + r, 0) * 100,
  ) / 100;

  const resaleLevy = getResaleLevy(input.flatType, input.subsidyType, input.isFirstTimer);
  const legalFees = input.legalFeesEstimate ?? DEFAULT_LEGAL_FEES;

  const totalDeductions = Math.round(
    (input.outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees) * 100,
  ) / 100;

  const netCashProceeds = Math.round((input.salePrice - totalDeductions) * 100) / 100;

  if (netCashProceeds < 0) {
    warnings.push(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  }

  return {
    salePrice: input.salePrice,
    outstandingLoan: input.outstandingLoan,
    ownerCpfRefunds,
    totalCpfRefund,
    resaleLevy,
    commission,
    legalFees,
    totalDeductions,
    netCashProceeds,
    warnings,
  };
}
```

- [ ] **Step 5: Run regression tests — expect PASS**

```bash
npx jest financial.calculator.regression --no-coverage 2>&1 | tail -20
```

Expected: `20 passed, 20 total`.

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/financial.calculator.ts \
        src/domains/property/__tests__/financial.calculator.regression.test.ts
git commit -m "feat: replace CPF calculation with seller-provided figures; support 1-4 owners"
```

---

### Task 4: Update financial.service.ts

**Files:**
- Modify: `src/domains/property/financial.service.ts`

**Context:** `calculateNetProceeds` no longer takes `currentYear` — remove it. `calculateAndCreateReport` now receives `cpfDisclaimerShownAt` in `input.metadata` and archives it in `reportData.metadata`.

- [ ] **Step 1: Update calculateAndCreateReport**

In `financial.service.ts`, replace the `calculateAndCreateReport` function body:

```typescript
export async function calculateAndCreateReport(input: CreateReportInput) {
  const commission = await settingsService.getCommission();

  const outputs = calculateNetProceeds(input.calculationInput, commission.total);

  // Determine version
  const latest = await financialRepo.findLatestForProperty(input.sellerId, input.propertyId);
  const version = latest ? latest.version + 1 : 1;

  const reportData: FinancialReportData = {
    inputs: input.calculationInput,
    outputs,
    metadata: {
      ...input.metadata,
      calculatedAt: new Date().toISOString(),
    },
  };

  const id = createId();
  const report = await financialRepo.create({
    id,
    sellerId: input.sellerId,
    propertyId: input.propertyId,
    reportData,
    version,
  });

  await auditService.log({
    action: 'financial.report_generated',
    entityType: 'financial_report',
    entityId: id,
    details: { version, sellerId: input.sellerId, propertyId: input.propertyId },
  });

  return report;
}
```

- [ ] **Step 2: Update financial.service.test.ts to match new types**

Open `src/domains/property/__tests__/financial.service.test.ts`. Find any `sampleInput` or mock input using `owner1Cpf`, `owner2Cpf`, `purchaseYear`, or `oaUsed`. Replace with the new array shape. For example:

```typescript
// BEFORE
owner1Cpf: { oaUsed: 100000, purchaseYear: 2016 },

// AFTER
ownerCpfs: [{ cpfRefund: 128000 }],
```

Also update any assertions that check `reportData.outputs.owner1Cpf` or `owner2Cpf` — replace with `ownerCpfRefunds` array checks. Also update any `createAndCalculateReport` calls that pass `currentYear`.

- [ ] **Step 3: Run unit tests for the service**

```bash
npx jest financial.service --no-coverage 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 4: Remove old acknowledgeDisclaimer mechanism**

The old design had a client-triggered disclaimer on the `FinancialReport` itself. The new design replaces it with a server-side record on `Seller`. Remove the orphaned code:

In `financial.router.ts`, delete the entire `POST /seller/financial/report/:id/acknowledge-disclaimer` route handler.

In `financial.service.ts`, delete the `acknowledgeDisclaimer` function.

In `financial.repository.ts`, delete the `acknowledgeDisclaimer` function.

Note: `disclaimerAcknowledgedAt` column on `FinancialReport` in the DB can remain (dropping a column requires a migration; the field going unused is harmless). Do not remove it from `prisma/schema.prisma`.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/financial.service.ts \
        src/domains/property/financial.router.ts \
        src/domains/property/financial.repository.ts \
        src/domains/property/__tests__/financial.service.test.ts
git commit -m "refactor: remove currentYear, remove old acknowledgeDisclaimer mechanism"
```

---

## Chunk 2: Validator, Seller Disclaimer Logic, Router, Views

### Task 5: Rewrite financial.validator.ts

**Files:**
- Modify: `src/domains/property/financial.validator.ts`

**Context:** `parseCpfInput()` is deleted. CPF input is now an array of 1–4 required non-negative numbers. `purchaseYear` is removed entirely. Field names in the POST body are `cpfRefund1`, `cpfRefund2`, `cpfRefund3`, `cpfRefund4` — the validator collects whichever are present into the `ownerCpfs` array, requiring at least one.

- [ ] **Step 1: Write the failing validator unit test**

Create `src/domains/property/__tests__/financial.validator.test.ts`:

```typescript
import { validateCalculationInput } from '../financial.validator';
import { ValidationError } from '@/domains/shared/errors';

describe('validateCalculationInput', () => {
  const base = {
    salePrice: '500000',
    outstandingLoan: '200000',
    cpfRefund1: '128000',
    flatType: '4 ROOM',
    subsidyType: 'subsidised',
    isFirstTimer: 'false',
  };

  it('parses single owner correctly', () => {
    const result = validateCalculationInput(base);
    expect(result.ownerCpfs).toEqual([{ cpfRefund: 128000 }]);
  });

  it('parses up to 4 owners', () => {
    const result = validateCalculationInput({
      ...base,
      cpfRefund2: '70000',
      cpfRefund3: '50000',
      cpfRefund4: '30000',
    });
    expect(result.ownerCpfs).toHaveLength(4);
    expect(result.ownerCpfs[3].cpfRefund).toBe(30000);
  });

  it('allows cpfRefund of 0 (paid cash)', () => {
    const result = validateCalculationInput({ ...base, cpfRefund1: '0' });
    expect(result.ownerCpfs[0].cpfRefund).toBe(0);
  });

  it('throws ValidationError when no CPF refund provided', () => {
    const { cpfRefund1, ...withoutCpf } = base;
    expect(() => validateCalculationInput(withoutCpf)).toThrow(ValidationError);
  });

  it('throws ValidationError when cpfRefund is negative', () => {
    expect(() => validateCalculationInput({ ...base, cpfRefund1: '-1000' })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when salePrice is missing', () => {
    const { salePrice, ...withoutPrice } = base;
    expect(() => validateCalculationInput(withoutPrice)).toThrow(ValidationError);
  });

  it('throws ValidationError when salePrice is zero', () => {
    expect(() => validateCalculationInput({ ...base, salePrice: '0' })).toThrow(ValidationError);
  });

  it('throws ValidationError when outstandingLoan is negative', () => {
    expect(() => validateCalculationInput({ ...base, outstandingLoan: '-1' })).toThrow(
      ValidationError,
    );
  });

  it('defaults legalFeesEstimate to undefined when not provided', () => {
    const result = validateCalculationInput(base);
    expect(result.legalFeesEstimate).toBeUndefined();
  });

  it('parses legalFeesEstimate when provided', () => {
    const result = validateCalculationInput({ ...base, legalFeesEstimate: '3000' });
    expect(result.legalFeesEstimate).toBe(3000);
  });

  it('parses isFirstTimer as boolean', () => {
    const t = validateCalculationInput({ ...base, isFirstTimer: 'true' });
    const f = validateCalculationInput({ ...base, isFirstTimer: 'false' });
    expect(t.isFirstTimer).toBe(true);
    expect(f.isFirstTimer).toBe(false);
  });

  it('does not include purchaseYear in output', () => {
    const result = validateCalculationInput({ ...base, purchaseYear: '2010' });
    // purchaseYear should be silently ignored — not in FinancialCalculationInput
    expect(result.ownerCpfs[0]).toEqual({ cpfRefund: 128000 });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
npx jest financial.validator --no-coverage 2>&1 | tail -20
```

Expected: Fails because the validator still has the old implementation.

- [ ] **Step 3: Rewrite financial.validator.ts**

Replace the entire contents of `src/domains/property/financial.validator.ts`:

```typescript
import { ValidationError } from '@/domains/shared/errors';
import type {
  FinancialCalculationInput,
  FlatType,
  SubsidyType,
  CpfOwnerInput,
} from './financial.types';

const VALID_FLAT_TYPES: FlatType[] = [
  '2 ROOM',
  '3 ROOM',
  '4 ROOM',
  '5 ROOM',
  'EXECUTIVE',
  'MULTI-GENERATION',
];

const VALID_SUBSIDY_TYPES: SubsidyType[] = ['subsidised', 'non_subsidised'];

const VALID_SEND_CHANNELS = ['whatsapp', 'email', 'in_app'] as const;

/**
 * Validate and parse the financial calculation form submission.
 *
 * CPF inputs: cpfRefund1 (required), cpfRefund2–cpfRefund4 (optional).
 * Each is the seller's combined CPF figure (principal + accrued interest)
 * self-reported from my.cpf.gov.sg → Home Ownership.
 *
 * purchaseYear is no longer accepted — the platform performs no CPF calculations.
 */
export function validateCalculationInput(body: Record<string, unknown>): FinancialCalculationInput {
  // Sale price
  if (!body.salePrice && body.salePrice !== 0) {
    throw new ValidationError('Sale price is required');
  }
  const salePrice = Number(body.salePrice);
  if (isNaN(salePrice) || salePrice <= 0) {
    throw new ValidationError('Sale price must be greater than zero');
  }

  // Outstanding loan
  const outstandingLoan = Number(body.outstandingLoan ?? 0);
  if (isNaN(outstandingLoan) || outstandingLoan < 0) {
    throw new ValidationError('Outstanding loan cannot be negative');
  }

  // Flat type
  const flatType = body.flatType as string;
  if (!VALID_FLAT_TYPES.includes(flatType as FlatType)) {
    throw new ValidationError(`Invalid flat type: ${flatType}`);
  }

  // Subsidy type
  const subsidyType = (body.subsidyType as string) || 'subsidised';
  if (!VALID_SUBSIDY_TYPES.includes(subsidyType as SubsidyType)) {
    throw new ValidationError(`Invalid subsidy type: ${subsidyType}`);
  }

  // CPF owner inputs — cpfRefund1 required, cpfRefund2–4 optional
  const ownerCpfs: CpfOwnerInput[] = [];
  for (let i = 1; i <= 4; i++) {
    const raw = body[`cpfRefund${i}`];
    if (raw === undefined || raw === null || raw === '') {
      if (i === 1) throw new ValidationError('CPF refund for Owner 1 is required');
      break; // owners are contiguous — stop at first gap
    }
    const value = Number(raw);
    if (isNaN(value) || value < 0) {
      throw new ValidationError(`CPF refund for Owner ${i} must be a non-negative number`);
    }
    ownerCpfs.push({ cpfRefund: value });
  }

  // Legal fees
  const legalFeesEstimate =
    body.legalFeesEstimate !== undefined && body.legalFeesEstimate !== ''
      ? Number(body.legalFeesEstimate)
      : undefined;

  return {
    salePrice,
    outstandingLoan,
    ownerCpfs,
    flatType: flatType as FlatType,
    subsidyType: subsidyType as SubsidyType,
    isFirstTimer: body.isFirstTimer === true || body.isFirstTimer === 'true',
    legalFeesEstimate,
  };
}

export function validateApproveInput(body: Record<string, unknown>): { reviewNotes?: string } {
  return {
    reviewNotes: body.reviewNotes ? String(body.reviewNotes) : undefined,
  };
}

export function validateSendInput(body: Record<string, unknown>): {
  channel: 'whatsapp' | 'email' | 'in_app';
} {
  const channel = (body.channel as string) || 'whatsapp';
  if (!(VALID_SEND_CHANNELS as readonly string[]).includes(channel)) {
    throw new ValidationError(`Invalid channel: ${channel}`);
  }
  return { channel: channel as 'whatsapp' | 'email' | 'in_app' };
}
```

- [ ] **Step 4: Run validator tests — expect PASS**

```bash
npx jest financial.validator --no-coverage 2>&1 | tail -20
```

Expected: `13 passed, 13 total`.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/financial.validator.ts \
        src/domains/property/__tests__/financial.validator.test.ts
git commit -m "feat: rewrite validator for seller-provided CPF figures (1-4 owners)"
```

---

### Task 6: Add cpfDisclaimerShown to seller repository

**Files:**
- Modify: `src/domains/seller/seller.repository.ts`

**Context:** A new repository function records when an authenticated seller was served the CPF disclaimer form. This is called by the financial router's GET handler and is the server-side proof that the disclaimer was shown.

- [ ] **Step 1: Write the failing test**

In `src/domains/seller/__tests__/seller.repository.test.ts`, add this test inside the existing describe block:

```typescript
describe('recordCpfDisclaimerShown', () => {
  it('updates cpfDisclaimerShownAt on the seller', async () => {
    const before = new Date();
    mockPrisma.seller.update.mockResolvedValue({
      id: 'seller-1',
      cpfDisclaimerShownAt: new Date(),
    });

    await sellerRepo.recordCpfDisclaimerShown('seller-1');

    expect(mockPrisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { cpfDisclaimerShownAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
npx jest seller.repository --no-coverage 2>&1 | tail -20
```

Expected: Fails — `recordCpfDisclaimerShown` does not exist.

- [ ] **Step 3: Add the function to seller.repository.ts**

At the end of `src/domains/seller/seller.repository.ts`, add:

```typescript
/**
 * Record that this seller was served the CPF disclaimer form.
 * Called on GET /seller/financial/form — provides server-side proof
 * the disclaimer was shown before any calculation is submitted.
 */
export async function recordCpfDisclaimerShown(id: string): Promise<void> {
  await prisma.seller.update({
    where: { id },
    data: { cpfDisclaimerShownAt: new Date() },
  });
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx jest seller.repository --no-coverage 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/seller/seller.repository.ts \
        src/domains/seller/__tests__/seller.repository.test.ts
git commit -m "feat: add recordCpfDisclaimerShown to seller repository"
```

---

### Task 7: Update financial router

**Files:**
- Modify: `src/domains/property/financial.router.ts`

**Context:** Two changes:
1. GET `/seller/financial/form` — calls `sellerRepo.recordCpfDisclaimerShown(user.id)` so the timestamp is set before the form is rendered.
2. POST `/seller/financial/calculate` — fetches the seller, checks `cpfDisclaimerShownAt IS NOT NULL`, throws `ForbiddenError` if not set. Reads `cpfDisclaimerShownAt` from the seller record and passes it into `CreateReportInput.metadata`.

- [ ] **Step 1: Add recordCpfDisclaimerShown wrapper to seller.service.ts**

CLAUDE.md requires cross-domain communication to go through services, not repositories. Add a thin wrapper to `src/domains/seller/seller.service.ts`:

```typescript
export async function recordCpfDisclaimerShown(sellerId: string): Promise<void> {
  await sellerRepo.recordCpfDisclaimerShown(sellerId);
}
```

Then import the service (not the repo) in `financial.router.ts`:

```typescript
import * as sellerService from '@/domains/seller/seller.service';
```

Use `sellerService.recordCpfDisclaimerShown(user.id)` and `sellerService.findById(user.id)` in the route handlers below. Verify `findById` is already exported from `seller.service.ts` (it should be — check the existing exports).

- [ ] **Step 2: Update GET /seller/financial/form handler**

Replace the existing GET form handler. Note: this also intentionally adds `requireRole('seller')` — the original handler only had `requireAuth()`, which is a security gap since agents could also trigger the disclaimer recording.

```typescript
financialRouter.get(
  '/seller/financial/form',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      // Record that this authenticated seller was served the disclaimer.
      // This is the server-side proof used to gate POST /calculate.
      await sellerRepo.recordCpfDisclaimerShown(user.id);
      res.render('partials/seller/financial-form');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Update POST /seller/financial/calculate handler**

Replace the existing POST calculate handler:

```typescript
financialRouter.post(
  '/seller/financial/calculate',
  requireAuth(),
  requireRole('seller'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      // Gate: seller must have loaded the form (which shows the disclaimer)
      // before they can submit a calculation. Prevents crafted direct API calls
      // from bypassing the disclaimer entirely.
      const seller = await sellerRepo.findById(user.id);
      if (!seller?.cpfDisclaimerShownAt) {
        throw new ForbiddenError(
          'Please load the financial calculator form before submitting.',
        );
      }

      const input = validateCalculationInput(req.body);

      const report = await financialService.calculateAndCreateReport({
        sellerId: user.id,
        propertyId: req.body.propertyId as string,
        calculationInput: input,
        metadata: {
          flatType: req.body.flatType as string,
          town: (req.body.town as string) || '',
          leaseCommenceDate: Number(req.body.leaseCommenceDate) || 0,
          cpfDisclaimerShownAt: seller.cpfDisclaimerShownAt.toISOString(),
        },
      });

      // Auto-generate narrative (fire-and-forget)
      financialService.generateNarrative(report.id).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, reportId: report.id }, 'Narrative generation failed');
        auditService
          .log({
            action: 'financial.narrative_generation_failed',
            entityType: 'financial_report',
            entityId: report.id,
            details: { error: errorMessage },
          })
          .catch(() => {});
      });

      if (req.headers['hx-request']) {
        return res.render('partials/seller/financial-report', { report });
      }
      return res.json({ success: true, report });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Verify ForbiddenError is imported**

Check the imports at the top of `financial.router.ts` include `ForbiddenError`:

```typescript
import { ForbiddenError } from '@/domains/shared/errors';
```

Add it if missing.

- [ ] **Step 5: Run all financial domain tests**

```bash
npx jest financial --no-coverage 2>&1 | tail -30
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/property/financial.router.ts
git commit -m "feat: gate POST /calculate on cpfDisclaimerShownAt; record disclaimer on form GET"
```

---

### Task 8: Update financial-narrative prompt

**Files:**
- Modify: `src/domains/shared/ai/prompts/financial-narrative.ts`

**Context:** The prompt previously referenced `output.owner1Cpf`, `output.owner2Cpf`, and `isEstimated`. These are replaced with a loop over `output.ownerCpfRefunds`. The "estimated" note is removed entirely — figures are now seller-provided.

- [ ] **Step 1: Rewrite financial-narrative.ts**

Replace the entire contents of `src/domains/shared/ai/prompts/financial-narrative.ts`:

```typescript
import type { FinancialCalculationOutput } from '../../../property/financial.types';

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function buildFinancialNarrativePrompt(
  output: FinancialCalculationOutput,
  context: { town: string; flatType: string },
): string {
  const sections: string[] = [];

  sections.push(
    `You are a helpful assistant for SellMyHomeNow.sg, a Singapore HDB resale transaction platform.`,
  );
  sections.push(
    `Write a clear, friendly, plain-language summary of this seller's estimated financial breakdown for selling their ${context.flatType} flat in ${context.town}.`,
  );
  sections.push('');
  sections.push('## Financial Figures');
  sections.push(`- Sale Price: $${formatCurrency(output.salePrice)}`);
  sections.push(`- Outstanding Loan: $${formatCurrency(output.outstandingLoan)}`);

  // CPF refunds — seller-provided figures, one per owner
  output.ownerCpfRefunds.forEach((refund, i) => {
    sections.push(`- Owner ${i + 1} CPF Refund: $${formatCurrency(refund)}`);
  });

  sections.push(`- Total CPF Refund: $${formatCurrency(output.totalCpfRefund)}`);
  sections.push(`- Resale Levy: $${formatCurrency(output.resaleLevy)}`);
  sections.push(`- Commission (including GST): $${formatCurrency(output.commission)}`);
  sections.push(`- Estimated Legal Fees: $${formatCurrency(output.legalFees)}`);
  sections.push(`- **Estimated Net Cash Proceeds: $${formatCurrency(output.netCashProceeds)}**`);

  if (output.netCashProceeds < 0) {
    sections.push('');
    sections.push(
      'IMPORTANT: The net proceeds are negative. The seller needs to be informed sensitively that the sale proceeds may not cover all deductions.',
    );
  }

  sections.push('');
  sections.push('## Instructions');
  sections.push('- Write 3-5 short paragraphs in simple English');
  sections.push('- Explain each deduction briefly so the seller understands where the money goes');
  sections.push('- Use a reassuring, professional tone');
  sections.push(
    '- End with a disclaimer: "This is an estimate only and does not constitute financial advice. The CPF figures used are based on figures provided by the seller. Please refer to CPF Board (my.cpf.gov.sg) and HDB (hdb.gov.sg) for exact figures."',
  );
  sections.push('- Do NOT provide financial advice or make recommendations');
  sections.push('- Do NOT use technical jargon');

  return sections.join('\n');
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All pass, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/shared/ai/prompts/financial-narrative.ts
git commit -m "refactor: update financial narrative prompt for seller-provided CPF figures"
```

---

### Task 9: Update financial-form.njk

**Files:**
- Modify: `src/views/partials/seller/financial-form.njk`

**Context:** The CPF section changes from two named fields (OA Used + Year of Purchase) to a dynamic 1–4 owner block structure. Each block has one required field: "CPF Monies Utilised, Including Accrued Interest". An "Add owner" button appends up to 3 additional blocks (4 total). A plain-text disclaimer replaces the previous hint text. No checkbox.

- [ ] **Step 1: Replace the CPF section and disclaimer in financial-form.njk**

Replace the entire file contents with:

```njk
{#
  Variables: (none)
  HTMX partial — renders into #financial-content.
  Served by GET /seller/financial/form.

  Server records cpfDisclaimerShownAt on the Seller when this form is loaded.
  POST /seller/financial/calculate checks that field before processing.
#}
<div class="bg-white rounded-lg shadow p-6">
  <h2 class="font-semibold text-gray-900 mb-1">{{ "Estimate Your Net Cash Proceeds" | t }}</h2>
  <p class="text-xs text-gray-500 mb-6">
    {{ "Figures are indicative only. Always verify CPF and HDB amounts directly." | t }}
  </p>

  <form
    hx-post="/seller/financial/calculate"
    hx-target="#financial-content"
    hx-swap="innerHTML"
    hx-indicator="#calc-spinner"
    class="space-y-5"
  >
    {# Property reference #}
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="propertyId">
        {{ "Property ID" | t }} <span class="text-red-500">*</span>
      </label>
      <input type="text" id="propertyId" name="propertyId" required
             class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
             placeholder="{{ 'e.g. clx...' | t }}">
      <p class="mt-1 text-xs text-gray-400">{{ "Find your Property ID on your seller dashboard." | t }}</p>
    </div>

    {# Sale price #}
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="salePrice">
        {{ "Expected Sale Price (SGD)" | t }} <span class="text-red-500">*</span>
      </label>
      <input type="number" id="salePrice" name="salePrice" required min="1" step="1000"
             class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
    </div>

    {# Outstanding loan #}
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="outstandingLoan">
        {{ "Outstanding HDB / Bank Loan (SGD)" | t }}
      </label>
      <input type="number" id="outstandingLoan" name="outstandingLoan" min="0" step="1000" value="0"
             class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
    </div>

    {# Flat type + town #}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="flatType">
          {{ "Flat Type" | t }} <span class="text-red-500">*</span>
        </label>
        <select id="flatType" name="flatType" required
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{{ "Select…" | t }}</option>
          <option value="2 ROOM">2 Room</option>
          <option value="3 ROOM">3 Room</option>
          <option value="4 ROOM">4 Room</option>
          <option value="5 ROOM">5 Room</option>
          <option value="EXECUTIVE">Executive</option>
          <option value="MULTI-GENERATION">Multi-Generation</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="town">
          {{ "Town / Estate" | t }}
        </label>
        <input type="text" id="town" name="town"
               class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
    </div>

    {# Lease commence + subsidy #}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="leaseCommenceDate">
          {{ "Lease Commence Year" | t }}
        </label>
        <input type="number" id="leaseCommenceDate" name="leaseCommenceDate"
               min="1960" max="2030" placeholder="e.g. 1995"
               class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="subsidyType">
          {{ "HDB Subsidy Status" | t }}
        </label>
        <select id="subsidyType" name="subsidyType"
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="subsidised">{{ "Subsidised (received HDB grant)" | t }}</option>
          <option value="non_subsidised">{{ "Non-subsidised (no HDB grant)" | t }}</option>
        </select>
      </div>
    </div>

    {# First timer #}
    <div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" name="isFirstTimer" value="true"
               class="h-4 w-4 text-blue-600 border-gray-300 rounded">
        <span class="text-sm text-gray-700">
          {{ "First-timer application (affects resale levy)" | t }}
        </span>
      </label>
    </div>

    {# CPF section — 1 to 4 owners #}
    <div class="border-t border-gray-100 pt-4">
      <h3 class="text-sm font-semibold text-gray-700 mb-1">{{ "CPF Monies Utilised" | t }}</h3>
      <p class="text-xs text-gray-500 mb-3">
        {{ "Log in to" | t }}
        <a href="https://www.cpf.gov.sg/member/ds/dashboards/home-ownership"
           target="_blank" rel="noopener"
           class="text-blue-600 hover:underline">my.cpf.gov.sg → Home Ownership</a>
        {{ "to find the total CPF monies utilised including accrued interest for each owner." | t }}
      </p>

      <div id="cpf-owners" class="space-y-3">
        {# Owner 1 — always visible #}
        <div class="cpf-owner-block">
          <label class="block text-xs font-medium text-gray-600 mb-1">
            {{ "Owner 1 — CPF Monies Utilised, Including Accrued Interest (SGD)" | t }}
            <span class="text-red-500">*</span>
          </label>
          <input type="number" name="cpfRefund1" required min="0" step="1"
                 class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 placeholder="e.g. 128000">
        </div>
      </div>

      {# Add owner button — hidden once 4 owners are added #}
      <button type="button" id="add-owner-btn"
              class="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
        + {{ "Add another owner" | t }}
      </button>

      {# Hidden template for additional owner blocks #}
      <template id="cpf-owner-template">
        <div class="cpf-owner-block">
          <label class="block text-xs font-medium text-gray-600 mb-1">
            <span class="owner-label"></span>
            <span class="text-red-500">*</span>
          </label>
          <input type="number" min="0" step="1" required
                 class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 placeholder="e.g. 95000">
        </div>
      </template>

      <script nonce="{{ cspNonce }}">
        (function () {
          const container = document.getElementById('cpf-owners');
          const addBtn = document.getElementById('add-owner-btn');
          const template = document.getElementById('cpf-owner-template');
          const MAX_OWNERS = 4;
          let ownerCount = 1;

          addBtn.addEventListener('click', function () {
            if (ownerCount >= MAX_OWNERS) return;
            ownerCount++;
            const clone = template.content.cloneNode(true);
            clone.querySelector('.owner-label').textContent =
              'Owner ' + ownerCount + ' — CPF Monies Utilised, Including Accrued Interest (SGD)';
            clone.querySelector('input').name = 'cpfRefund' + ownerCount;
            container.appendChild(clone);
            if (ownerCount >= MAX_OWNERS) addBtn.classList.add('hidden');
          });
        })();
      </script>
    </div>

    {# Legal fees #}
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="legalFeesEstimate">
        {{ "Legal Fees Estimate (SGD)" | t }}
      </label>
      <input type="number" id="legalFeesEstimate" name="legalFeesEstimate" min="0" placeholder="2500"
             class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      <p class="mt-1 text-xs text-gray-400">{{ "Defaults to $2,500 if left blank." | t }}</p>
    </div>

    {# CPF disclaimer — plain text, no checkbox #}
    <div class="rounded-md bg-amber-50 border border-amber-200 p-4">
      <p class="text-xs font-semibold text-amber-800 mb-1">{{ "Important" | t }}</p>
      <p class="text-xs text-amber-700">
        {{ "The CPF figures used in this calculation are based solely on figures you have provided. This estimate may not reflect your actual CPF obligation. Always verify using the latest figures from your CPF account before making any financial decisions." | t }}
      </p>
    </div>

    <div class="pt-2 flex items-center gap-3">
      <button type="submit"
              class="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
        {{ "Calculate" | t }}
      </button>
      <span id="calc-spinner" class="htmx-indicator text-sm text-gray-500">
        {{ "Calculating…" | t }}
      </span>
    </div>
  </form>
</div>
```

- [ ] **Step 2: Verify the build compiles cleanly**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/seller/financial-form.njk
git commit -m "feat: update financial form for seller-provided CPF figures (1-4 owners) with plain-text disclaimer"
```

---

### Task 10: Update financial-report.njk

**Files:**
- Modify: `src/views/partials/seller/financial-report.njk`

**Context:** CPF rows change from named `owner1Cpf`/`owner2Cpf` objects (with principal/interest breakdown) to a loop over `ownerCpfRefunds` array. Remove `isEstimated` badges. Remove the principal/interest sub-rows.

- [ ] **Step 1: Rewrite financial-report.njk**

The CPF section spans lines 106–139 in the existing file (two owner blocks with principal/interest sub-rows and isEstimated badges). Replace the **entire file** with the version below to avoid ambiguous partial replacements:

```njk
{#
  Variables: report (FinancialReport)
    report.reportData: { inputs, outputs, metadata }
    report.aiNarrative: string | null
    report.status: FinancialReportStatus
    report.version: number
    report.approvedAt: Date | null
    report.sentToSellerAt: Date | null
#}
{% set data = report.reportData %}
{% set out = data.outputs %}
{% set inp = data.inputs %}

<div class="bg-white rounded-lg shadow p-6 space-y-6">

  {# ── Header row ────────────────────────────────── #}
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="font-semibold text-gray-900">
        {{ data.metadata.flatType }}{% if data.metadata.town %} · {{ data.metadata.town }}{% endif %}
      </h2>
      <p class="text-xs text-gray-400 mt-0.5">
        {{ "Calculated:" | t }} {{ data.metadata.calculatedAt | date }} · {{ "v" }}{{ report.version }}
      </p>
    </div>
    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
      {% if report.status == 'sent' %}bg-green-100 text-green-700
      {% elif report.status == 'approved' %}bg-blue-100 text-blue-700
      {% elif report.status == 'pending_review' %}bg-yellow-100 text-yellow-700
      {% else %}bg-gray-100 text-gray-600{% endif %}">
      {{ report.status | t }}
    </span>
  </div>

  {# ── Warnings ─────────────────────────────────── #}
  {% if out.warnings and out.warnings.length > 0 %}
  <div class="space-y-2">
    {% for warning in out.warnings %}
    <div class="flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 p-3">
      <svg class="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      <p class="text-xs text-yellow-800">{{ warning }}</p>
    </div>
    {% endfor %}
  </div>
  {% endif %}

  {# ── AI Narrative ─────────────────────────────── #}
  {% if report.aiNarrative %}
  <div class="rounded-md bg-blue-50 border border-blue-100 p-4">
    <p class="text-xs font-semibold text-blue-700 mb-1">{{ "Agent Commentary" | t }}</p>
    <p class="text-sm text-gray-800">{{ report.aiNarrative }}</p>
    <p class="mt-2 text-xs text-gray-400">
      {{ "AI-generated summary. For indicative purposes only." | t }}
    </p>
  </div>
  {% else %}
  <div class="rounded-md bg-gray-50 border border-gray-200 p-4 flex items-center gap-3">
    <svg class="h-4 w-4 text-gray-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    <p class="text-sm text-gray-500">{{ "Agent commentary is being generated. Refresh this report in a moment." | t }}</p>
  </div>
  {% endif %}

  {# ── Net proceeds — prominent summary ────────── #}
  <div class="rounded-lg bg-green-50 border border-green-200 p-5 text-center">
    <p class="text-xs font-medium text-green-700 uppercase tracking-wide mb-1">
      {{ "Estimated Net Cash Proceeds" | t }}
    </p>
    <p class="text-3xl font-bold
      {% if out.netCashProceeds < 0 %}text-red-600{% else %}text-green-800{% endif %}">
      ${{ out.netCashProceeds }}
    </p>
    <p class="text-xs text-gray-500 mt-1">
      {{ "Sale price minus all deductions below." | t }}
    </p>
  </div>

  {# ── Deductions breakdown ─────────────────────── #}
  <div>
    <h3 class="text-sm font-semibold text-gray-700 mb-3">{{ "Deductions Breakdown" | t }}</h3>
    <div class="space-y-1">

      {# Sale price (reference row) #}
      <div class="flex justify-between text-sm py-1 border-b border-gray-100">
        <span class="text-gray-600">{{ "Sale Price" | t }}</span>
        <span class="font-medium text-gray-900">${{ out.salePrice }}</span>
      </div>

      {# Outstanding loan #}
      <div class="flex justify-between text-sm py-1">
        <span class="text-gray-600">{{ "Outstanding Loan" | t }}</span>
        <span class="text-red-600">−${{ out.outstandingLoan }}</span>
      </div>

      {# CPF Refunds — seller-provided, one row per owner #}
      {% for refund in out.ownerCpfRefunds %}
      <div class="flex justify-between text-sm py-1">
        <span class="text-gray-600">{{ "CPF Refund — Owner" | t }} {{ loop.index }}</span>
        <span class="text-red-600">−${{ refund }}</span>
      </div>
      {% endfor %}

      {# Resale levy #}
      <div class="flex justify-between text-sm py-1">
        <span class="text-gray-600">{{ "Resale Levy" | t }}</span>
        <span class="{% if out.resaleLevy > 0 %}text-red-600{% else %}text-gray-500{% endif %}">
          {% if out.resaleLevy > 0 %}−${{ out.resaleLevy }}{% else %}{{ "None" | t }}{% endif %}
        </span>
      </div>

      {# Commission #}
      <div class="flex justify-between text-sm py-1">
        <span class="text-gray-600">{{ "Commission (incl. GST)" | t }}</span>
        <span class="text-red-600">−${{ out.commission }}</span>
      </div>

      {# Legal fees #}
      <div class="flex justify-between text-sm py-1">
        <span class="text-gray-600">{{ "Legal Fees (estimate)" | t }}</span>
        <span class="text-red-600">−${{ out.legalFees }}</span>
      </div>

      {# Total deductions #}
      <div class="flex justify-between text-sm py-2 border-t border-gray-200 mt-1">
        <span class="font-semibold text-gray-700">{{ "Total Deductions" | t }}</span>
        <span class="font-semibold text-red-700">−${{ out.totalDeductions }}</span>
      </div>

      {# Net proceeds (repeat — in table context) #}
      <div class="flex justify-between text-sm py-1 bg-gray-50 rounded px-2">
        <span class="font-bold text-gray-900">{{ "Net Cash Proceeds" | t }}</span>
        <span class="font-bold {% if out.netCashProceeds < 0 %}text-red-700{% else %}text-green-700{% endif %}">
          ${{ out.netCashProceeds }}
        </span>
      </div>
    </div>
  </div>

  {# ── CPF disclaimer notice ─────────────────────── #}
  <div class="rounded-md bg-amber-50 border border-amber-200 p-3">
    <p class="text-xs text-amber-700">
      {{ "CPF figures are based on information provided by the seller from their CPF account. This estimate does not constitute financial advice." | t }}
    </p>
  </div>

  {# ── Sale inputs reference ────────────────────── #}
  <details class="text-sm">
    <summary class="cursor-pointer text-gray-500 hover:text-gray-700 font-medium select-none">
      {{ "Input Parameters" | t }}
    </summary>
    <div class="mt-3 space-y-1 text-xs text-gray-600">
      <div class="flex justify-between py-0.5">
        <span>{{ "Flat Type" | t }}</span><span class="font-medium">{{ inp.flatType }}</span>
      </div>
      <div class="flex justify-between py-0.5">
        <span>{{ "Subsidy Type" | t }}</span><span class="font-medium">{{ inp.subsidyType }}</span>
      </div>
      <div class="flex justify-between py-0.5">
        <span>{{ "First Timer" | t }}</span>
        <span class="font-medium">{% if inp.isFirstTimer %}{{ "Yes" | t }}{% else %}{{ "No" | t }}{% endif %}</span>
      </div>
      {% if data.metadata.leaseCommenceDate %}
      <div class="flex justify-between py-0.5">
        <span>{{ "Lease Commenced" | t }}</span><span class="font-medium">{{ data.metadata.leaseCommenceDate }}</span>
      </div>
      {% endif %}
    </div>
  </details>

  {# ── Recalculate link ─────────────────────────── #}
  <div class="border-t border-gray-100 pt-4">
    <button
      type="button"
      hx-get="/seller/financial/form"
      hx-target="#financial-content"
      hx-swap="innerHTML"
      class="text-sm text-blue-600 hover:text-blue-800 font-medium"
    >
      ← {{ "Run a new calculation" | t }}
    </button>
  </div>

</div>
```

- [ ] **Step 2: Verify the template renders without error**

Start the dev server and load the financial report page for a test report, or run:

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/seller/financial-report.njk
git commit -m "refactor: update financial report display for seller-provided CPF figures"
```

---

### Task 11: Update agent review detail view

**Files:**
- Modify: `src/views/partials/agent/review-detail-financial.njk`

**Context:** The agent review panel should show `cpfDisclaimerShownAt` from `reportData.metadata` so the reviewing agent can see when the seller acknowledged the disclaimer.

- [ ] **Step 1: Add disclaimer timestamp to review-detail-financial.njk**

After the AI Narrative section and before the Approve/Reject buttons, add:

```njk
  <div class="px-4 pb-2">
    <p class="text-xs text-gray-400">
      {{ "CPF disclaimer shown to seller:" | t }}
      {% if detail.reportData.metadata.cpfDisclaimerShownAt %}
        {{ detail.reportData.metadata.cpfDisclaimerShownAt | date }}
      {% else %}
        <span class="text-yellow-600">{{ "Not recorded" | t }}</span>
      {% endif %}
    </p>
  </div>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: No errors. Note: the `| date` Nunjucks filter is already used elsewhere in the financial report templates — confirm it is available in the environment before trusting the build alone.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/agent/review-detail-financial.njk
git commit -m "feat: show cpfDisclaimerShownAt timestamp in agent financial review panel"
```

---

### Task 12: Full test suite and integration check

- [ ] **Step 1: Run full unit test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: All tests pass, no failures.

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration 2>&1 | tail -30
```

Expected: All pass.

- [ ] **Step 3: TypeScript build**

```bash
npm run build 2>&1 | grep -i error
```

Expected: No errors.

- [ ] **Step 4: Final commit if any loose files**

```bash
git status
```

If clean, done. If any unstaged changes remain, add and commit with appropriate message.
