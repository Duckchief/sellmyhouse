# UI Design System — Consistent Page Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply consistent layout structure (page-header partial, info-grid, page-section CSS classes) to all admin, agent, and seller portal pages.

**Architecture:** One new Nunjucks partial (`page-header.njk`) + three CSS classes (`info-grid`, `page-section`, `page-section-title`) form the design system. All ~30 page templates are updated to use these primitives. No router, service, repository, or test changes required.

**Tech Stack:** Nunjucks templates, Tailwind CSS (`src/views/styles/input.css`), `npm run build` to compile CSS.

**Spec:** `docs/superpowers/specs/2026-03-16-ui-design-system.md`

---

## Chunk 1: Foundation — CSS classes + page-header partial

### Task 1: Add CSS classes to input.css

**Files:**
- Modify: `src/views/styles/input.css`

- [ ] **Step 1: Add three new classes inside the `@layer components` block**

Open `src/views/styles/input.css`. The file currently ends with:
```css
  .card {
    @apply bg-white rounded-lg border border-gray-200 shadow-sm p-6;
  }
}
```

Replace the closing `}` and add:
```css
  .card {
    @apply bg-white rounded-lg border border-gray-200 shadow-sm p-6;
  }
  .info-grid {
    @apply grid grid-cols-1 md:grid-cols-2 gap-6 mb-6;
  }
  .page-section {
    @apply mb-6;
  }
  .page-section-title {
    @apply text-lg font-bold text-gray-900 mb-4;
  }
}
```

- [ ] **Step 2: Build Tailwind and verify no errors**

