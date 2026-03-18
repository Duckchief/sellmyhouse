# Spec: CPF Seller-Provided Figures

**Date:** 2026-03-18
**Branch:** admin-testimonials-ui
**Status:** Approved

## Problem

The app previously calculated CPF accrued interest using a simplified 2.5% p.a. compound formula and estimated CPF principal by flat type when sellers did not know their figures. This exposes the platform to legal liability:

- CPF's actual calculation is more complex (monthly compounding, bonus rates, HPS premiums, multiple drawdown dates)
- The flat-type estimation is a guess with no basis in the seller's actual CPF history
- If a seller makes financial decisions based on an inaccurate estimate, the platform may be held liable

HDB's own sales proceeds calculator (`homes.hdb.gov.sg/home/calculator/sale-proceeds`) resolves this by asking sellers to self-report a single combined figure — "CPF monies utilised, including accrued interest" — and directing them to check their CPF OA at `my.cpf.gov.sg`. We align strictly with this approach.

## Design

### CPF Input Model

Each owner provides one combined figure. The platform performs no CPF calculations.

```typescript
interface CpfOwnerInput {
  cpfRefund: number; // total CPF incl. accrued interest, self-reported by seller
}
```

HDB supports up to 4 owners (HDB flats may be held by up to 4 persons). We align with this limit.

```typescript
interface FinancialCalculationInput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfs: CpfOwnerInput[]; // 1–4 entries
  flatType: FlatType;
  subsidyType: SubsidyType;
  isFirstTimer: boolean;
  legalFeesEstimate?: number; // defaults to 2500
}
```

### Output Model

`CpfBreakdown` interface removed — no breakdown is possible since only the combined figure is provided.

```typescript
interface FinancialCalculationOutput {
  salePrice: number;
  outstandingLoan: number;
  ownerCpfRefunds: number[]; // parallel array to ownerCpfs
  totalCpfRefund: number;
  resaleLevy: number;
  commission: number;
  legalFees: number;
  totalDeductions: number;
  netCashProceeds: number;
  warnings: string[];
}
```

### Calculator

```
ownerCpfRefunds = ownerCpfs.map(o => o.cpfRefund)
totalCpfRefund  = ownerCpfRefunds.reduce((sum, r) => sum + r, 0)
totalDeductions = outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees
netCashProceeds = salePrice − totalDeductions
```

- `currentYear` parameter removed (no longer used)
- `calculateCpfBreakdown()` private helper removed
- `cpf-interest.ts` deleted entirely

### Validator

- `ownerCpfs` parsed as an array, length enforced 1–4
- Each entry: `cpfRefund` required, non-negative number
- `ValidationError` thrown if array is empty or exceeds 4
- `parseCpfInput()` removed (no null/unknown path)
- `purchaseYear` removed from CPF owner inputs

### Form UX

Starts with 1 owner block. "Add owner" button appends up to 3 more (max 4), matching HDB's UI pattern.

Each owner block:
```
CPF Monies Utilised, Including Accrued Interest (SGD) *
[ number input — required, min 0 ]
Log in to my.cpf.gov.sg → Home Ownership to get this figure.
```

Plain-text disclaimer displayed above the Calculate button (no checkbox, no interactive element):

> **Important:** The CPF figures used in this calculation are based solely on figures you have provided. This estimate may not reflect your actual CPF obligation. Always verify using the latest figures from your CPF account before making any financial decisions.

A checkbox was considered but rejected. The disclaimer is server-rendered — the server records that it was shown to the authenticated seller (see below). An interactive checkbox that is not server-enforced creates a misleading paper trail and was therefore removed.

### Disclaimer Acknowledgement (server-side only)

The client cannot be trusted to self-report that a disclaimer was seen. The acknowledgement is derived entirely from server state:

