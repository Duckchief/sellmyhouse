# Spec: Merge Estate Agency Agreement into Compliance Card

**Date:** 2026-03-18
**Status:** Approved
**Scope:** `src/views/pages/agent/seller-detail.njk` only

## Problem

The seller detail page has two separate cards for related compliance content:
- **Compliance** card: Consent + CDD Status
- **Estate Agency Agreement** card: EAA status, signed/expiry dates, action buttons, EAA Explanation

These belong together — CDD must be verified before an EAA can be created, and both are part of the same compliance workflow. Having them as separate cards creates a fragmented layout and was the source of a prior grid-positioning workaround (`md:col-start-2` on the EAA card).

## Solution

Merge the EAA content into the Compliance card, separated by a horizontal rule. Remove the standalone EAA card.

## Changes Required

All changes are in `src/views/pages/agent/seller-detail.njk`.

### 1. Extend the Compliance card

Inside the existing Compliance card, insert a divider and EAA section after the CDD partial include and **before** the closing `</div>` of the card:

```njk
    {% include "partials/agent/compliance-cdd-card.njk" %}

    <hr class="my-4 border-gray-200">

    <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Estate Agency Agreement" | t }}</h3>
    {% include "partials/agent/compliance-eaa-card.njk" %}
  </div>  {# ← end of Compliance card #}
```

### 2. Remove the standalone EAA card

Delete the block:

```njk
{# 4. Estate Agency Agreement #}
<div class="card md:col-start-2">
  <h2 class="page-section-title">{{ "Estate Agency Agreement" | t }}</h2>
  {% include "partials/agent/compliance-eaa-card.njk" %}
</div>
```

## Resulting Card Structure

```
Compliance card
  ├── h3: Consent
  │     Service ✓/✗, Marketing ✓/✗
  ├── <hr>
  ├── h3: CDD Status
  │     (compliance-cdd-card.njk partial)
  ├── <hr>
  └── h3: Estate Agency Agreement
        (compliance-eaa-card.njk partial)
```

## Resulting Page Grid

| Col 1              | Col 2                        |
|--------------------|------------------------------|
| Overview (colspan 2)                              |
| Transaction Timeline | Compliance (incl. EAA)     |
| Case Flags         |                              |
| Notifications (colspan 2)                         |

### 3. Renumber remaining block comments

After removing the `{# 4. Estate Agency Agreement #}` block, renumber the remaining comments so they stay sequential:

- `{# 5. Counterparty CDD — ... #}` → `{# 4. Counterparty CDD — ... #}`
- `{# 6. Case Flags #}` → `{# 5. Case Flags #}`
- `{# 7. Notifications — full-width #}` → `{# 6. Notifications — full-width #}`

## Out of Scope

- No changes to `compliance-cdd-card.njk`
- No changes to `compliance-eaa-card.njk`
- No backend changes
- No changes to any other page or layout
