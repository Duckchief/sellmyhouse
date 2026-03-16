# Transaction Funnel Graphic Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blank Chart.js canvas in the admin analytics dashboard with a pure HTML/CSS trapezoid sales funnel showing lead → engaged → active → completed stages.

**Architecture:** Single template file change — `src/views/partials/admin/analytics.njk`. Remove the `<canvas>`, `<noscript>`, and `<script>` blocks for funnelChart. Replace with stacked trapezoid `<div>` rows using `clip-path` inline styles, conversion % indicators between stages (right-aligned), and an archived count below. No backend changes.

**Tech Stack:** Nunjucks, Tailwind CSS, inline CSS `clip-path`

---

## Chunk 1: Replace funnelChart with CSS funnel

**Spec:** `docs/superpowers/specs/2026-03-16-transaction-funnel-graphic-design.md`

### Task 1: Remove Chart.js funnelChart block

**Files:**
- Modify: `src/views/partials/admin/analytics.njk:43-79`

- [ ] **Step 1: Read the current funnelChart block**

  Open `src/views/partials/admin/analytics.njk` and locate the block at lines 43–79:
  ```
  {# Transaction funnel chart #}
  <div class="card mb-8">
    <h3 class="font-semibold mb-4">{{ "Transaction Funnel" | t }}</h3>
    <canvas id="funnelChart" height="200"></canvas>
    <noscript>...</noscript>
    <script nonce="{{ cspNonce }}">...</script>
  </div>
  ```

- [ ] **Step 2: Replace the inner content of the funnelChart card with a placeholder comment**

  Replace everything inside the `.card` div (keep the outer `<div class="card mb-8">` and `<h3>`) with a single comment:
  ```njk
  {# Transaction funnel chart #}
  <div class="card mb-8">
    <h3 class="font-semibold mb-4">{{ "Transaction Funnel" | t }}</h3>
    {# TODO: funnel HTML goes here #}
  </div>
  ```

- [ ] **Step 3: Verify the server starts without errors**

  Run:
  ```bash
  npm run build 2>&1 | head -20
  ```
  Expected: no template compilation errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/partials/admin/analytics.njk
  git commit -m "refactor: remove Chart.js funnelChart canvas and script"
  ```

---

### Task 2: Add CSS trapezoid funnel HTML

**Files:**
- Modify: `src/views/partials/admin/analytics.njk`

**Notes before starting:**

- `analytics.njk` is used via `{% include %}` (confirmed in `dashboard.njk` line 8), so `{% set %}` variables defined here are scoped correctly to this partial render. If the include chain ever changes to a `{% block %}` pattern, `{% set %}` variables would not carry across block boundaries — flag if that happens.
- Text is centred inside each tier (both stage name and count centred together). The clip-path narrowing makes left/right alignment impractical for the narrowest tiers (completed is only ~20% wide at the bottom edge), so centred layout is used for consistency and readability across all tiers.
- Conversion % indicators appear **right-aligned** below each tier separator.

**Clip-path values** (each tier's top matches the previous tier's bottom, creating a seamless funnel):

| Stage | clip-path |
|-------|-----------|
| lead | `polygon(5% 0%, 95% 0%, 88% 100%, 12% 100%)` |
| engaged | `polygon(12% 0%, 88% 0%, 78% 100%, 22% 100%)` |
| active | `polygon(22% 0%, 78% 0%, 65% 100%, 35% 100%)` |
| completed | `polygon(35% 0%, 65% 0%, 55% 100%, 45% 100%)` |

**Colors** (brand accent `#c8553d` at descending opacity):

| Stage | Background |
|-------|-----------|
| lead | `rgba(200,85,61,1)` |
| engaged | `rgba(200,85,61,0.8)` |
| active | `rgba(200,85,61,0.6)` |
| completed | `rgba(200,85,61,0.4)` |

- [ ] **Step 1: Add Nunjucks variable assignments above the funnel HTML**

  Replace `{# TODO: funnel HTML goes here #}` with:

  ```njk
  {% set leadCount = analytics.funnel.lead or 0 %}
  {% set engagedCount = analytics.funnel.engaged or 0 %}
  {% set activeCount = analytics.funnel.active or 0 %}
  {% set completedCount = analytics.funnel.completed or 0 %}
  {% set archivedCount = analytics.funnel.archived or 0 %}

  {# Conversion % as string sentinels — "—" when upstream stage is zero #}
  {% set engagedPct = ((engagedCount / leadCount * 100) | round) ~ "%" if leadCount else "—" %}
  {% set activePct = ((activeCount / engagedCount * 100) | round) ~ "%" if engagedCount else "—" %}
  {% set completedPct = ((completedCount / activeCount * 100) | round) ~ "%" if activeCount else "—" %}

  {# Guard against rounding to "0%" when conversion is non-zero but < 0.5% #}
  {% if leadCount and engagedCount and engagedPct == "0%" %}{% set engagedPct = "<1%" %}{% endif %}
  {% if engagedCount and activeCount and activePct == "0%" %}{% set activePct = "<1%" %}{% endif %}
  {% if activeCount and completedCount and completedPct == "0%" %}{% set completedPct = "<1%" %}{% endif %}
  ```

