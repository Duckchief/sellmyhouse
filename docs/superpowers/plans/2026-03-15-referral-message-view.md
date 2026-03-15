# Referral Message View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "View Message" button to each row of the Top Referrers table on `/admin/content/referrals` that expands an inline panel showing a pre-composed WhatsApp sharing message with a Copy button.

**Architecture:** Two file changes only. (1) `referral-top-table.njk` adds an Actions column with a toggle button and a hidden expansion row per referral containing the pre-composed message. (2) `app.js` adds a `toggle-referral-message` click handler. The route passes `baseUrl` so the message can include the full referral URL. No new routes, services, or schema changes.

**Tech Stack:** Nunjucks, vanilla JS (ES5-compatible), Tailwind CSS, existing `data-action` event delegation pattern in `public/js/app.js`

---

## File Structure

| File | Change |
|------|--------|
| `src/domains/admin/admin.router.ts` | Pass `baseUrl` in referrals render call |
| `src/views/partials/admin/referral-top-table.njk` | Add Actions column, toggle button, expansion row |
| `public/js/app.js` | Add `toggle-referral-message` click handler |

---

## Chunk 1: Referral message view

### Task 1: Pass baseUrl to the admin referrals page

**Context:** `baseUrl` is not a Nunjucks global — it must be passed per-render. The seller referral template already uses `{{ baseUrl }}` to build referral links, but the admin referrals route doesn't pass it. We need it so the expansion row can show the full referral URL.

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (around line 912 — the `res.render('pages/admin/referrals', ...)` call)

- [ ] **Step 1: Add `baseUrl` to the render call**

Find the existing render call in `admin.router.ts`:
```typescript
return res.render('pages/admin/referrals', { records, funnel, topReferrers, currentPath: '/admin/content/referrals' });
```

Replace it with:
```typescript
const baseUrl = process.env['SITE_URL'] ?? 'https://www.sellmyhomenow.sg';
return res.render('pages/admin/referrals', { records, funnel, topReferrers, baseUrl, currentPath: '/admin/content/referrals' });
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
npm test -- --testPathPatterns="admin" --silent
```
Expected: all admin tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.router.ts
git commit -m "feat: pass baseUrl to admin referrals page"
```

---

### Task 2: Update referral-top-table template with inline expand

**Context:** The current table (`src/views/partials/admin/referral-top-table.njk`) has 4 columns: Seller, Code, Clicks, Status. We add a 5th Actions column with a "View Message" button per row. Below each data `<tr>`, we insert a hidden expansion `<tr>` with `colspan="5"` containing the pre-composed message and a Copy button.

The expansion row id is `msg-{{ r.referralCode }}` — unique per row since referralCode is a unique DB field.
The textarea id is `msg-text-{{ r.referralCode }}` — used by `data-action="copy-value"` to copy its value.

**Pre-composed message text:**
```
Hi! I've been using SellMyHomeNow.sg to sell my HDB flat — it's hassle-free with a fixed fee of just $1,499. Sign up with my referral link: {{ baseUrl }}/?ref={{ r.referralCode }}
```

**Files:**
- Modify: `src/views/partials/admin/referral-top-table.njk`

- [ ] **Step 1: Replace the entire file with the new template**

```nunjucks
<h2 class="text-base font-semibold mb-3">{{ "Top Referrers" | t }}</h2>
<table class="w-full text-sm">
  <thead>
    <tr class="text-left text-gray-500 border-b">
      <th class="pb-2 pr-4">{{ "Seller" | t }}</th>
      <th class="pb-2 pr-4">{{ "Code" | t }}</th>
      <th class="pb-2 pr-4">{{ "Clicks" | t }}</th>
      <th class="pb-2 pr-4">{{ "Status" | t }}</th>
      <th class="pb-2"></th>
    </tr>
  </thead>
  <tbody>
    {% for r in topReferrers %}
    <tr class="border-b hover:bg-gray-50">
      <td class="py-2 pr-4">{{ r.referrer.name }}</td>
      <td class="py-2 pr-4 font-mono text-xs">{{ r.referralCode }}</td>
      <td class="py-2 pr-4">{{ r.clickCount }}</td>
      <td class="py-2 pr-4 text-xs text-gray-500">{{ r.status | replace('_', ' ') }}</td>
      <td class="py-2 text-right">
        <button
          data-action="toggle-referral-message"
          data-target="msg-{{ r.referralCode }}"
          class="text-accent text-xs hover:underline">
          {{ "View Message" | t }}
        </button>
      </td>
    </tr>
    <tr id="msg-{{ r.referralCode }}" class="hidden bg-gray-50 border-b">
      <td colspan="5" class="px-4 py-3">
        <p class="text-xs text-gray-500 mb-2">{{ "Pre-composed sharing message" | t }}</p>
        <textarea
          id="msg-text-{{ r.referralCode }}"
          readonly
          rows="3"
          class="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 bg-white resize-none font-mono">Hi! I've been using SellMyHomeNow.sg to sell my HDB flat — it's hassle-free with a fixed fee of just $1,499. Sign up with my referral link: {{ baseUrl }}/?ref={{ r.referralCode }}</textarea>
        <button
          data-action="copy-value"
          data-source="msg-text-{{ r.referralCode }}"
          class="mt-2 bg-accent text-white text-xs px-3 py-1 rounded hover:bg-accent/90">
          {{ "Copy Message" | t }}
        </button>
      </td>
    </tr>
    {% endfor %}
  </tbody>
