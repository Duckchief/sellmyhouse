# EAA Under Compliance Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stack the Estate Agency Agreement card directly beneath the Compliance card in the agent seller detail page, eliminating dead space and making the CDD→EAA workflow read top-to-bottom.

**Architecture:** Wrap the Compliance and EAA `<div class="card">` siblings in a `<div class="flex flex-col gap-6">` container. The container occupies one cell of the 2-column `info-grid`, causing both cards to stack vertically in the right column. No CSS, no partials, no JS changes required.

**Tech Stack:** Nunjucks, Tailwind CSS

---

## Chunk 1: Wrap Compliance + EAA in a column container

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk:72-95`

- [ ] **Step 1: Open the file and confirm current structure**

Read `src/views/pages/agent/seller-detail.njk` lines 72–95. Confirm:
- Line 73: `<div class="card">` — Compliance card
- Line 91: `<div class="card">` — Estate Agency Agreement card

- [ ] **Step 2: Apply the change**

Replace:

```njk
  {# 3. Compliance — Consent + CDD #}
  <div class="card">
    <h2 class="page-section-title">{{ "Compliance" | t }}</h2>

    <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Consent" | t }}</h3>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
      {% if compliance.consent.withdrawnAt %}
      <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
      {% endif %}
    </dl>

    <hr class="my-4 border-gray-200">

    <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "CDD Status" | t }}</h3>
    {% include "partials/agent/compliance-cdd-card.njk" %}
  </div>

  {# 4. Estate Agency Agreement #}
  <div class="card">
    <h2 class="page-section-title">{{ "Estate Agency Agreement" | t }}</h2>
    {% include "partials/agent/compliance-eaa-card.njk" %}
  </div>
```

With:

```njk
  {# 3 + 4. Compliance + EAA — stacked in the same column #}
  <div class="flex flex-col gap-6">
    <div class="card">
      <h2 class="page-section-title">{{ "Compliance" | t }}</h2>

      <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Consent" | t }}</h3>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
        {% if compliance.consent.withdrawnAt %}
        <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
        {% endif %}
      </dl>

      <hr class="my-4 border-gray-200">

      <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "CDD Status" | t }}</h3>
      {% include "partials/agent/compliance-cdd-card.njk" %}
    </div>

    <div class="card">
      <h2 class="page-section-title">{{ "Estate Agency Agreement" | t }}</h2>
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  </div>
```

- [ ] **Step 3: Visual check**

Run `npm run dev` and open the agent seller detail page. Confirm:
- Compliance and EAA cards are in the same right column, stacked vertically
- Timeline occupies the left column alongside both cards
- No layout breakage on mobile (single column, both cards render in order)
- HTMX interactions on CDD status select and EAA buttons still work

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk
git commit -m "feat(layout): stack EAA card under Compliance in seller detail page"
```
