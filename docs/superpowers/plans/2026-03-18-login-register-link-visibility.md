# Login Register Link Visibility — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the "Don't have an account? Register" link when the Agent tab is active on `/auth/login`.

**Architecture:** Move the register link `<p>` element inside `#seller-form` in `login.njk`. The existing `switch-tab` JS in `app.js` already toggles `hidden` on `#seller-form`, so the link hides for free with zero JS changes.

**Tech Stack:** Nunjucks templates, Tailwind CSS, existing `app.js` tab logic.

**Spec:** `docs/superpowers/specs/2026-03-18-login-register-link-visibility.md`

---

## Chunk 1: Move register link inside seller form

### Task 1: Update `login.njk`

**Files:**
- Modify: `src/views/pages/auth/login.njk:30-56` (seller form div) and lines 86-89 (register link)

**Context:** The register link `<p>` currently sits after both `#seller-form` and `#agent-form`. Moving it inside `#seller-form` makes it a child of that container — the existing `hidden` class toggling in `app.js` will hide/show it automatically.

- [ ] **Step 1: Make the change**

In `src/views/pages/auth/login.njk`, move the register link paragraph from outside both forms into the bottom of `#seller-form`.

The `#seller-form` div should go from:

```njk
  <div id="seller-form">
    <form
      hx-post="/auth/login/seller"
      hx-target="#seller-messages"
      hx-swap="innerHTML"
      class="space-y-4"
    >
      ...
      <button type="submit" ...>
        {{ "Log In as Seller" | t }}
      </button>
    </form>
  </div>

  <div id="agent-form" class="hidden">
    ...
  </div>

  <p class="mt-4 text-center text-sm text-gray-600">
    {{ "Don't have an account?" | t }}
    <a href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">{{ "Register" | t }}</a>
  </p>
```

To:

```njk
  <div id="seller-form">
    <form
      hx-post="/auth/login/seller"
      hx-target="#seller-messages"
      hx-swap="innerHTML"
      class="space-y-4"
    >
      ...
      <button type="submit" ...>
        {{ "Log In as Seller" | t }}
      </button>
    </form>

    <p class="mt-4 text-center text-sm text-gray-600">
      {{ "Don't have an account?" | t }}
      <a href="/auth/register" class="font-medium text-indigo-600 hover:text-indigo-500">{{ "Register" | t }}</a>
    </p>
  </div>

  <div id="agent-form" class="hidden">
    ...
  </div>
```

- [ ] **Step 2: Verify in browser**

Start the dev server:
```bash
npm run dev
```

Navigate to `http://localhost:3000/auth/login`.

Check:
- Seller tab active (default): register link is visible below the form
- Click Agent tab: register link disappears
- Click back to Seller tab: register link reappears

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/auth/login.njk
git commit -m "fix(auth): hide register link when agent tab is active"
```