</table>
```

- [ ] **Step 2: Verify template renders (TypeScript not applicable — visual check)**

Start the dev server if not running:
```bash
npm run dev
```

Navigate to `http://localhost:3000/admin/content/referrals` and confirm:
- The table now has a 5th empty-header column
- Each row has a "View Message" button on the right
- Clicking "View Message" does nothing yet (JS not added yet — that's Task 3)

- [ ] **Step 3: Commit template change**

```bash
git add src/views/partials/admin/referral-top-table.njk
git commit -m "feat: add referral message expand row to top referrers table"
```

---

### Task 3: Add toggle-referral-message handler to app.js

**Context:** `public/js/app.js` uses an event delegation pattern: a single `document.addEventListener('click', ...)` handles all `data-action` buttons. We add a new `toggle-referral-message` case to this handler.

The handler:
1. Finds the expansion row by `el.dataset.target` (e.g. `"msg-CODEABC"`)
2. Toggles `hidden` class on the row
3. Updates button text: hidden→visible = "Hide", visible→hidden = "View Message"

**Files:**
- Modify: `public/js/app.js` (inside the existing `document.addEventListener('click', ...)` block, after the last `if (action === ...)` block, before the closing `}`  of the listener)

- [ ] **Step 1: Add the handler inside the click delegation block**

Find the existing handler that ends the click delegation (around line 129):
```javascript
    // Toggle mobile sidebar open/closed
    if (action === 'toggle-sidebar') {
      ...
    }
  });
```

Add the new handler just before the closing `});`:
```javascript
    // Referral table: toggle the pre-composed message expansion row
    if (action === 'toggle-referral-message') {
      var msgRow = document.getElementById(el.dataset.target);
      if (msgRow) {
        var isHidden = msgRow.classList.toggle('hidden');
        el.textContent = isHidden ? 'View Message' : 'Hide';
      }
    }
```

The result at that location should look like:
```javascript
    // Toggle mobile sidebar open/closed
    if (action === 'toggle-sidebar') {
      var sidebar = document.getElementById('sidebar');
      var backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar && backdrop) {
        var isOpen = !sidebar.classList.contains('hidden') && window.innerWidth < 768;
        if (isOpen) {
          sidebar.classList.add('hidden');
          backdrop.classList.add('hidden');
        } else {
          sidebar.classList.remove('hidden');
          backdrop.classList.remove('hidden');
        }
      }
    }

    // Referral table: toggle the pre-composed message expansion row
    if (action === 'toggle-referral-message') {
      var msgRow = document.getElementById(el.dataset.target);
      if (msgRow) {
        var isHidden = msgRow.classList.toggle('hidden');
        el.textContent = isHidden ? 'View Message' : 'Hide';
      }
    }
  });
```

- [ ] **Step 2: Verify toggle works in browser**

Navigate to `http://localhost:3000/admin/content/referrals`:
- Click "View Message" on any row — expansion row appears, button text changes to "Hide"
- Click "Hide" — expansion row collapses, button text returns to "View Message"
- "Copy Message" button copies the text to clipboard

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test --silent
```
Expected: all tests pass (no TS or runtime regressions from the JS change).

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add referral message toggle handler to app.js"
```
