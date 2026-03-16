# Dashboard Section Pattern Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all dated section containers (fieldset/legend, h2-inside-card, shadow cards) across the agent, admin, and seller dashboards with the approved flat label + card pattern.

**Architecture:** Pure template changes only — no TypeScript, no routes, no tests needed. Each page's section groupings get an uppercase label above the card instead of a title inside or a fieldset legend. The card itself becomes `bg-white rounded-xl border border-slate-200 p-6` with no shadow.

**Tech Stack:** Nunjucks templates, Tailwind CSS

---

## The Pattern (reference for all tasks)

**Before (fieldset):**
```html
<fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
  <legend class="px-2 text-base font-semibold text-gray-900">{{ "Title" | t }}</legend>
  <!-- content -->
</fieldset>
```

**Before (h2 inside card):**
```html
<div class="bg-white shadow rounded-lg p-6 mb-6">
  <h2 class="text-lg font-semibold mb-4">{{ "Title" | t }}</h2>
  <!-- content -->
</div>
```

**After (all cases):**
```html
<section class="mb-6">
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Title" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6">
    <!-- content -->
  </div>
</section>
```

**Rules:**
- Label: `text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1`
- Card: `bg-white rounded-xl border border-slate-200 p-6`
- No `shadow` or `shadow-sm` on section cards
- No h2/h3 section titles inside the card
- Semantic `<fieldset>` for radio/checkbox groups (no visual styling) — keep as-is
- Sections list: `space-y-6` between them (seller-detail.njk already uses this)
- `<section>` elements use bare `<section>` (no `mb-6` class) — spacing comes from the parent `space-y-6` container

**Audited and skipped (no section patterns found):** `transaction.njk`, `offers.njk`, `portals.njk` (thin wrappers), `admin/team.njk`, `admin/tutorials.njk`, `admin/market-content.njk` (list pages), `seller/property.njk` (thin wrapper), `seller/onboarding.njk` (step-based flow)

---

## Chunk 1: Agent Pages

