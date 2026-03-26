# Design: Buyer Deposit Field in Sale Proceeds Estimate

**Date:** 2026-03-24
**Status:** Approved

## Problem

The Estimated Sales Proceeds calculator shows how much cash the seller receives on HDB completion day. If the seller has already received a buyer deposit (option fee + exercise fee, capped at $5,000 by HDB rules), that money is in their hands before completion — so completion-day proceeds should be reduced by that amount.

## Solution

Add an optional `buyerDeposit` field to the `SaleProceeds` model and include it as a deduction in the net proceeds calculation.

## Updated Formula

```
netProceeds = sellingPrice - outstandingLoan - cpfRefund - resaleLevy - otherDeductions - commission - buyerDeposit
```

## Field Specification

| Property | Value |
|---|---|
| Label | "Buyer deposit received ($)" |
| Helper text | "Option fee + exercise fee already paid to you (max $5,000)" |
| Type | Number, integer steps |
| Default | 0 |
| Validation | 0 ≤ value ≤ 5000 |
| Required | No (optional, defaults to 0) |
| Position (form) | After CPF + Accrued Interest, before Resale Levy |
| Position (summary) | After CPF Refund row, before Resale Levy row |

## Files to Change

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `buyerDeposit Decimal(12,2) @default(0)` to `SaleProceeds` |
| Migration | Add `buyer_deposit` column with default 0 |
| `src/domains/seller/seller.types.ts` | Add `buyerDeposit?: number` to `SaleProceedsInput` |
| `src/domains/seller/seller.service.ts` | Include `buyerDeposit` in `netProceeds` subtraction |
| `src/domains/seller/seller.repository.ts` | Persist `buyerDeposit` in `upsertSaleProceeds` |
| `src/domains/property/financial.router.ts` | Parse + validate `buyerDeposit` from request body |
| `src/views/partials/seller/sale-proceeds-form.njk` | Add input field |
| `src/views/partials/seller/estimate-summary.njk` | Add display row (shown only when > 0) |
| Unit tests | Update calculation tests for new field |
