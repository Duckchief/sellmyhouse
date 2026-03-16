# Design: Sellers List — Listing Stage & Transaction Columns

**Date:** 2026-03-16
**Status:** Approved

## Problem

The agent sellers list (`/agent/sellers`) has five columns: Name, Status, Property, Asking Price, Source. Agents have no at-a-glance view of where a listing sits in the publication pipeline or whether a transaction is in progress. They must open each seller detail page to find this information.

## Solution

Add two new columns:

1. **Listing Stage** — the property's business lifecycle status (`property.status`)
2. **Transaction** — the active transaction status (`transaction.status`), if one exists

## Column A: Listing Stage

Source: `property.status` (already fetched, zero backend changes needed).

| Value | Display | Badge colour |
|---|---|---|
| `draft` | Draft | gray |
| `listed` | Listed | blue |
| `offer_received` | Offer Received | amber |
| `under_option` | Under Option | orange |
| `completing` | Completing | purple |
| `completed` | Completed | green |
| `withdrawn` | Withdrawn | red |

Shows `—` when the seller has no property.

## Column B: Transaction

Source: most recent `transaction.status` on the seller's property. Not all sellers have a transaction — most will show `—`.

| Value | Display | Badge colour |
|---|---|---|
| `option_issued` | Option Issued | blue |
| `option_exercised` | Option Exercised | indigo |
| `completing` | Completing | purple |
| `completed` | Completed | green |
| `fallen_through` | Fallen Through | red |

Shows `—` when no transaction exists.

## Files Changed

| File | Change |
|---|---|
| `src/domains/agent/agent.types.ts` | Add `transactionStatus: string \| null` to `SellerListItem.property` |
| `src/domains/agent/agent.repository.ts` | Add nested `transactions` include inside properties; map `transactionStatus` |
| `src/views/partials/agent/seller-list.njk` | Add 2 `<th>` + `<td>` columns with coloured badges |

## Out of Scope

- Filtering by listing stage or transaction status (future)
- Sorting by these columns (future)
- Changes to the seller detail page
