# Spec: EAA Under Compliance Layout

**Date:** 2026-03-17
**File:** `src/views/pages/agent/seller-detail.njk`

## Problem

The agent seller detail page uses a 2-column `info-grid`. Compliance (Consent + CDD) sits in the right column while EAA sits as a separate card in the next row's left column. This leaves dead space below Compliance and breaks the visual CDD→EAA workflow sequence.

## Solution

Wrap the Compliance card and Estate Agency Agreement card in a `<div class="flex flex-col gap-6">` column container. This container occupies one grid cell (right column of row 2), and the two cards stack vertically inside it.

## Layout After Change

```
[ Overview (full width)                                      ]
[ Transaction Timeline  ] [ Compliance card                 ]
                          [ Estate Agency Agreement card    ]
[ Case Flags            ] [ Counterparty CDD (conditional)  ]
[ Notifications (full width)                                 ]
```

## Change

In `src/views/pages/agent/seller-detail.njk`, replace the two sibling `<div class="card">` elements for Compliance and EAA with a single `<div class="flex flex-col gap-6">` wrapper containing both cards.

## No other changes needed

- The card partials (`compliance-cdd-card.njk`, `compliance-eaa-card.njk`) are unchanged.
- No CSS changes required — `flex flex-col gap-6` uses existing Tailwind utilities.
- HTMX targets (`#compliance-cdd-card`, `#compliance-eaa-card`) are unaffected.