- **GET `/seller/financial/form`** — sets `cpfDisclaimerShownAt = now()` on the `Seller` record. Proves the authenticated seller was served the page containing the disclaimer.
- **POST `/seller/financial/calculate`** — checks `seller.cpfDisclaimerShownAt IS NOT NULL`. Throws `ForbiddenError` if null (indicates a crafted direct API call that bypassed the form). No client-supplied acknowledgement field is read or trusted.
- **Report creation** — `cpfDisclaimerShownAt` is copied into `FinancialReport.reportData` JSON at creation time, permanently archiving the timestamp with the report version.

### Database

One new column on `Seller`:

```prisma
cpfDisclaimerShownAt DateTime? @map("cpf_disclaimer_shown_at")
```

Requires a migration. No other schema changes — `FinancialReport.reportData` is JSON and absorbs the array structure without migration.

### Report Display

CPF rows loop over `ownerCpfRefunds`:

```
CPF Refund — Owner 1    −$X
CPF Refund — Owner 2    −$X  (if present)
CPF Refund — Owner 3    −$X  (if present)
CPF Refund — Owner 4    −$X  (if present)
```

No principal/interest breakdown. No "estimated" badge. Agent review panel shows `cpfDisclaimerShownAt` timestamp.

### Regression Tests

Rewritten for the new array-based structure. ~18 focused cases:

- Single owner, various CPF amounts
- 2, 3, and 4 owners
- Zero CPF (owner paid cash only)
- Large CPF (million-dollar flat)
- Negative net proceeds (warning, not error)
- Resale levy variants by flat type
- First-timer — no levy
- Commission consistency ($1,633.91)
- Legal fees (custom and default)
- totalDeductions = sum of components
- netCashProceeds = salePrice − totalDeductions

## Files Changed

| File | Change |
|------|--------|
| `src/domains/property/financial.types.ts` | Rewrite CpfOwnerInput, FinancialCalculationInput, Output; remove CpfBreakdown |
| `src/domains/property/cpf-interest.ts` | **Deleted** |
| `src/domains/property/financial.calculator.ts` | Simplify; remove currentYear param and private helper |
| `src/domains/property/financial.validator.ts` | Array parsing, 1–4 validation; remove parseCpfInput and purchaseYear |
| `src/domains/property/financial.service.ts` | Remove currentYear from calculateNetProceeds call; set cpfDisclaimerShownAt on GET |
| `src/domains/property/financial.router.ts` | GET handler sets cpfDisclaimerShownAt; POST handler checks it |
| `src/views/partials/seller/financial-form.njk` | 1–4 owner blocks, Add owner button, plain-text disclaimer |
| `src/views/partials/seller/financial-report.njk` | Loop over ownerCpfRefunds; remove isEstimated |
| `src/views/partials/agent/review-detail-financial.njk` | Show cpfDisclaimerShownAt timestamp |
| `src/domains/property/__tests__/financial.calculator.regression.test.ts` | Rewrite for array structure (~18 cases) |
| `prisma/schema.prisma` | Add cpf_disclaimer_shown_at to Seller |
| `prisma/migrations/...` | Migration for new Seller column |

## What Is Removed

- `calculateCpfAccruedInterest()` — deleted
- `estimateCpfUsage()` and `ESTIMATED_CPF_USAGE` lookup table — deleted
- `cpf-interest.ts` — deleted
- `CpfBreakdown` interface — deleted
- `isEstimated` flag — deleted
- `purchaseYear` from CPF owner inputs — deleted
- `parseCpfInput()` helper — deleted
- null/unknown CPF path — deleted
- All test cases exercising CPF interest calculation or estimation — deleted

## Alignment with HDB

This design mirrors HDB's own sales proceeds calculator (`homes.hdb.gov.sg/home/calculator/sale-proceeds`):

- Single combined CPF figure per owner ("including accrued interest")
- Up to 4 owners
- Directs sellers to `my.cpf.gov.sg → Home Ownership` for figures
- Platform performs no CPF calculations — it is a pass-through for seller-provided data
