# Agent Sellers Search Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken search on `/agent/sellers` by replacing the non-functional HTMX `from:find` trigger pattern with a submit-button approach, and fix pagination to preserve filter state.

**Architecture:** Two template-only changes — update the filter form to use `hx-trigger="submit"` with a Search button (matching the working admin pattern), and add `hx-include="#seller-filter-form"` to pagination links so filter state is preserved across pages. No backend changes required.

**Tech Stack:** Nunjucks templates, HTMX 2.0.4

**Spec:** `docs/superpowers/specs/2026-03-17-agent-sellers-search-fix-design.md`

---

## Chunk 1: Fix the filter form and pagination

### Task 1: Fix the filter form in sellers.njk

**Files:**
- Modify: `src/views/pages/agent/sellers.njk`

Reference: `src/views/pages/admin/sellers.njk` — the working pattern to match.

Current broken form (line 7):
```html
<form hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="change, keyup changed delay:300ms from:find input[name=search]" class="flex gap-3 mb-6 flex-wrap">
```

- [ ] **Step 1: Update the form element** — add `id`, fix `hx-trigger`

In `src/views/pages/agent/sellers.njk`, replace line 7:
```html
<form hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="change, keyup changed delay:300ms from:find input[name=search]" class="flex gap-3 mb-6 flex-wrap">
```
with:
```html
<form id="seller-filter-form" hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="submit" class="flex gap-3 mb-6 flex-wrap">
```

- [ ] **Step 2: Add a Search button** — add before the closing `</form>` tag (after the `town` input on line 17):
```html
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Search" | t }}</button>
```

The file should now look like:
```html
{% extends "layouts/agent.njk" %}

{% block content %}
{% set pageTitle = "Sellers" %}
{% include "partials/shared/page-header.njk" %}

<form id="seller-filter-form" hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="submit" class="flex gap-3 mb-6 flex-wrap">
  <select name="status" class="border rounded px-3 py-2 text-sm">
    <option value="">{{ "All Statuses" | t }}</option>
    <option value="lead">{{ "Lead" | t }}</option>
    <option value="engaged">{{ "Engaged" | t }}</option>
    <option value="active">{{ "Active" | t }}</option>
    <option value="completed">{{ "Completed" | t }}</option>
    <option value="archived">{{ "Archived" | t }}</option>
  </select>
  <input type="text" name="search" placeholder="{{ 'Search name, email, phone...' | t }}" class="border rounded px-3 py-2 text-sm w-64" />
  <input type="text" name="town" placeholder="{{ 'Town' | t }}" class="border rounded px-3 py-2 text-sm w-40" />
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Search" | t }}</button>
</form>

<div id="seller-list" hx-get="/agent/sellers" hx-trigger="load" hx-swap="innerHTML" hx-headers='{"HX-Request": "true"}'>
  <div class="text-gray-500">{{ "Loading..." | t }}</div>
</div>
{% endblock %}
```

- [ ] **Step 3: Verify the dev server renders correctly**

Run: `npm run dev` and visit `/agent/sellers` as an agent. Confirm:
- Search button is visible
- Typing in the search field and clicking Search updates the list
- Status dropdown + Search works
- Town field + Search works

---

### Task 2: Fix pagination to preserve filter state

**Files:**
- Modify: `src/views/partials/agent/seller-list.njk:68-77`

Current broken pagination (lines 69-76) — drops all filter params:
```html
{% for p in range(1, result.totalPages + 1) %}
<a href="?page={{ p }}" hx-get="/agent/sellers?page={{ p }}" hx-target="#seller-list"
   class="px-3 py-1 rounded text-sm {% if p == result.page %}bg-blue-600 text-white{% else %}bg-gray-200 hover:bg-gray-300{% endif %}">
  {{ p }}
</a>
{% endfor %}
```

- [ ] **Step 4: Add `hx-include` to pagination links**

In `src/views/partials/agent/seller-list.njk`, replace the `<a>` inside the pagination loop:
```html
<a href="?page={{ p }}" hx-get="/agent/sellers?page={{ p }}" hx-target="#seller-list"
   class="...">
```
with:
```html
<a href="?page={{ p }}" hx-get="/agent/sellers?page={{ p }}" hx-target="#seller-list"
   hx-include="#seller-filter-form"
   class="px-3 py-1 rounded text-sm {% if p == result.page %}bg-blue-600 text-white{% else %}bg-gray-200 hover:bg-gray-300{% endif %}">
```

- [ ] **Step 5: Verify pagination preserves filter state**

With `npm run dev`, on `/agent/sellers`:
1. Search for a term that returns multiple pages of results
2. Click page 2 — confirm the search term is preserved in the results

---

### Task 3: Commit

- [ ] **Step 6: Run lint**

```bash
npm run lint
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/views/pages/agent/sellers.njk src/views/partials/agent/seller-list.njk
git commit -m "fix: agent sellers search — use submit trigger, fix pagination filter state"
```
