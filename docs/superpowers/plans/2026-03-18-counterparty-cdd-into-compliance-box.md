# Counterparty CDD into Compliance Box Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Counterparty CDD section inside the Compliance card as numbered section 4, with a greyed-out placeholder when no active transaction exists.

**Architecture:** Pure Nunjucks template change. Remove the standalone Counterparty CDD card, add section 4 inside the existing Compliance card with conditional rendering.

**Tech Stack:** Nunjucks templates

---

## Chunk 1: Update seller-detail.njk

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

- [ ] **Step 1: Remove the standalone Counterparty CDD card**

In `seller-detail.njk`, delete lines 96–102:

```njk
  {# 4. Counterparty CDD — only when active transaction exists #}
  {% if compliance.counterpartyCdd %}
  <div class="card">
    <h2 class="page-section-title">{{ "Counterparty CDD" | t }}</h2>
    {% include "partials/agent/compliance-counterparty-cdd-card.njk" %}
  </div>
  {% endif %}
```

- [ ] **Step 2: Add section 4 inside the Compliance card**

After the EAA section (after line 93 `{% include "partials/agent/compliance-eaa-card.njk" %}`), and before the closing `</div>` of the Compliance card, insert:

```njk
    <hr class="my-4 border-gray-200">

    <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "4. Counterparty CDD" | t }}</h3>
    {% if compliance.counterpartyCdd %}
      {% include "partials/agent/compliance-counterparty-cdd-card.njk" %}
    {% else %}
      <p class="text-sm text-gray-400 italic">{{ "Not yet applicable — no active transaction." | t }}</p>
    {% endif %}
```

- [ ] **Step 3: Verify visually**

Start the dev server (`npm run dev`) and open a seller detail page. Confirm:
- A seller with no transaction shows "Not yet applicable — no active transaction." greyed out under section 4 inside the Compliance card
- A seller with an active transaction shows the counterparty CDD card content under section 4
- No separate Counterparty CDD card exists outside the Compliance box

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk
git commit -m "feat: move Counterparty CDD into Compliance box as section 4"
```
