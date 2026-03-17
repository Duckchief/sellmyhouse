# Agent Sidebar Style Alignment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `agent.njk` sidebar styling with `admin.njk` — active state accent, text size, flex layout, sign-out footer, and main overflow.

**Architecture:** Single-file template edit. No logic changes, no new routes, no tests required (pure markup/CSS class alignment). Verification is visual diff against admin.njk.

**Tech Stack:** Nunjucks templates, Tailwind CSS utility classes.

**Spec:** `docs/superpowers/specs/2026-03-17-agent-sidebar-style-alignment.md`

---

## Chunk 1: Edit agent.njk

**Files:**
- Modify: `src/views/layouts/agent.njk`

Reference the current admin sidebar at `src/views/layouts/admin.njk` as the source of truth for all class patterns.

---

### Task 1: Fix active state on all nav links

- [ ] **Step 1: Open agent.njk and locate all active-state conditionals**

  Each nav link has a pattern like:
  ```
  {% if currentPath == '/agent/...' %}bg-white/10{% endif %}
  ```

- [ ] **Step 2: Update each conditional to match admin active state**

  Change every active state from:
  ```
  {% if currentPath == '/agent/...' %}bg-white/10{% endif %}
  ```
  to:
  ```
  {% if currentPath == '/agent/...' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}
  ```

  **Important:** The admin pattern moves `hover:bg-white/10` into the `{% else %}` branch — copy this exactly. There are 5 links to update: dashboard, leads, sellers, reviews, settings.

- [ ] **Step 3: Verify the file — confirm all 5 links now have the full active pattern**

---

### Task 2: Add text-sm to all nav links

- [ ] **Step 1: Add `text-sm` to every nav link `<a>` tag**

  Every `<a>` in `<nav>` should include `text-sm` in its class list. Example:
  ```html
  <a href="/agent/dashboard" class="flex items-center gap-2 px-3 py-2 rounded text-sm ...">
  ```

  Links to update: dashboard, leads, sellers, reviews, settings.

---

### Task 3: Add flex-1 to nav

- [ ] **Step 1: Update the `<nav>` opening tag**

  Change:
  ```html
  <nav class="space-y-1">
  ```
  to:
  ```html
  <nav class="space-y-1 flex-1">
  ```

---

### Task 4: Add sign-out footer

- [ ] **Step 1: Add the footer block inside `<aside>` after `</nav>`**

  ```html
  <div class="mt-auto pt-4 border-t border-white/10">
    <a href="/auth/logout" class="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300">{{ icon('arrow-right-on-rectangle') }}{{ "Sign Out" | t }}</a>
  </div>
  ```

  This must go between `</nav>` and `</aside>`.

---

### Task 5: Add overflow-auto to main

- [ ] **Step 1: Update the `<main>` tag**

  Change:
  ```html
  <main class="flex-1 pt-16 md:pt-8 p-8 bg-bg">
  ```
  to:
  ```html
  <main class="flex-1 pt-16 md:pt-8 p-8 bg-bg overflow-auto">
  ```

---

### Task 6: Inline icon + label formatting (cosmetic)

- [ ] **Step 1: Collapse multi-line icon+label to single line per link**

  Current agent.njk has icons and labels on separate lines, e.g.:
  ```html
  <a href="/agent/dashboard" ...>
    {{ icon('home') }}
    {{ "Dashboard" | t }}
  </a>
  ```

  Change to single-line per admin pattern:
  ```html
  <a href="/agent/dashboard" ...>{{ icon('home') }}{{ "Dashboard" | t }}</a>
  ```

  Apply to all 5 nav links.

---

### Task 7: Final review and commit

- [ ] **Step 1: Diff agent.njk against admin.njk to verify structural parity**

  Side-by-side check:
  - `<aside>` classes match
  - `<nav>` has `space-y-1 flex-1`
  - All links: `flex items-center gap-2 px-3 py-2 rounded text-sm`
  - Active state: `bg-white/10 text-accent border-l-2 border-accent`
  - Inactive hover: `hover:bg-white/10`
  - Sign-out footer present with `mt-auto`
  - `<main>` has `overflow-auto`

- [ ] **Step 2: Run lint**

  ```bash
  npm run lint
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/layouts/agent.njk
  git commit -m "style(agent): align sidebar with admin — active state, text-sm, sign-out footer"
  ```
