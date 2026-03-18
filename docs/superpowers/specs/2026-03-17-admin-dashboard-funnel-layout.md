# Admin Dashboard: Transaction Funnel Layout

**Date:** 2026-03-17
**Status:** Approved

## Problem

The Transaction Funnel card spans full width on the admin dashboard, making the funnel shape overly wide and leaving the page feeling unbalanced below the revenue cards.

## Design

Move the Transaction Funnel and Lead Sources cards into a 2-column responsive grid. Time to Close becomes a standalone full-width card on its own row.

### New layout order

```
[Revenue cards ×4          ]
[Transaction Funnel | Lead Sources]
[Time to Close — full width]
[Viewings — full width     ]
[Referral — full width     ]
```

### Responsive behaviour

- Mobile: single column, funnel first, lead sources below
- `lg` and above: side-by-side 2-col grid (`grid-cols-1 lg:grid-cols-2 gap-6 mb-8`)

## Files Affected

- `src/views/partials/admin/analytics.njk`