### Task 1: seller-detail.njk — replace 8 fieldsets

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`

The page has 8 fieldsets. Replace each with the new pattern. Note: the Notifications fieldset has `id="notifications-fieldset"` — move the id to the `<section>` element.

Preserve lines 132–134 (modal container + endblock) — they are NOT part of this replacement:
```html
{# Modal containers #}
<div id="compliance-modal-container"></div>
{% endblock %}
```

- [ ] **Step 1: Open the file and apply the pattern to all 8 sections**

Replace only the `<div class="space-y-6">...</div>` block (lines 10–130). Leave the modal container and `{% endblock %}` at the end of the file untouched.

```njk
<div class="space-y-6">

  {# 1. Overview #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Overview" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
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
  </section>

  {# 2. Transaction Timeline #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Transaction Timeline" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
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
  </section>

  {# 3. CDD Status #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "CDD Status" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      {% include "partials/agent/compliance-cdd-card.njk" %}
    </div>
  </section>

  {# 4. Estate Agency Agreement #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Estate Agency Agreement" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  </section>

  {# 5. Counterparty CDD — only when active transaction exists #}
  {% if compliance.counterpartyCdd %}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Counterparty CDD" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      {% include "partials/agent/compliance-counterparty-cdd-card.njk" %}
    </div>
  </section>
  {% endif %}

  {# 6. Consent #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Consent" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
        <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
        {% if compliance.consent.withdrawnAt %}
        <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
        {% endif %}
      </dl>
    </div>
  </section>

  {# 7. Case Flags #}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Case Flags" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
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
  </section>

  {# 8. Notifications #}
  <section id="notifications-fieldset">
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Notifications" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div id="notifications-section">
        {% include "partials/agent/seller-notifications.njk" %}
      </div>
    </div>
  </section>

</div>
```

- [ ] **Step 2: Verify the page renders**

```bash
npm run dev
# Navigate to any seller detail page in browser
# Confirm: 8 sections visible, uppercase labels, no fieldset borders
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk
git commit -m "style: replace fieldsets with flat label+card pattern on seller detail"
```

---

### Task 2: agent/settings.njk — 2 section cards

**Files:**
- Modify: `src/views/pages/agent/settings.njk`

Currently uses `bg-white shadow rounded-lg p-6 mb-6` with `h2` inside. Apply the new pattern.

- [ ] **Step 1: Replace both section cards**

Replace the full file content block (inside `{% block content %}`):

```njk
<div class="max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-8">{{ "Communication Settings" | t }}</h1>

  <div class="space-y-6">

    {# WhatsApp Settings #}
    <section>
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "WhatsApp (Meta Business API)" | t }}</p>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <form
          hx-post="/agent/settings/whatsapp"
          hx-target="#whatsapp-result"
          hx-swap="innerHTML"
          class="space-y-4"
        >
          <div id="whatsapp-result"></div>
          {% set waKeys = ['whatsapp_phone_number_id', 'whatsapp_api_token', 'whatsapp_business_account_id'] %}
          {% for key in waKeys %}
            <div>
              <label for="{{ key }}" class="block text-sm font-medium text-gray-700">{{ key | replace('_', ' ') | capitalize }}</label>
              <input type="{{ 'password' if 'token' in key else 'text' }}" id="{{ key }}" name="{{ key }}"
                placeholder="{% for s in settings %}{% if s.key == key and s.maskedValue %}{{ s.maskedValue }}{% endif %}{% endfor %}"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm" />
            </div>
          {% endfor %}
          <div class="flex gap-2">
            <button type="submit"
              class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              {{ "Save WhatsApp Settings" | t }}
            </button>
            <button type="button"
              hx-post="/agent/settings/test/whatsapp"
              hx-target="#whatsapp-result"
              hx-swap="innerHTML"
              class="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300">
              {{ "Test Connection" | t }}
            </button>
          </div>
        </form>
      </div>
    </section>

    {# Email/SMTP Settings #}
    <section>
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Email (SMTP)" | t }}</p>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <form
          hx-post="/agent/settings/email"
          hx-target="#email-result"
          hx-swap="innerHTML"
          class="space-y-4"
        >
          <div id="email-result"></div>
          {% set smtpKeys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_email', 'smtp_from_name'] %}
          {% for key in smtpKeys %}
            <div>
              <label for="{{ key }}" class="block text-sm font-medium text-gray-700">{{ key | replace('_', ' ') | capitalize }}</label>
              <input type="{{ 'password' if 'pass' in key else 'text' }}" id="{{ key }}" name="{{ key }}"
                placeholder="{% for s in settings %}{% if s.key == key and s.maskedValue %}{{ s.maskedValue }}{% endif %}{% endfor %}"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm" />
            </div>
          {% endfor %}
          <div class="flex gap-2">
            <button type="submit"
              class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              {{ "Save Email Settings" | t }}
            </button>
            <button type="button"
              hx-post="/agent/settings/test/email"
              hx-target="#email-result"
              hx-swap="innerHTML"
              class="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300">
              {{ "Test Connection" | t }}
            </button>
          </div>
        </form>
      </div>
    </section>

  </div>
</div>
```

- [ ] **Step 2: Verify**

```bash
# Navigate to /agent/settings
# Confirm: 2 labelled sections, no shadow, rounded-xl
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/agent/settings.njk
git commit -m "style: apply flat label+card pattern to agent settings page"
```

---

### Task 3: agent/correction-requests.njk — table container

**Files:**
- Modify: `src/views/pages/agent/correction-requests.njk`

The table is wrapped in `bg-white shadow rounded-lg` — update to `rounded-xl border border-slate-200` (no section label needed for a single-purpose table page).

- [ ] **Step 1: Update the table container styling**

Change line 12:
```html
<div class="bg-white shadow rounded-lg overflow-hidden">
```
to:
```html
<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
```

- [ ] **Step 2: Commit**

```bash
git add src/views/pages/agent/correction-requests.njk
git commit -m "style: update table container to rounded-xl border on correction requests"
```

---

## Chunk 2: Admin Pages

### Task 4: admin/settings.njk — grouped sections

**Files:**
- Modify: `src/views/pages/admin/settings.njk`

Currently renders setting groups with `h2 + border-b` headings and no card. Wrap each group in a card with a label above.

- [ ] **Step 1: Apply the new pattern**

Replace the full content block:

```njk
<h1 class="text-2xl font-bold mb-6">{{ "System Settings" | t }}</h1>
<div class="space-y-6">
{% for group in groups %}
  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ group.label | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
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
  </section>
{% endfor %}
</div>
```

- [ ] **Step 2: Verify**

```bash
# Navigate to /admin/settings
# Confirm: each setting group has uppercase label, rows in clean card
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/settings.njk
git commit -m "style: apply flat label+card pattern to admin settings page"
```

---

### Task 5: admin/hdb.njk — Sync History section

**Files:**
- Modify: `src/views/pages/admin/hdb.njk`

Has one section group ("Sync History") with an h2 heading and no card. Apply the pattern.

- [ ] **Step 1: Apply the pattern**

Replace the full content block:

```njk
<h1 class="text-2xl font-bold mb-6">{{ "HDB Data Management" | t }}</h1>

<div class="space-y-6">

  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Manual Sync" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      {% include "partials/admin/hdb-status.njk" %}
      <div class="mt-4">
        <button
          class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm"
          hx-post="/admin/hdb/sync"
          hx-target="#sync-result"
          hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
        >{{ "Trigger Manual Sync" | t }}</button>
        <div id="sync-result" class="mt-3"></div>
      </div>
    </div>
  </section>

  <section>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Sync History" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-6">
      {% include "partials/admin/hdb-sync-history.njk" %}
    </div>
  </section>

</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/pages/admin/hdb.njk
git commit -m "style: apply flat label+card pattern to admin HDB page"
```

---

## Chunk 3: Seller Pages

### Task 6: seller/my-data.njk — 4 section cards

**Files:**
- Modify: `src/views/pages/seller/my-data.njk`

Has 4 `section.bg-white.rounded-lg.shadow` with h2 inside. Apply the pattern. Note: section 4 (Account Deletion) has a red border — keep a `border-red-200` variant on the card.

- [ ] **Step 1: Apply the pattern to all 4 sections**

Replace the content in `<div class="max-w-3xl mx-auto px-4 py-8 space-y-8">`:

```njk
<h1 class="text-2xl font-bold text-gray-900">{{ "My Data" | t }}</h1>

{% if query.consent_withdrawn %}
  <div class="rounded-lg p-4 bg-green-50 border border-green-200">
    <p class="text-sm text-green-800">{{ "Your consent has been updated." | t }}</p>
  </div>
{% endif %}

{% if query.correction_submitted %}
  <div class="rounded-lg p-4 bg-blue-50 border border-blue-200">
    <p class="text-sm text-blue-800">{{ "Correction request submitted. An agent will review it within 30 days." | t }}</p>
  </div>
{% endif %}

{# Section 1: Personal Data #}
<section>
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Personal Information We Hold" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6">
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500">{{ "Name" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.name }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Email" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.email or "—" }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Phone" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.phone }}</dd>
      </div>
      {% if seller.nricDisplay %}
      <div>
        <dt class="text-gray-500">{{ "NRIC (masked)" | t }}</dt>
        <dd class="font-medium text-gray-900 font-mono">{{ seller.nricDisplay }}</dd>
      </div>
      {% endif %}
      <div>
        <dt class="text-gray-500">{{ "Account Status" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.status }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">{{ "Member Since" | t }}</dt>
        <dd class="font-medium text-gray-900">{{ seller.createdAt | date("DD MMM YYYY") }}</dd>
      </div>
    </dl>
    <div class="mt-4">
      <a href="/seller/compliance/export"
         class="text-sm text-blue-600 hover:underline">
        {{ "Download my data (JSON)" | t }}
      </a>
    </div>
  </div>
</section>

{# Section 2: Consent Management #}
<section>
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Consent Management" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6"
       id="consent-panel"
       hx-get="/seller/my-data"
       hx-trigger="consent-updated from:body"
       hx-select="#consent-panel"
       hx-swap="outerHTML">
    {% include "partials/compliance/consent-panel.njk" %}
  </div>
</section>

{# Section 3: Correction Requests #}
<section>
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Request a Data Correction" | t }}</p>
  <div class="bg-white rounded-xl border border-slate-200 p-6">
    {% include "partials/compliance/correction-form.njk" %}
    {% if correctionRequests | length > 0 %}
      <div class="mt-6">
        {% include "partials/compliance/correction-history.njk" %}
      </div>
    {% endif %}
  </div>
</section>

{# Section 4: Account Deletion — red border variant #}
<section>
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Account Deletion" | t }}</p>
  <div class="bg-white rounded-xl border border-red-200 p-6">
    <p class="text-sm text-gray-600 mb-4">
      {{ "Requesting deletion withdraws your service consent. If you have completed transactions, data is retained for 5 years under financial regulations." | t }}
    </p>
    <button
      hx-post="/seller/compliance/consent/withdraw"
      hx-vals='{"type": "service", "channel": "web"}'
      hx-confirm="{{ 'Are you sure you want to request account deletion? This action cannot be undone.' | t }}"
      hx-target="#consent-panel"
      hx-swap="outerHTML"
      class="px-4 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-50">
      {{ "Request Account Deletion" | t }}
    </button>
  </div>
</section>
```

- [ ] **Step 2: Verify**

```bash
# Navigate to /seller/my-data
# Confirm: 4 sections with labels, Account Deletion has red border, no shadow
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/seller/my-data.njk
git commit -m "style: apply flat label+card pattern to seller my-data page"
```

---

### Task 7: seller/financial.njk — Report History sidebar card

**Files:**
- Modify: `src/views/pages/seller/financial.njk`

The sidebar has a `bg-white rounded-lg shadow p-4` card with h2 inside.

- [ ] **Step 1: Update the sidebar card**

Replace the sidebar div (lines 23–36):

```njk
  {# ── Report history sidebar ─────────────────────── #}
  <div>
    <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">{{ "Report History" | t }}</p>
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <div
        id="financial-history"
        hx-get="/seller/financial"
        hx-trigger="load"
        hx-target="#financial-history"
        hx-swap="innerHTML"
      >
        <p class="text-xs text-gray-400 text-center py-2">{{ "Loading…" | t }}</p>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/pages/seller/financial.njk
git commit -m "style: apply flat label+card pattern to seller financial page sidebar"
```

---

### Task 8: seller/settings-notifications.njk — outer card

**Files:**
- Modify: `src/views/partials/seller/settings-notifications.njk`

The outer wrapper is `bg-white border border-gray-200 rounded-lg p-6` with an `h2` inside. The inner `<fieldset class="space-y-3">` is semantic-only for radio buttons — leave it as-is.

The `hx-swap="outerHTML"` on the form targets `#settings-notifications`. Move the `id="settings-notifications"` into the partial's root element (the card div) so HTMX replaces only the partial on swap. Remove the now-redundant wrapper div from `seller/settings.njk`.

- [ ] **Step 1: Update the partial**

Replace the full partial content:

```njk
<div class="bg-white rounded-xl border border-slate-200 p-6" id="settings-notifications">
  <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{{ "Notification Preferences" | t }}</p>
  <p class="text-sm text-gray-500 mb-4">
    {{ "Choose how you receive updates. In-app notifications are always sent." | t }}
  </p>

  {% if successMessage %}
    <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
      <p class="text-sm text-green-700">{{ "Notification preference updated." | t }}</p>
    </div>
  {% endif %}

  <form hx-put="/seller/settings/notifications"
        hx-target="#settings-notifications"
        hx-swap="outerHTML">

    <fieldset class="space-y-3">
      <div class="flex items-start gap-3">
        <input type="radio"
               id="pref-whatsapp"
               name="preference"
               value="whatsapp_and_email"
               class="mt-0.5"
               {% if settings.notificationPreference == 'whatsapp_and_email' %}checked{% endif %}>
        <label for="pref-whatsapp" class="text-sm">
          <span class="font-medium text-gray-900">{{ "WhatsApp & Email" | t }}</span>
          <span class="block text-gray-500">{{ "Receive updates via WhatsApp first, with email as fallback." | t }}</span>
        </label>
      </div>

      <div class="flex items-start gap-3">
        <input type="radio"
               id="pref-email"
               name="preference"
               value="email_only"
               class="mt-0.5"
               {% if settings.notificationPreference == 'email_only' %}checked{% endif %}>
        <label for="pref-email" class="text-sm">
          <span class="font-medium text-gray-900">{{ "Email only" | t }}</span>
          <span class="block text-gray-500">{{ "Receive all notifications by email only." | t }}</span>
        </label>
      </div>
    </fieldset>

    <button type="submit"
            class="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">
      {{ "Save preference" | t }}
    </button>
  </form>
</div>
```

Important: The `id="settings-notifications"` moves to the card div (was on the page wrapper in settings.njk). Remove it from the page wrapper in settings.njk to avoid duplicate IDs:

In `src/views/pages/seller/settings.njk`, change:
```html
<div id="settings-notifications">
  {% include "partials/seller/settings-notifications.njk" %}
</div>
```
to:
```njk
{% include "partials/seller/settings-notifications.njk" %}
```

- [ ] **Step 2: Verify**

```bash
# Navigate to /seller/settings
# Confirm: notification preferences in clean card with uppercase label
# Test: change preference, confirm HTMX swap still works
```

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/seller/settings-notifications.njk src/views/pages/seller/settings.njk
git commit -m "style: apply flat label+card pattern to seller settings notifications"
```

---

### Task 9: portal-panel.njk — portal card containers

**Files:**
- Modify: `src/views/partials/agent/portal-panel.njk`

Each portal panel uses `border rounded p-4 mb-4` with an h2 inside. Update to the new card style. Portal panels are repeated items (not page-level sections), so use a card without the uppercase label — just update the card styling.

- [ ] **Step 1: Update the portal panel card styling**

Change line 4:
```html
<div class="portal-panel border rounded p-4 mb-4" id="portal-{{ portalListing.id }}">
```
to:
```html
<div class="portal-panel bg-white rounded-xl border border-slate-200 p-6 mb-4" id="portal-{{ portalListing.id }}">
```

Change line 6 (h2 portal name — this is an item title, not a section label, keep it but update weight):
```html
<h2 class="font-semibold">{{ portalLabels[portalListing.portalName] or portalListing.portalName }}</h2>
```
to:
```html
<h2 class="text-sm font-semibold text-gray-900">{{ portalLabels[portalListing.portalName] or portalListing.portalName }}</h2>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/agent/portal-panel.njk
git commit -m "style: update portal panel card to rounded-xl border pattern"
```

---

## Final Verification

- [ ] **Visual check across all 3 dashboard types**

```bash
npm run dev
# Agent: /agent/sellers/<id> — 8 sections, no fieldsets
# Agent: /agent/settings — 2 labelled sections
# Admin: /admin/settings — grouped setting cards
# Admin: /admin/hdb — Manual Sync + Sync History sections
# Seller: /seller/my-data — 4 sections, Account Deletion has red border
# Seller: /seller/financial — labelled sidebar card
# Seller: /seller/settings — notification preferences card
```

- [ ] **Run unit tests to confirm no regressions**

```bash
npm test
```
Expected: all tests pass (template changes don't affect TypeScript tests)
