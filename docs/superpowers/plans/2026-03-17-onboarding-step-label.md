# Onboarding Step Label Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a descriptive label alongside the onboarding step number on the agent seller detail page.

**Architecture:** Pure template change in two Nunjucks files. A local array maps step numbers to descriptions; no backend or data model changes required.

**Tech Stack:** Nunjucks, Tailwind CSS

---

## Chunk 1: Update both templates

**Spec:** `docs/superpowers/specs/2026-03-17-onboarding-step-label.md`

**Files:**
- Modify: `src/views/partials/agent/seller-overview.njk:7`
- Modify: `src/views/pages/agent/seller-detail.njk:27`

---

- [ ] **Step 1: Update `seller-overview.njk`**

  In `src/views/partials/agent/seller-overview.njk`, replace line 7:

  ```njk
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5</dd></div>
  ```

  With:

  ```njk
        {% set stepLabels = ["Accepts initial consent", "Enters property details", "Enters financial details", "Uploads property photos", "Signs EA Agreement"] %}
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5: {{ stepLabels[seller.onboardingStep - 1] }}</dd></div>
  ```

- [ ] **Step 2: Update `seller-detail.njk`**

  In `src/views/pages/agent/seller-detail.njk`, replace line 27:

  ```njk
              <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5</dd></div>
  ```

  With:

  ```njk
              {% set stepLabels = ["Accepts initial consent", "Enters property details", "Enters financial details", "Uploads property photos", "Signs EA Agreement"] %}
              <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5: {{ stepLabels[seller.onboardingStep - 1] }}</dd></div>
  ```

- [ ] **Step 3: Run tests**

  ```bash
  npm test
  ```

  Expected: no new failures (template-only change).

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/partials/agent/seller-overview.njk src/views/pages/agent/seller-detail.njk
  git commit -m "feat(agent): show descriptive label on onboarding step"
  ```
