# Admin Dashboard Funnel Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Transaction Funnel card from full-width to a 2-column grid alongside Lead Sources, and make Time to Close standalone full-width.

**Architecture:** Pure template restructure in `analytics.njk`. No backend changes. The funnel card and lead sources card are wrapped in a shared responsive grid; the Time to Close card becomes its own full-width row.

**Tech Stack:** Nunjucks, Tailwind CSS

---

## Chunk 1: Restructure analytics.njk

**Spec:** `docs/superpowers/specs/2026-03-17-admin-dashboard-funnel-layout.md`

**Files:**
- Modify: `src/views/partials/admin/analytics.njk`

### Current structure (lines 43–192)

```
{# Transaction funnel chart #}           ← lines 43–121, full-width card
{# Time to close + Lead sources (2 col) #} ← lines 123–192, grid wrapper
  └─ Time to Close card
  └─ Lead Sources card
```

### Target structure

```
{# Transaction Funnel + Lead Sources (2 col) #}
  └─ Transaction Funnel card
  └─ Lead Sources card
{# Time to Close #}                      ← standalone full-width card
```

---

- [ ] **Step 1: Open the file and confirm line numbers**

  Read `src/views/partials/admin/analytics.njk` and verify:
  - Line 44: `<div class="card mb-8">` (funnel outer card — this must lose `mb-8` and move inside the grid)
  - Line 123: `{# Time to close + Lead sources (2 col) #}` comment
  - Line 124: `<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">` (2-col grid wrapper)
  - Line 126: Time to Close `<div class="card">` starts here
  - Line 154: `</div>` closes Time to Close card
  - Line 156: Lead Sources `<div class="card">` starts here
  - Line 191: `</div>` closes Lead Sources card
  - Line 192: `</div>` closes the 2-col grid wrapper

