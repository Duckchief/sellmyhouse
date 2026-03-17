# Compliance + EAA Card Merge — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Estate Agency Agreement section into the Compliance card on the seller detail page, separated by a horizontal rule.

**Architecture:** Single-file template edit in `src/views/pages/agent/seller-detail.njk`. No logic changes, no new routes, no tests required (pure markup). The two existing partials (`compliance-cdd-card.njk` and `compliance-eaa-card.njk`) are untouched — they are simply included from a new location. Verification is visual diff in the browser.

**Tech Stack:** Nunjucks templates, Tailwind CSS utility classes.

**Spec:** `docs/superpowers/specs/2026-03-18-compliance-eaa-merge.md`

---

## Chunk 1: Edit seller-detail.njk

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

---

### Task 1: Merge EAA into Compliance card and remove standalone EAA card

- [ ] **Step 1: Open the file and read lines 72–103**

  Read `src/views/pages/agent/seller-detail.njk` lines 72–103 to orient yourself. You will see:
  - Lines 72–89: `{# 3. Compliance #}` card — ends with `{% include "partials/agent/compliance-cdd-card.njk" %}` then `</div>`
  - Lines 91–95: `{# 4. Estate Agency Agreement #}` card — standalone card with `md:col-start-2`

- [ ] **Step 2: Add divider + EAA section inside the Compliance card**

  Find this exact block (lines 87–90):

  ```njk
      <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "CDD Status" | t }}</h3>
      {% include "partials/agent/compliance-cdd-card.njk" %}
    </div>
  ```

  Replace it with:

  ```njk
      <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "CDD Status" | t }}</h3>
      {% include "partials/agent/compliance-cdd-card.njk" %}

      <hr class="my-4 border-gray-200">

      <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Estate Agency Agreement" | t }}</h3>
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  ```

  The `</div>` here closes the Compliance card — the new content must be **before** it.

- [ ] **Step 3: Remove the standalone EAA card**

  Delete this entire block (currently lines 91–95, immediately after the Compliance card `</div>`):

  ```njk
    {# 4. Estate Agency Agreement #}
    <div class="card md:col-start-2">
      <h2 class="page-section-title">{{ "Estate Agency Agreement" | t }}</h2>
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  ```

- [ ] **Step 4: Update and renumber block comments**

  Update the Compliance card's own comment (line 72) to reflect its new contents, and renumber the remaining block comments:

  | Find | Replace |
  |------|---------|
  | `{# 3. Compliance — Consent + CDD #}` | `{# 3. Compliance — Consent + CDD + EAA #}` |
  | `{# 5. Counterparty CDD — only when active transaction exists #}` | `{# 4. Counterparty CDD — only when active transaction exists #}` |
  | `{# 6. Case Flags #}` | `{# 5. Case Flags #}` |
  | `{# 7. Notifications — full-width #}` | `{# 6. Notifications — full-width #}` |

- [ ] **Step 5: Verify the file — read the changed section**

  Read `src/views/pages/agent/seller-detail.njk` lines 70–130 and confirm:
  - The Compliance card (`{# 3. Compliance — Consent + CDD + EAA #}`) now includes three sections: Consent → `<hr>` → CDD Status → `<hr>` → Estate Agency Agreement
  - No standalone `{# 4. Estate Agency Agreement #}` card exists
  - Block comments run 3 → 4 → 5 → 6 with no gaps

- [ ] **Step 6: Run lint**

  ```bash
  npm run lint
  ```

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/views/pages/agent/seller-detail.njk
  git commit -m "style(seller-detail): merge EAA into compliance card"
  ```
