# Compliance Card Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the separate "CDD Status" and "Consent" cards on the seller detail page into a single "Compliance" card (Consent on top, CDD below), and remove the brand name from the CDD warning text.

**Architecture:** Pure template changes — no backend, no logic changes. `seller-detail.njk` loses two separate cards and gains one merged card. `compliance-cdd-card.njk` gets a one-line text update.

**Tech Stack:** Nunjucks templates, Tailwind CSS, HTMX (existing behaviour unchanged)

---

## Chunk 1: Merge the two cards

### Task 1: Update `compliance-cdd-card.njk` — remove brand name from warning

**Files:**
- Modify: `src/views/partials/agent/compliance-cdd-card.njk:44-46`

- [ ] **Step 1: Open the file and find the warning text**

  In `src/views/partials/agent/compliance-cdd-card.njk`, locate line ~44:
  ```
  {{ "CDD must be marked Verified in Huttons' system before you can proceed to the Estate Agency Agreement." | t }}
  ```

- [ ] **Step 2: Replace the warning text**

  Change to:
  ```
  {{ "CDD must be marked Verified before you can proceed to the Estate Agency Agreement." | t }}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/partials/agent/compliance-cdd-card.njk
  git commit -m "fix: remove brand name from CDD pending warning text"
  ```

---

### Task 2: Merge the cards in `seller-detail.njk`

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

The page currently has:
- Box #3 (lines ~71–75): `<div class="card">` titled "CDD Status" — includes `compliance-cdd-card.njk`
- Box #6 (lines ~91–101): `<div class="card">` titled "Consent" — inline `<dl>` with service/marketing/withdrawn

The goal: remove both boxes and insert one merged "Compliance" card in the position of the old box #3 (between Transaction Timeline and EAA). The Consent section goes inside first, then a `<hr>`, then the CDD include.

- [ ] **Step 1: Remove the old CDD Status card (box #3)**

  Find and delete this block (approximately lines 71–75):
  ```njk
  {# 3. CDD Status #}
  <div class="card">
    <h2 class="page-section-title">{{ "CDD Status" | t }}</h2>
    {% include "partials/agent/compliance-cdd-card.njk" %}
  </div>
  ```

- [ ] **Step 2: Insert the merged Compliance card in its place**

  In the same position (after Transaction Timeline, before EAA), insert:
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
  ```

- [ ] **Step 3: Remove the old Consent card (box #6)**

  Find and delete this block (approximately lines 91–101):
  ```njk
  {# 6. Consent #}
  <div class="card">
    <h2 class="page-section-title">{{ "Consent" | t }}</h2>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
      {% if compliance.consent.withdrawnAt %}
      <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
      {% endif %}
    </dl>
  </div>
  ```

- [ ] **Step 4: Verify the remaining card numbering in comments is consistent**

  After the edit, the page cards should read (in order):
  1. Overview (full-width)
  2. Transaction Timeline
  3. Compliance (merged — NEW)
  4. Estate Agency Agreement
  5. Counterparty CDD (conditional, full-width)
  6. Case Flags
  7. Notifications (full-width)

  Update the `{# N. ... #}` comments to match.

- [ ] **Step 5: Start the dev server and verify visually**

  ```bash
  npm run dev
  ```

  Open `http://localhost:3000` (or configured port), navigate to any seller detail page, and confirm:
  - Single "Compliance" card appears where "CDD Status" used to be
  - Consent (Service / Marketing / optional withdrawal) renders at top of card
  - Horizontal rule separates sections
  - CDD Status (dropdown or locked badge) renders below
  - "Consent" card is gone from its former position
  - CDD pending warning no longer mentions the brand name
  - All other cards are in the correct order

- [ ] **Step 6: Commit**

  ```bash
  git add src/views/pages/agent/seller-detail.njk
  git commit -m "feat: merge CDD Status and Consent into single Compliance card"
  ```