- [ ] **Step 2: Replace the block**

  Replace from the `{# Transaction funnel chart #}` comment (line 43) through the closing `</div>` of the 2-col grid (line 192) with the following:

  ```njk
  {# Transaction Funnel + Lead Sources (2 col) #}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

    {# Transaction funnel #}
    <div class="card">
      <h3 class="font-semibold mb-4">{{ "Transaction Funnel" | t }}</h3>
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

      {# Funnel tiers #}
      <div>

        {# Lead #}
        <div class="relative h-14 flex items-center justify-center">
          <div class="absolute inset-0" style="clip-path: polygon(5% 0%, 95% 0%, 88% 100%, 12% 100%); background-color: #3b82f6;"></div>
          <div class="relative z-10 flex items-center gap-3 text-white">
            <span class="text-sm font-medium uppercase tracking-wide">{{ "Lead" | t }}</span>
            <span class="text-xl font-bold">{{ leadCount }}</span>
          </div>
        </div>

        {# Lead → Engaged conversion #}
        <div class="text-right pr-2 py-0.5">
          <span class="text-xs text-gray-400">↓ {{ engagedPct }}</span>
        </div>

        {# Engaged #}
        <div class="relative h-14 flex items-center justify-center">
          <div class="absolute inset-0" style="clip-path: polygon(12% 0%, 88% 0%, 81% 100%, 19% 100%); background-color: #8b5cf6;"></div>
          <div class="relative z-10 flex items-center gap-3 text-white">
            <span class="text-sm font-medium uppercase tracking-wide">{{ "Engaged" | t }}</span>
            <span class="text-xl font-bold">{{ engagedCount }}</span>
          </div>
        </div>

        {# Engaged → Active conversion #}
        <div class="text-right pr-2 py-0.5">
          <span class="text-xs text-gray-400">↓ {{ activePct }}</span>
        </div>

        {# Active #}
        <div class="relative h-14 flex items-center justify-center">
          <div class="absolute inset-0" style="clip-path: polygon(19% 0%, 81% 0%, 74% 100%, 26% 100%); background-color: #c8553d;"></div>
          <div class="relative z-10 flex items-center gap-3 text-white">
            <span class="text-sm font-medium uppercase tracking-wide">{{ "Active" | t }}</span>
            <span class="text-xl font-bold">{{ activeCount }}</span>
          </div>
        </div>

        {# Active → Completed conversion #}
        <div class="text-right pr-2 py-0.5">
          <span class="text-xs text-gray-400">↓ {{ completedPct }}</span>
        </div>

        {# Completed #}
        <div class="relative h-14 flex items-center justify-center">
          <div class="absolute inset-0" style="clip-path: polygon(26% 0%, 74% 0%, 67% 100%, 33% 100%); background-color: #22c55e;"></div>
          <div class="relative z-10 flex items-center gap-3 text-white">
            <span class="text-sm font-medium uppercase tracking-wide">{{ "Completed" | t }}</span>
            <span class="text-xl font-bold">{{ completedCount }}</span>
          </div>
        </div>

      </div>{# end funnel tiers #}

      <div class="mt-3 text-center">
        <span class="text-xs text-gray-400">→ {{ archivedCount }} {{ "archived" | t }}</span>
      </div>
    </div>{# end funnel card #}

    {# Lead sources #}
    <div class="card">
      <h3 class="font-semibold mb-4">{{ "Lead Sources" | t }}</h3>
      <canvas id="leadSourceChart" height="150"></canvas>
      <script nonce="{{ cspNonce }}">
        (function() {
          const ctx = document.getElementById('leadSourceChart');
          if (!ctx) return;
          const data = {{ analytics.leadSources | dump | safe }};
          const labels = Object.keys(data);
          const values = labels.map(k => data[k].total);
          new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels,
              datasets: [{ data: values, backgroundColor: ['#c8553d', '#1a1a2e', '#3b82f6', '#22c55e', '#eab308'] }],
            },
            options: { plugins: { legend: { position: 'bottom' } } },
          });
        })();
      </script>
      <table class="w-full text-sm mt-4">
        <thead class="text-xs text-gray-500 uppercase">
          <tr><th class="text-left py-1">{{ "Source" | t }}</th><th class="text-right py-1">{{ "Total" | t }}</th><th class="text-right py-1">{{ "Conv. %" | t }}</th></tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {% for source, data in analytics.leadSources | dictsort %}
          <tr>
            <td class="py-1">{{ source }}</td>
            <td class="py-1 text-right">{{ data.total }}</td>
            <td class="py-1 text-right">{{ data.conversionRate }}%</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>

  </div>{# end funnel + lead sources grid #}

  {# Time to close #}
  <div class="card mb-8">
    <h3 class="font-semibold mb-4">{{ "Time to Close" | t }}</h3>
    <div class="flex items-baseline gap-2 mb-4">
      <span class="text-3xl font-bold">{{ analytics.timeToClose.averageDays }}</span>
      <span class="text-gray-500">{{ "days avg" | t }}</span>
      <span class="text-sm text-gray-400">({{ analytics.timeToClose.count }} {{ "transactions" | t }})</span>
    </div>
    <canvas id="timeToCloseChart" height="150"></canvas>
    <script nonce="{{ cspNonce }}">
      (function() {
        const ctx = document.getElementById('timeToCloseChart');
        if (!ctx) return;
        const data = {{ analytics.timeToClose.byFlatType | dump | safe }};
        const labels = Object.keys(data);
        const values = labels.map(k => data[k].averageDays);
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [{ label: 'Days', data: values, backgroundColor: '#c8553d' }],
          },
          options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
          },
        });
      })();
    </script>
  </div>
  ```

- [ ] **Step 3: Verify the file looks correct**

  Read `src/views/partials/admin/analytics.njk` and confirm:
  - The `{# Transaction funnel chart #}` comment is gone
  - The `{# Time to close + Lead sources (2 col) #}` comment is gone
  - The funnel and lead sources are inside a single `grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8` wrapper
  - Time to Close is a standalone `card mb-8` after the grid
  - No duplicate `leadSourceChart` or `timeToCloseChart` canvas IDs

- [ ] **Step 4: Start dev server and visually verify**

  ```bash
  npm run dev
  ```

  Navigate to `http://localhost:3000/admin/dashboard` and confirm:
  - Funnel and Lead Sources appear side by side at desktop widths
  - They stack (funnel first) at mobile widths
  - Time to Close appears full-width below them
  - No visual regressions in Viewings or Referral sections below

- [ ] **Step 5: Commit**

  ```bash
  git add src/views/partials/admin/analytics.njk
  git commit -m "feat(admin): pair transaction funnel with lead sources in 2-col grid"
  ```