```bash
npm run build
```
Expected: exits 0, no CSS errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/styles/input.css
git commit -m "feat: add info-grid, page-section, page-section-title CSS classes"
```

---

### Task 2: Create page-header.njk partial

**Files:**
- Create: `src/views/partials/shared/page-header.njk`

- [ ] **Step 1: Create the partial**

```njk
{#
  page-header.njk — standardised page header for all portal pages.

  Variables (set before {% include %}):
    pageTitle       — required. The h1 text.
    backUrl         — optional. Renders "← Back to [backLabel]" link above title.
    backLabel       — optional. Defaults to "Back" when backUrl is set.
    pageBadge       — optional. Object { text, color } where color is one of:
                       blue | yellow | green | gray | red | purple | orange | indigo
    pageSubtitle    — optional. Small gray text below the title row.
    pageActionsHtml — optional. Rendered HTML string injected right of title.
                      Use {% set pageActionsHtml %}...{% endset %} to capture.

  Example (detail page):
    {% set pageTitle = seller.name %}
    {% set backUrl = "/admin/sellers" %}
    {% set backLabel = "Back to Sellers" %}
    {% set pageBadge = { text: seller.status, color: "blue" } %}
    {% include "partials/shared/page-header.njk" %}
#}

{% if backUrl %}
<div class="mb-4">
  <a href="{{ backUrl }}" class="text-sm text-accent hover:underline">← {{ (backLabel or "Back") | t }}</a>
</div>
{% endif %}

<div class="flex items-center {% if pageActionsHtml %}justify-between{% else %}gap-4{% endif %} mb-6">
  <div class="flex items-center gap-4">
    <h1 class="text-2xl font-bold">{{ pageTitle }}</h1>
    {% if pageBadge %}
    <span class="px-2 py-0.5 text-xs rounded-full
      {% if pageBadge.color == 'blue' %}bg-blue-100 text-blue-800
      {% elif pageBadge.color == 'yellow' %}bg-yellow-100 text-yellow-800
      {% elif pageBadge.color == 'green' %}bg-green-100 text-green-800
      {% elif pageBadge.color == 'gray' %}bg-gray-100 text-gray-800
      {% elif pageBadge.color == 'red' %}bg-red-100 text-red-800
      {% elif pageBadge.color == 'purple' %}bg-purple-100 text-purple-800
      {% elif pageBadge.color == 'orange' %}bg-orange-100 text-orange-800
      {% elif pageBadge.color == 'indigo' %}bg-indigo-100 text-indigo-800
      {% endif %}">{{ pageBadge.text | t }}</span>
    {% endif %}
  </div>
  {% if pageActionsHtml %}{{ pageActionsHtml | safe }}{% endif %}
</div>

{% if pageSubtitle %}
<p class="text-sm text-gray-500 -mt-3 mb-6">{{ pageSubtitle }}</p>
{% endif %}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/shared/page-header.njk
git commit -m "feat: add shared page-header.njk partial"
```

---

## Chunk 2: Type 1 — Detail pages

### Task 3: Update admin/seller-detail.njk

**Files:**
- Modify: `src/views/pages/admin/seller-detail.njk`

The current file has: a back link in a `<div class="mb-4">`, then a `bg-white rounded-lg shadow p-6 mb-6` header card, then a 2-col grid using `bg-white rounded-lg shadow p-6` inline cards.

- [ ] **Step 1: Replace back nav + header card + inline card styles**

Replace the entire `{% block content %}` body with:

```njk
{% block content %}
{# ── Header ── #}
{% set pageTitle = detail.seller.name %}
{% set backUrl = "/admin/sellers" %}
{% set backLabel = "Back to Sellers" %}
{% set pageBadge = { text: detail.seller.status,
  color: {
    'lead': 'blue', 'engaged': 'yellow', 'active': 'green',
    'completed': 'gray', 'archived': 'red'
  }[detail.seller.status] or 'gray' } %}
{% include "partials/shared/page-header.njk" %}

{# ── 2-column card grid ── #}
<div class="info-grid">

  {# Left: Seller Info #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Seller Information" | t }}</h2>
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Phone" | t }}</dt>
        <dd>{{ detail.seller.phone }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Email" | t }}</dt>
        <dd>{{ detail.seller.email or '—' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Notification Preference" | t }}</dt>
        <dd>{{ detail.seller.notificationPreference }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Created" | t }}</dt>
        <dd>{{ detail.seller.createdAt | date }}</dd>
      </div>
    </dl>
  </div>

  {# Right: Property #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Property" | t }}</h2>
    {% if detail.property %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Address" | t }}</dt>
        <dd>{{ detail.property.block }} {{ detail.property.street }}, {{ detail.property.town }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Flat Type" | t }}</dt>
        <dd>{{ detail.property.flatType }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Floor Area" | t }}</dt>
        <dd>{{ detail.property.floorAreaSqm }} sqm</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Storey" | t }}</dt>
        <dd>{{ detail.property.storeyRange }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Asking Price" | t }}</dt>
        <dd>{% if detail.property.askingPrice %}${{ detail.property.askingPrice | formatPrice }}{% else %}—{% endif %}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No property on file." | t }}</p>
    {% endif %}
  </div>

  {# Left: Assigned Agent #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Assigned Agent" | t }}</h2>
    {% if detail.agent %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Name" | t }}</dt>
        <dd>{{ detail.agent.name }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "CEA Reg No" | t }}</dt>
        <dd>{{ detail.agent.ceaRegNo }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Phone" | t }}</dt>
        <dd>{{ detail.agent.phone or '—' }}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-sm">
      <span class="text-amber-600 font-medium">{{ "Unassigned" | t }}</span>
      — <a href="/admin/sellers" class="text-accent hover:underline">{{ "Go to sellers list to assign" | t }}</a>
    </p>
    {% endif %}
  </div>

  {# Right: Transaction #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Transaction" | t }}</h2>
    {% if detail.transaction %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Status" | t }}</dt>
        <dd>{{ detail.transaction.status }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Agreed Price" | t }}</dt>
        <dd>${{ detail.transaction.agreedPrice | formatPrice }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "HDB Application" | t }}</dt>
        <dd>{{ detail.transaction.hdbApplicationStatus }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "OTP Status" | t }}</dt>
        <dd>{{ detail.transaction.otpStatus or '—' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Started" | t }}</dt>
        <dd>{{ detail.transaction.createdAt | date }}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No transaction yet." | t }}</p>
    {% endif %}
  </div>

  {# Left: Compliance #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Compliance" | t }}</h2>
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "CDD Record" | t }}</dt>
        <dd>
          {% if detail.compliance.cdd %}
            <span class="{% if detail.compliance.cdd.identityVerified %}text-green-700{% else %}text-amber-600{% endif %} font-medium">
              {% if detail.compliance.cdd.identityVerified %}{{ "Verified" | t }}{% else %}{{ "Pending" | t }}{% endif %}
            </span>
            <span class="text-gray-500">({{ detail.compliance.cdd.riskLevel }})</span>
          {% else %}
            <span class="text-gray-400">{{ "None on file" | t }}</span>
          {% endif %}
        </dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Consent Records" | t }}</dt>
        <dd>{{ detail.compliance.consentCount }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Consent Withdrawal" | t }}</dt>
        <dd>
          {% if detail.compliance.hasWithdrawal %}
            <span class="text-red-600 font-medium">{{ "Yes" | t }}</span>
          {% else %}
            {{ "No" | t }}
          {% endif %}
        </dd>
      </div>
    </dl>
  </div>

  {# Right: Status History #}
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">{{ "Status History" | t }}</h2>
    {% if detail.auditLog.length > 0 %}
    <ol class="relative border-l border-gray-200 ml-3 space-y-4">
      {% for entry in detail.auditLog %}
      <li class="ml-4">
        <div class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gray-300"></div>
        <time class="text-xs text-gray-400">{{ entry.createdAt | date }}</time>
        <p class="text-sm font-medium text-gray-800">{{ entry.action }}</p>
      </li>
      {% endfor %}
    </ol>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No audit history." | t }}</p>
    {% endif %}
  </div>

</div>

{# ── Transaction Timeline (full-width) ── #}
<div class="page-section">
  <h2 class="page-section-title">{{ "Transaction Timeline" | t }}</h2>
  {% set milestones = detail.milestones %}
  {% include "partials/agent/seller-timeline.njk" %}
</div>

{# ── Notifications (full-width) ── #}
<div class="page-section">
  <h2 class="page-section-title">{{ "Notifications" | t }}</h2>
  {% set notifications = detail.notifications %}
  {% include "partials/agent/seller-notifications.njk" %}
</div>

{% endblock %}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/seller-detail.njk
git commit -m "style: apply page-header + info-grid + page-section to admin seller detail"
```

---

### Task 4: Update agent/seller-detail.njk

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

Current pattern uses `<section>` wrappers with uppercase `<p>` labels and `bg-white rounded-xl border border-slate-200 p-6` cards. Replace with `.card` + `.page-section` + `.page-section-title`.

Remove the `seller-header.njk` include entirely — its title, badge, and status-buttons are superseded by `page-header.njk` + `pageActionsHtml`. The `#modal-container` div that `seller-header.njk` previously owned is re-added explicitly at the bottom of the block.

- [ ] **Step 1: Update the page**

Replace the entire `{% block content %}` body with:

```njk
{% block content %}
{# ── Header (back nav via page-header, title via existing seller-header) ── #}
{% set backUrl = "/agent/sellers" %}
{% set backLabel = "Back to Sellers" %}
{% set pageTitle = seller.name %}
{% set pageBadge = { text: seller.status,
  color: {
    'lead': 'blue', 'engaged': 'yellow', 'active': 'green',
    'completed': 'gray', 'archived': 'red'
  }[seller.status] or 'gray' } %}
{% set pageActionsHtml %}{% include "partials/agent/seller-status-buttons.njk" %}{% endset %}
{% include "partials/shared/page-header.njk" %}

<div class="space-y-6">

  {# 1. Overview #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Overview" | t }}</h2>
    <div class="card">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Seller Info" | t }}</h3>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.status }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Lead Source" | t }}</dt><dd>{{ seller.leadSource or "—" }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Created" | t }}</dt><dd>{{ seller.createdAt | date('DD/MM/YYYY HH:mm') }}</dd></div>
          </dl>
        </div>
        {% if seller.property %}
        <div>
          <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Property" | t }}</h3>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Address" | t }}</dt><dd>{{ seller.property.block }} {{ seller.property.street }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Town" | t }}</dt><dd>{{ seller.property.town }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Type" | t }}</dt><dd>{{ seller.property.flatType }}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Floor Area" | t }}</dt><dd>{{ seller.property.floorAreaSqm }} sqm</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Asking Price" | t }}</dt><dd>{% if seller.property.askingPrice %}${{ seller.property.askingPrice | formatPrice }}{% else %}{{ "Not set" | t }}{% endif %}</dd></div>
            <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.property.status }}</dd></div>
          </dl>
        </div>
        {% else %}
        <div>
          <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Property" | t }}</h3>
          <p class="text-gray-500 text-sm">{{ "No property added yet" | t }}</p>
        </div>
        {% endif %}
      </div>
    </div>
  </div>

  {# 2. Transaction Timeline #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Transaction Timeline" | t }}</h2>
    <div class="card">
      <div class="space-y-4">
        {% for milestone in milestones %}
        <div class="flex items-start gap-3">
          <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0
            {% if milestone.status == 'completed' %}bg-green-500
            {% elif milestone.status == 'current' %}bg-blue-500
            {% else %}bg-gray-300{% endif %}"></div>
          <div>
            <div class="text-sm font-medium {% if milestone.status == 'upcoming' %}text-gray-400{% endif %}">{{ milestone.label | t }}</div>
            <div class="text-xs text-gray-500">{{ milestone.description | t }}</div>
          </div>
        </div>
        {% endfor %}
      </div>
    </div>
  </div>

  {# 3. CDD Status #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "CDD Status" | t }}</h2>
    <div class="card">
      {% include "partials/agent/compliance-cdd-card.njk" %}
    </div>
  </div>

  {# 4. Estate Agency Agreement #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Estate Agency Agreement" | t }}</h2>
    <div class="card">
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  </div>

  {# 5. Counterparty CDD — only when active transaction exists #}
  {% if compliance.counterpartyCdd %}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Counterparty CDD" | t }}</h2>
    <div class="card">
      {% include "partials/agent/compliance-counterparty-cdd-card.njk" %}
    </div>
  </div>
  {% endif %}

  {# 6. Consent #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Consent" | t }}</h2>
    <div class="card">
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
        {% if compliance.consent.withdrawnAt %}
        <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
        {% endif %}
      </dl>
    </div>
  </div>

  {# 7. Case Flags #}
  <div class="page-section">
    <h2 class="page-section-title">{{ "Case Flags" | t }}</h2>
    <div class="card">
      {% if compliance.caseFlags.length == 0 %}
      <p class="text-sm text-gray-500">{{ "No active flags" | t }}</p>
      {% else %}
      <div class="space-y-2">
        {% for flag in compliance.caseFlags %}
        <div class="text-sm border-l-2 border-yellow-500 pl-3">
          <div class="font-medium">{{ flag.flagType }}</div>
          <div class="text-gray-500">{{ flag.description }}</div>
        </div>
        {% endfor %}
      </div>
      {% endif %}
    </div>
  </div>

  {# 8. Notifications #}
  <div class="page-section" id="notifications-fieldset">
    <h2 class="page-section-title">{{ "Notifications" | t }}</h2>
    <div class="card" id="notifications-section">
      {% include "partials/agent/seller-notifications.njk" %}
    </div>
  </div>

</div>

{# Modal containers — #modal-container used by seller-status-buttons.njk HTMX targets #}
<div id="modal-container"></div>
<div id="compliance-modal-container"></div>
{% endblock %}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk
git commit -m "style: apply page-header + page-section + .card to agent seller detail"
```

---

### Task 5: Update agent/transaction.njk

**Files:**
- Modify: `src/views/pages/agent/transaction.njk`

Current file is just `<h1>{{ "Transaction" | t }}</h1>` + include. Add page-header.

- [ ] **Step 1: Update the page**

Replace entire `{% block content %}` with:

```njk
{% block content %}
{% set pageTitle = "Transaction" %}
{% set backUrl = "/agent/sellers" %}
{% set backLabel = "Back to Sellers" %}
{% include "partials/shared/page-header.njk" %}

{% include "partials/agent/transaction-detail.njk" %}
{% endblock %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/agent/transaction.njk
git commit -m "style: apply page-header to agent transaction page"
```

---

## Chunk 3: Type 2 — Dashboards

### Task 6: Update admin/dashboard.njk

**Files:**
- Modify: `src/views/pages/admin/dashboard.njk`

Current: `<h1 class="text-2xl font-bold mb-2">` + subtitle `<p>`.

- [ ] **Step 1: Update**

Replace:
```njk
<h1 class="text-2xl font-bold mb-2">{{ "Analytics Dashboard" | t }}</h1>
<p class="text-gray-500 mb-6">{{ "Platform performance overview" | t }}</p>
```
With:
```njk
{% set pageTitle = "Analytics Dashboard" %}
{% set pageSubtitle = "Platform performance overview" %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/admin/dashboard.njk
git commit -m "style: apply page-header to admin dashboard"
```

---

### Task 7: Update agent/dashboard.njk

**Files:**
- Modify: `src/views/pages/agent/dashboard.njk`

Current: `<h1 class="text-2xl font-bold mb-6">`.

- [ ] **Step 1: Update**

Replace:
```njk
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline Overview" | t }}</h1>
```
With:
```njk
{% set pageTitle = "Pipeline Overview" %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/agent/dashboard.njk
git commit -m "style: apply page-header to agent dashboard"
```

---

### Task 8: Update seller/dashboard.njk

**Files:**
- Modify: `src/views/pages/seller/dashboard.njk`

Current: `<h1 class="text-2xl font-bold mb-6">{{ "Welcome back, " | t }}{{ overview.seller.name }}</h1>`.

- [ ] **Step 1: Update**

Replace:
```njk
<h1 class="text-2xl font-bold mb-6">{{ "Welcome back, " | t }}{{ overview.seller.name }}</h1>
```
With:
```njk
{% set pageTitle = ("Welcome back, " | t) + overview.seller.name %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/seller/dashboard.njk
git commit -m "style: apply page-header to seller dashboard"
```

---

## Chunk 4: Type 4 — Settings pages

**Pattern for all:** Replace inline `<h1>` with page-header include. Replace `bg-white rounded-xl border border-slate-200` section wrappers with `.card`. Replace uppercase `<p>` section labels with `.page-section-title`.

### Task 9: Update seller/settings.njk + seller/notifications.njk

**Files:**
- Modify: `src/views/pages/seller/settings.njk`
- Modify: `src/views/pages/seller/notifications.njk`

- [ ] **Step 1: Update seller/settings.njk**

Replace:
```njk
  <div class="max-w-2xl mx-auto">
    <h1 class="text-2xl font-semibold text-gray-900 mb-6">{{ "Settings" | t }}</h1>

    {% include "partials/seller/settings-notifications.njk" %}
  </div>
```
With:
```njk
  <div class="max-w-2xl mx-auto">
    {% set pageTitle = "Settings" %}
    {% include "partials/shared/page-header.njk" %}
    {% include "partials/seller/settings-notifications.njk" %}
  </div>
```

- [ ] **Step 2: Update seller/notifications.njk**

Replace the entire `{% block content %}` with:

```njk
{% block content %}
{% set pageTitle = "Notifications" %}
{% include "partials/shared/page-header.njk" %}

{# notification-list.njk renders its own internal padding, so use card without extra padding #}
<div class="card" style="padding:0;">
  {% include "partials/seller/notification-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 3: Build, commit**

```bash
npm run build
git add src/views/pages/seller/settings.njk src/views/pages/seller/notifications.njk
git commit -m "style: apply page-header to seller settings and notifications pages"
```

---

### Task 10: Update agent/settings.njk

**Files:**
- Modify: `src/views/pages/agent/settings.njk`

Current: `<h1 class="text-2xl font-bold mb-8">` + `<section>` blocks with `<p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">` labels and `bg-white rounded-xl border border-slate-200 p-6` cards.

- [ ] **Step 1: Update page-header**

Replace:
```njk
  <h1 class="text-2xl font-bold mb-8">{{ "Communication Settings" | t }}</h1>
```
With:
```njk
    {% set pageTitle = "Communication Settings" %}
    {% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Replace section containers**

For each `<section>` block, replace the pattern:
```njk
    <section>
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Section Label" | t }}</p>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        ...content...
      </div>
    </section>
```
With:
```njk
    <div class="page-section">
      <h2 class="page-section-title">{{ "Section Label" | t }}</h2>
      <div class="card">
        ...content...
      </div>
    </div>
```

- [ ] **Step 3: Build, commit**

```bash
npm run build
git add src/views/pages/agent/settings.njk
git commit -m "style: apply page-header + page-section + .card to agent settings"
```

---

### Task 11: Update admin/settings.njk

**Files:**
- Modify: `src/views/pages/admin/settings.njk`

Current: `<h1 class="text-2xl font-bold mb-6">` + `<section>` blocks with `<p class="text-xs font-semibold uppercase...">` labels and `bg-white rounded-xl border border-slate-200` cards.

- [ ] **Step 1: Update**

Replace the entire `{% block content %}` with:

```njk
{% block content %}
{% set pageTitle = "System Settings" %}
{% include "partials/shared/page-header.njk" %}
<div class="space-y-6">
{% for group in groups %}
  <div class="page-section">
    <h2 class="page-section-title">{{ group.label | t }}</h2>
    <div class="card divide-y divide-gray-100" style="padding:0;">
      {% for setting in group.settings %}
      <div class="flex items-start gap-4 px-6 py-4">
        <div class="flex-1">
          <div class="text-sm font-medium text-gray-800">{{ setting.key }}</div>
          <div class="text-xs text-gray-500">{{ setting.description }}</div>
        </div>
        <form class="flex items-center gap-2" hx-post="/admin/settings/{{ setting.key }}" hx-target="#result-{{ setting.key }}">
          <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
          <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
        </form>
        <div id="result-{{ setting.key }}" class="w-32 text-sm"></div>
      </div>
      {% endfor %}
    </div>
  </div>
{% endfor %}
</div>
{% endblock %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/admin/settings.njk
git commit -m "style: apply page-header + page-section + .card to admin settings"
```

---

## Chunk 5: Type 3 — Admin single-focus pages

**Pattern:** Replace inline `<h1>` (and any action-button flex wrapper) with page-header include. Where action buttons exist alongside the title (audit-log export, team add-form), use `pageActionsHtml`.

### Task 12: Update admin/team.njk

**Files:**
- Modify: `src/views/pages/admin/team.njk`

Current: `<div class="flex items-center justify-between mb-6"><h1>...</h1><form>...</form></div>`.

- [ ] **Step 1: Update**

Replace:
```njk
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">{{ "Team Management" | t }}</h1>
  <form hx-post="/admin/team" hx-target="#action-result" class="inline">
    <input type="text" name="name" placeholder="{{ 'Name' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="email" name="email" placeholder="{{ 'Email' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="text" name="phone" placeholder="{{ 'Phone' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <input type="text" name="ceaRegNo" placeholder="{{ 'CEA Reg No' | t }}" required class="border rounded px-2 py-1 text-sm" />
    <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Add Agent" | t }}</button>
  </form>
</div>
```
With:
```njk
{% set pageTitle = "Team Management" %}
{% set pageActionsHtml %}
<form hx-post="/admin/team" hx-target="#action-result" class="inline">
  <input type="text" name="name" placeholder="{{ 'Name' | t }}" required class="border rounded px-2 py-1 text-sm" />
  <input type="email" name="email" placeholder="{{ 'Email' | t }}" required class="border rounded px-2 py-1 text-sm" />
  <input type="text" name="phone" placeholder="{{ 'Phone' | t }}" required class="border rounded px-2 py-1 text-sm" />
  <input type="text" name="ceaRegNo" placeholder="{{ 'CEA Reg No' | t }}" required class="border rounded px-2 py-1 text-sm" />
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Add Agent" | t }}</button>
</form>
{% endset %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/admin/team.njk
git commit -m "style: apply page-header to admin team page"
```

---

### Task 13: Update admin/pipeline.njk

**Files:**
- Modify: `src/views/pages/admin/pipeline.njk`

- [ ] **Step 1: Update**

Replace:
```njk
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline" | t }}</h1>
```
With:
```njk
{% set pageTitle = "Pipeline" %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/admin/pipeline.njk
git commit -m "style: apply page-header to admin pipeline page"
```

---

### Task 14: Update admin/audit-log.njk

**Files:**
- Modify: `src/views/pages/admin/audit-log.njk`

Current: `<div class="flex items-center justify-between mb-6"><h1>...</h1><a>Export CSV</a></div>`.

- [ ] **Step 1: Update**

Replace the flex header div:
```njk
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">{{ "Audit Log" | t }}</h1>
  <a href="/admin/audit/export?action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}&dateFrom={{ filter.dateFrom or '' }}&dateTo={{ filter.dateTo or '' }}"
     class="bg-gray-100 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200">{{ "Export CSV" | t }}</a>
</div>
```
With:
```njk
{% set pageTitle = "Audit Log" %}
{% set pageActionsHtml %}
<a href="/admin/audit/export?action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}&dateFrom={{ filter.dateFrom or '' }}&dateTo={{ filter.dateTo or '' }}"
   class="bg-gray-100 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-200">{{ "Export CSV" | t }}</a>
{% endset %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 2: Build, commit**

```bash
npm run build
git add src/views/pages/admin/audit-log.njk
git commit -m "style: apply page-header to admin audit log page"
```

---

### Task 15: Batch-update remaining admin single-focus pages

**Files:**
- Modify: `src/views/pages/admin/review-queue.njk`
- Modify: `src/views/pages/admin/hdb.njk`
- Modify: `src/views/pages/admin/market-content.njk`
- Modify: `src/views/pages/admin/market-content-detail.njk`
- Modify: `src/views/pages/admin/referrals.njk`
- Modify: `src/views/pages/admin/notifications.njk`
- Modify: `src/views/pages/admin/tutorials.njk`
- Modify: `src/views/pages/admin/tutorial-form.njk`
- Modify: `src/views/pages/admin/leads.njk`
- Modify: `src/views/pages/admin/sellers.njk`
- Modify: `src/views/pages/admin/testimonials.njk`
- Modify: `src/views/pages/admin/team-pipeline.njk`

For each file:

- [ ] **Step 1: Read each file**, identify the `<h1>` tag and its wrapper (plain or flex-with-actions).

- [ ] **Step 2: Apply the standard replacement**

For plain `<h1>`:
```njk
{# Before #}
<h1 class="text-2xl font-bold mb-6">{{ "Page Title" | t }}</h1>

{# After #}
{% set pageTitle = "Page Title" %}
{% include "partials/shared/page-header.njk" %}
```

For flex-with-actions:
```njk
{# Before #}
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">{{ "Page Title" | t }}</h1>
  [actions HTML]
</div>

{# After #}
{% set pageTitle = "Page Title" %}
{% set pageActionsHtml %}[actions HTML]{% endset %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 3: Build and verify all changes compile**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 4: Commit all admin page changes**

```bash
git add src/views/pages/admin/
git commit -m "style: apply page-header to remaining admin single-focus pages"
```

---

## Chunk 6: Type 3 — Agent single-focus pages

### Task 16: Batch-update agent single-focus pages

**Files:**
- Modify: `src/views/pages/agent/portals.njk`
- Modify: `src/views/pages/agent/offers.njk`
- Modify: `src/views/pages/agent/reviews.njk`
- Modify: `src/views/pages/agent/leads.njk`
- Modify: `src/views/pages/agent/sellers.njk`
- Modify: `src/views/pages/agent/correction-requests.njk`

For each file:

- [ ] **Step 1: Read each file**, identify the `<h1>` tag and any sections using `bg-white rounded-xl border border-slate-200`.

- [ ] **Step 2: Apply page-header replacement** (same as Task 15 pattern).

- [ ] **Step 3: Replace `bg-white rounded-xl border border-slate-200 p-6` section containers**

For any `<section>` or `<div>` blocks using the portal-panel card style with an uppercase `<p>` label:
```njk
{# Before #}
<section>
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Section" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6">...</div>
</section>

{# After #}
<div class="page-section">
  <h2 class="page-section-title">{{ "Section" | t }}</h2>
  <div class="card">...</div>
</div>
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/agent/
git commit -m "style: apply page-header + page-section + .card to agent single-focus pages"
```

---

## Chunk 7: Type 3 — Seller single-focus pages

### Task 17: Batch-update seller single-focus pages

**Files:**
- Modify: `src/views/pages/seller/property.njk`
- Modify: `src/views/pages/seller/documents.njk`
- Modify: `src/views/pages/seller/financial.njk`
- Modify: `src/views/pages/seller/photos.njk`
- Modify: `src/views/pages/seller/my-data.njk`
- Modify: `src/views/pages/seller/referral.njk`
- Modify: `src/views/pages/seller/tutorials.njk`
- Modify: `src/views/pages/seller/case-flags.njk`

For each file:

- [ ] **Step 1: Read each file**, identify the `<h1>` and any inline card wrappers (`bg-white rounded-lg shadow`, `bg-white rounded-xl border border-slate-200`).

- [ ] **Step 2: Apply page-header replacement**

Replace inline `<h1>` with:
```njk
{% set pageTitle = "Page Title" %}
{% include "partials/shared/page-header.njk" %}
```

- [ ] **Step 3: Standardise card wrappers**

Any `<div class="bg-white rounded-lg shadow">` or `<div class="bg-white rounded-xl border border-slate-200 p-6">` that wraps a content section → replace with `<div class="card">`.

Note: `seller/financial.njk` uses a 3-col grid (`lg:grid-cols-3`) — preserve that outer grid structure, only update the heading and any inline card wrappers inside.

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/seller/
git commit -m "style: apply page-header + .card to seller single-focus pages"
```

---

## Chunk 8: Final verification

### Task 18: Smoke-test all portals

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify each portal's key pages load without errors**

Navigate to each of the following (log in as appropriate user type):
- `/admin/dashboard` — title renders, no layout breakage
- `/admin/sellers/[id]` — 2-col grid, back nav, badge all present
- `/agent/dashboard` — title renders
- `/agent/sellers/[id]` — page-section titles, .card wrappers
- `/seller/dashboard` — title renders
- `/seller/documents` — title and card present
- `/admin/settings` — section titles render correctly

- [ ] **Step 3: Run build one final time**

```bash
npm run build && npm test
```
Expected: build exits 0, all unit tests pass (template changes have no effect on unit tests).

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "style: final cleanup from smoke-test review"
```
