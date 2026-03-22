# Sale Proceeds Calculator — Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

Onboarding step 3 becomes a sale proceeds calculator modelled on the HDB official calculator. The seller enters financial details, sees estimated net proceeds in real time, and the data is saved for the agent to review.

---

## 1. Input Fields

| Field | Type | Notes |
|-------|------|-------|
| Selling Price | Currency | Pre-filled from `property.askingPrice` if set |
| Outstanding Mortgage Loan | Currency | Required |
| CPF Used + Accrued Interest (Seller 1) | Currency | Required |
| CPF Used + Accrued Interest (Seller 2) | Currency | Optional, hidden until "Add contributor" clicked |
| CPF Used + Accrued Interest (Seller 3) | Currency | Optional, hidden until "Add contributor" clicked |
| CPF Used + Accrued Interest (Seller 4) | Currency | Optional, hidden until "Add contributor" clicked |
| Resale Levy | Currency | Optional, default 0. Hint: "Applies if you previously bought a subsidised flat" |
| Other Deductions | Currency | Optional, default 0. Hint: "Upgrading levies, outstanding costs, etc." |
| Commission (SellMyHomeNow) | Currency | Pre-filled $1,633.91, read-only. Loaded from SystemSetting at runtime. |

---

## 2. Calculation

```
Net Sale Proceeds = Selling Price
                  - Outstanding Mortgage Loan
                  - CPF Seller 1
                  - CPF Seller 2
                  - CPF Seller 3
                  - CPF Seller 4
                  - Resale Levy
                  - Other Deductions
                  - Commission
```

Calculated live in the browser as the user types (no server round-trip). If negative, a warning banner appears: "Your estimated sale proceeds are negative. You may need to top up the difference."

---

## 3. Data Model

New `SaleProceeds` model (one per seller):

```prisma
model SaleProceeds {
  id                    String   @id
  sellerId              String   @unique @map("seller_id")
  seller                Seller   @relation(fields: [sellerId], references: [id])
  sellingPrice          Decimal  @map("selling_price") @db.Decimal(12, 2)
  outstandingLoan       Decimal  @map("outstanding_loan") @db.Decimal(12, 2)
  cpfSeller1            Decimal  @map("cpf_seller_1") @db.Decimal(12, 2)
  cpfSeller2            Decimal? @map("cpf_seller_2") @db.Decimal(12, 2)
  cpfSeller3            Decimal? @map("cpf_seller_3") @db.Decimal(12, 2)
  cpfSeller4            Decimal? @map("cpf_seller_4") @db.Decimal(12, 2)
  resaleLevy            Decimal  @default(0) @map("resale_levy") @db.Decimal(12, 2)
  otherDeductions       Decimal  @default(0) @map("other_deductions") @db.Decimal(12, 2)
  commission            Decimal  @map("commission") @db.Decimal(12, 2)
  netProceeds           Decimal  @map("net_proceeds") @db.Decimal(12, 2)
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("sale_proceeds")
}
```

Add back-relation to Seller: `saleProceeds SaleProceeds?`

---

## 4. Persistence

- **POST /seller/onboarding/step/3** — upserts `SaleProceeds` (create or update)
- Commission value read from `SystemSetting` key `commission_amount` (default 1633.91)
- `netProceeds` calculated server-side before saving (don't trust client calculation)

---

## 5. Agent Visibility

On the seller detail page, add a "Financial Summary" row in the Overview card:

- Selling Price: $X
- Net Proceeds: $Y (green if positive, red if negative)
- Link to full breakdown (expandable or tooltip)

`SellerDetail` type gains `saleProceeds` with the saved values.

---

## 6. Disclaimer

Displayed below the calculator result:

> "This is an estimate based on your inputs. Actual proceeds depend on final figures from HDB and CPF Board. This is not financial advice."

---

## 7. Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `SaleProceeds` model + Seller relation |
| New migration | Create `sale_proceeds` table |
| `src/domains/seller/seller.router.ts` | Step 3 POST handler — upsert SaleProceeds |
| `src/domains/seller/seller.service.ts` | `saveSaleProceeds`, `getSaleProceeds` |
| `src/domains/seller/seller.repository.ts` | `upsertSaleProceeds`, `findSaleProceedsBySellerId` |
| `src/domains/seller/seller.types.ts` | `SaleProceedsInput` type |
| `src/domains/agent/agent.types.ts` | Add saleProceeds to `SellerDetail` |
| `src/domains/agent/agent.service.ts` | Map saleProceeds in `getSellerDetail` |
| `src/domains/agent/agent.repository.ts` | Include saleProceeds in seller query |
| `src/views/partials/seller/onboarding-step-3.njk` | Full calculator form with live JS |
| `src/views/pages/agent/seller-detail.njk` | Financial summary display |
| `public/js/app.js` | Live calculation logic |
| `tests/fixtures/factory.ts` | `saleProceeds` factory |

---

## Out of Scope

- Legal/conveyancing fee estimation
- CPF accrued interest calculation (seller enters the combined figure)
- Integration with CPF/HDB APIs
- Editable commission amount (always the fixed fee from SystemSetting)