- [ ] **Step 2: Add the lead tier**

  After the variable block, add:

  ```njk
  {# Funnel tiers #}
  <div class="space-y-0">

    {# Lead #}
    <div class="relative h-14 flex items-center justify-center">
      <div class="absolute inset-0" style="clip-path: polygon(5% 0%, 95% 0%, 88% 100%, 12% 100%); background-color: rgba(200,85,61,1);"></div>
      <div class="relative z-10 flex items-center gap-3 text-white">
        <span class="text-sm font-medium uppercase tracking-wide">{{ "Lead" | t }}</span>
        <span class="text-xl font-bold">{{ leadCount }}</span>
      </div>
    </div>
  ```

- [ ] **Step 3: Add conversion indicator + engaged tier**

  ```njk
    {# Lead → Engaged conversion #}
    <div class="text-right pr-2 py-0.5">
      <span class="text-xs text-gray-400">↓ {{ engagedPct }}</span>
    </div>

    {# Engaged #}
    <div class="relative h-14 flex items-center justify-center">
      <div class="absolute inset-0" style="clip-path: polygon(12% 0%, 88% 0%, 78% 100%, 22% 100%); background-color: rgba(200,85,61,0.8);"></div>
      <div class="relative z-10 flex items-center gap-3 text-white">
        <span class="text-sm font-medium uppercase tracking-wide">{{ "Engaged" | t }}</span>
        <span class="text-xl font-bold">{{ engagedCount }}</span>
      </div>
    </div>
  ```

- [ ] **Step 4: Add conversion indicator + active tier**

  ```njk
    {# Engaged → Active conversion #}
    <div class="text-right pr-2 py-0.5">
      <span class="text-xs text-gray-400">↓ {{ activePct }}</span>
    </div>

    {# Active #}
    <div class="relative h-14 flex items-center justify-center">
      <div class="absolute inset-0" style="clip-path: polygon(22% 0%, 78% 0%, 65% 100%, 35% 100%); background-color: rgba(200,85,61,0.6);"></div>
      <div class="relative z-10 flex items-center gap-3 text-white">
        <span class="text-sm font-medium uppercase tracking-wide">{{ "Active" | t }}</span>
        <span class="text-xl font-bold">{{ activeCount }}</span>
      </div>
    </div>
  ```

- [ ] **Step 5: Add conversion indicator + completed tier**

  ```njk
    {# Active → Completed conversion #}
    <div class="text-right pr-2 py-0.5">
      <span class="text-xs text-gray-400">↓ {{ completedPct }}</span>
    </div>

    {# Completed #}
    <div class="relative h-14 flex items-center justify-center">
      <div class="absolute inset-0" style="clip-path: polygon(35% 0%, 65% 0%, 55% 100%, 45% 100%); background-color: rgba(200,85,61,0.4);"></div>
      <div class="relative z-10 flex items-center gap-3 text-white">
        <span class="text-sm font-medium uppercase tracking-wide">{{ "Completed" | t }}</span>
        <span class="text-xl font-bold">{{ completedCount }}</span>
      </div>
    </div>

  </div>{# end space-y-0 #}
  ```

- [ ] **Step 6: Add archived indicator below funnel (always shown)**

  ```njk
  <div class="mt-3 text-center">
    <span class="text-xs text-gray-400">→ {{ archivedCount }} {{ "archived" | t }}</span>
  </div>
  ```

- [ ] **Step 7: Verify the full card structure**

  The complete `{# Transaction funnel chart #}` card should now contain:
  - Five `{% set %}` count variables
  - Three `{% set %}` conversion % string sentinels + three `<1%` guards
  - Four trapezoid tier divs with `clip-path` inline styles
  - Three right-aligned conversion indicators between tiers
  - One archived row (unconditional)
  - No `<canvas>`, `<noscript>`, or `<script>` elements

- [ ] **Step 8: Build and visually verify — happy path**

  ```bash
  npm run build && npm run dev
  ```

  Navigate to `http://localhost:3000/admin/dashboard` logged in as admin.

  Check:
  - Four trapezoid tiers visible, narrowing downward
  - Brand red colour fading from top (darkest) to bottom (lightest)
  - Stage names and counts readable in white, centred text
  - Three conversion % lines right-aligned between tiers (e.g. `↓ 63%`)
  - Archived count visible below funnel (e.g. `→ 5 archived`)
  - No `<canvas>` element in the DOM (confirm via DevTools → Elements)

- [ ] **Step 9: Verify zero-data state**

  Temporarily override the template data in the router (or use a test account with no sellers) to confirm behaviour when `analytics.funnel` is empty / all counts are zero:
  - All tier counts show `0`
  - Conversion indicators show `↓ —` (not `↓ —%` or `↓ 0%`)
  - Archived row shows `→ 0 archived`
  - No JS errors in browser console

- [ ] **Step 10: Commit**

  ```bash
  git add src/views/partials/admin/analytics.njk
  git commit -m "feat: replace Chart.js funnel with CSS trapezoid funnel graphic"
  ```
