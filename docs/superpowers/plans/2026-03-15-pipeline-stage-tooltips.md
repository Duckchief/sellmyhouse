# Pipeline Stage Card Tooltips Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `?` badge with a hover tooltip to each stage card on `/agent/dashboard` and `/admin/pipeline`, explaining what each stage means.

**Architecture:** Pure CSS using Tailwind `group`/`group-hover:` classes. Each card's outer `<a>` gains `relative group`; a hidden tooltip `<div>` fades in on hover. No JS, no backend changes, no new dependencies.

**Tech Stack:** Nunjucks templates, Tailwind CSS utility classes

**Testing note:** This is a pure CSS/template change with no application logic. There is nothing to unit test. E2E Playwright hover tests are out of scope — tooltip visibility is entirely determined by Tailwind's `group-hover:` classes with no branching or data logic. Verification is manual: run the dev server and hover each card.

---

## Chunk 1: Agent dashboard pipeline cards

### Task 1: Update `pipeline-cards.njk` with tooltips

**Files:**
- Modify: `src/views/partials/agent/pipeline-cards.njk`

**Note:** The agent dashboard has no "All" card — it only iterates the five named stages via `overview.stages`. The "All" tooltip is only needed in the admin view (Chunk 2).

- [ ] **Step 1: Replace entire file content**

Replace the full contents of `src/views/partials/agent/pipeline-cards.njk` with:

```nunjucks
{% set stageColors = {
  'lead': 'border-blue-500',
  'engaged': 'border-yellow-500',
  'active': 'border-green-500',
  'completed': 'border-purple-500',
  'archived': 'border-gray-400'
} %}
{% set stageTooltips = {
  'lead': 'New enquiry received. Not yet contacted or assigned to an agent',
  'engaged': 'In active consultation. EAA being prepared or signed',
  'active': 'Property listed and transaction in progress. Viewings, offers, OTP',
  'completed': 'Transaction closed. Commission paid',
  'archived': 'Case closed without a completed transaction, or past retention period'
} %}
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
  {% for stage in overview.stages %}
  <a href="/agent/dashboard?stage={{ stage.status }}"
     class="card border-t-4 relative group {% if currentStage == stage.status %}{{ stageColors[stage.status] or 'border-gray-300' }} ring-2 ring-offset-1{% else %}border-gray-200 hover:{{ stageColors[stage.status] or 'border-gray-300' }}{% endif %} transition">
    <span class="absolute top-2 right-2 w-4 h-4 rounded-full bg-gray-100 text-gray-400 text-xs flex items-center justify-center cursor-default select-none">?</span>
    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded px-2 py-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
      {{ stageTooltips[stage.status] | t }}
      <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
    </div>
    <p class="text-xs font-medium text-gray-500 uppercase">{{ stage.status | replace("_", " ") | t }}</p>
    <p class="text-2xl font-bold mt-1">{{ stage.count }}</p>
    {% if stage.totalValue > 0 %}
    <p class="text-sm text-gray-500">${{ stage.totalValue | formatPrice }}</p>
    {% endif %}
  </a>
  {% endfor %}
</div>

{# Lead queue summary #}
{% if overview.unassignedLeadCount > 0 %}
<div class="bg-blue-50 border-l-4 border-blue-400 p-4">
  <div class="flex items-center justify-between">
    <p class="text-sm font-medium text-blue-800">
      {{ overview.unassignedLeadCount }} {{ "new leads awaiting assignment" | t }}
    </p>
    <a href="/agent/leads" class="text-sm text-blue-700 underline hover:text-blue-900">{{ "View leads" | t }} &rarr;</a>
  </div>
</div>
{% endif %}
```

- [ ] **Step 2: Verify visually**

Run `npm run dev`. Visit `http://localhost:3000/agent/dashboard`. Hover each stage card — a dark tooltip should appear above the card with a downward arrow and the correct description text.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/agent/pipeline-cards.njk
git commit -m "feat: add hover tooltips to agent pipeline stage cards"
```

---

## Chunk 2: Admin pipeline cards

### Task 2: Update `admin/pipeline.njk` with tooltips

**Files:**
- Modify: `src/views/pages/admin/pipeline.njk`

- [ ] **Step 1: Replace entire file content**

Replace the full contents of `src/views/pages/admin/pipeline.njk` with:

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline" | t }}</h1>

{% set stageList = [
  { value: 'lead',      label: 'Lead',      color: 'border-blue-500',   tooltip: 'New enquiry received. Not yet contacted or assigned to an agent' },
  { value: 'engaged',   label: 'Engaged',   color: 'border-yellow-500', tooltip: 'In active consultation. EAA being prepared or signed' },
  { value: 'active',    label: 'Active',    color: 'border-green-500',  tooltip: 'Property listed and transaction in progress. Viewings, offers, OTP' },
  { value: 'completed', label: 'Completed', color: 'border-purple-500', tooltip: 'Transaction closed. Commission paid' },
  { value: 'archived',  label: 'Archived',  color: 'border-gray-400',   tooltip: 'Case closed without a completed transaction, or past retention period' }
] %}

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
  {# All card #}
  <a href="/admin/pipeline"
     class="card border-t-4 relative group {% if not stage %}border-accent ring-2 ring-accent/20{% else %}border-gray-200 hover:border-gray-300{% endif %}">
    <span class="absolute top-2 right-2 w-4 h-4 rounded-full bg-gray-100 text-gray-400 text-xs flex items-center justify-center cursor-default select-none">?</span>
    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded px-2 py-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
      {{ "All sellers currently in your pipeline" | t }}
      <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
    </div>
    <p class="text-xs font-medium text-gray-500 uppercase">{{ "All" | t }}</p>
    <p class="text-2xl font-bold mt-1">{{ stageCounts.lead + stageCounts.engaged + stageCounts.active + stageCounts.completed + stageCounts.archived }}</p>
  </a>
  {% for s in stageList %}
  <a href="/admin/pipeline?stage={{ s.value }}"
     class="card border-t-4 relative group {% if stage == s.value %}{{ s.color }} ring-2 ring-offset-1{% else %}border-gray-200 hover:{{ s.color }}{% endif %}">
    <span class="absolute top-2 right-2 w-4 h-4 rounded-full bg-gray-100 text-gray-400 text-xs flex items-center justify-center cursor-default select-none">?</span>
    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded px-2 py-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
      {{ s.tooltip | t }}
      <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
    </div>
    <p class="text-xs font-medium text-gray-500 uppercase">{{ s.label | t }}</p>
    <p class="text-2xl font-bold mt-1">{{ stageCounts[s.value] or 0 }}</p>
  </a>
  {% endfor %}
</div>

<div id="pipeline-content">
  {% include "partials/admin/pipeline-table.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 2: Verify visually**

Visit `http://localhost:3000/admin/pipeline`. Hover each of the 6 cards (All + 5 stages) — tooltip appears above each with the correct text and a downward arrow.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/pipeline.njk
git commit -m "feat: add hover tooltips to admin pipeline stage cards"
```

---

## Chunk 3: Push

- [ ] **Step 1: Push branch**

```bash
git push
```
