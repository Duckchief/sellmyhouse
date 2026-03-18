# Onboarding Step Label Design

**Date:** 2026-03-17
**Status:** Approved

## Problem

The agent seller detail page shows "Step 1 / 5" with no context. Agents can't tell what the seller is stuck on without knowing the step numbering by heart.

## Design

Append a descriptive label after the step count in both locations where `onboardingStep` is displayed.

### Labels

| Step | Label |
|------|-------|
| 1 | Accepts initial consent |
| 2 | Enters property details |
| 3 | Enters financial details |
| 4 | Uploads property photos |
| 5 | Signs EA Agreement |

### Output example

`Step 2 / 5: Enters property details`

### Implementation

Define a Nunjucks array and index into it with `seller.onboardingStep - 1`:

```njk
{% set stepLabels = ["Accepts initial consent", "Enters property details", "Enters financial details", "Uploads property photos", "Signs EA Agreement"] %}
{{ "Step" | t }} {{ seller.onboardingStep }} / 5: {{ stepLabels[seller.onboardingStep - 1] }}
```

## Files Affected

- `src/views/partials/agent/seller-overview.njk`
- `src/views/pages/agent/seller-detail.njk`
