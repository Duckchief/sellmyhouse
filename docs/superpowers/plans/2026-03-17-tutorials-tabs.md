# Video Tutorials Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/admin/tutorials` to show tutorials in underline tabs (one per category) with URL-based tab switching via HTMX.

**Architecture:** The `GET /admin/tutorials` route reads `?tab=` (defaulting to `photography`), computes per-tab counts from the grouped result, and passes `activeTab` + `tabCounts` to the template. The tab bar lives in `tutorials.njk`; the list partial renders only the active category. HTMX tab clicks swap `#tutorial-list` only and push the URL.

**Tech Stack:** Express + Nunjucks + HTMX + TypeScript + Jest

---

## Chunk 1: Router — parse tab param and pass counts

### Task 1: Write failing router tests for tab behaviour

**Files:**
- Modify: `src/domains/admin/__tests__/admin.router.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the entire file content with:

```typescript
// src/domains/admin/__tests__/admin.router.test.ts
import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import { adminRouter } from '../admin.router';
import * as contentService from '../../content/content.service';

jest.mock('../../content/content.service');

const mockTutorials = {
  photography: [
    { id: '1', title: 'Photo A', slug: 'photo-a', orderIndex: 1, category: 'photography', youtubeUrl: 'https://youtube.com/1' },
    { id: '2', title: 'Photo B', slug: 'photo-b', orderIndex: 2, category: 'photography', youtubeUrl: 'https://youtube.com/2' },
  ],
  forms: [
    { id: '3', title: 'Form A', slug: 'form-a', orderIndex: 1, category: 'forms', youtubeUrl: 'https://youtube.com/3' },
  ],
  process: [],
  financial: [],
};

function makeApp() {
  const app = express();
  nunjucks.configure('src/views', { autoescape: true, express: app });
  app.use(
    (req, _res, next) => {
      // Bypass auth for tests
      (req as any).session = { adminUser: { id: 'admin-1', role: 'admin' } };
      next();
    },
  );
  app.use(adminRouter);
  return app;
}

describe('GET /admin/tutorials — tab param', () => {
  beforeEach(() => {
    jest.mocked(contentService.getTutorialsGrouped).mockResolvedValue(mockTutorials as any);
  });

  it('defaults activeTab to photography when no tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials');
    expect(res.status).toBe(200);
  });

  it('accepts a valid tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials?tab=forms');
    expect(res.status).toBe(200);
  });

  it('falls back to photography for an invalid tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials?tab=invalid');
    expect(res.status).toBe(200);
  });

  it('returns partial for HTMX request', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/admin/tutorials?tab=forms')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/admin/__tests__/admin.router.test.ts --no-coverage
```

Expected: Some tests fail because the router does not yet pass `activeTab`/`tabCounts`.

---

### Task 2: Update the router to pass `activeTab` and `tabCounts`

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (lines ~657–671)

- [ ] **Step 1: Update the GET /admin/tutorials handler**

Find this block in `admin.router.ts`:

```typescript
adminRouter.get(
  '/admin/tutorials',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorials = await contentService.getTutorialsGrouped();
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-list', { tutorials });
      }
      return res.render('pages/admin/tutorials', { tutorials, currentPath: '/admin/tutorials' });
    } catch (err) {
      return next(err);
    }
  },
);
```

Replace it with:

```typescript
const VALID_TUTORIAL_TABS = ['photography', 'forms', 'process', 'financial'] as const;
type TutorialTab = (typeof VALID_TUTORIAL_TABS)[number];

adminRouter.get(
  '/admin/tutorials',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorials = await contentService.getTutorialsGrouped();
      const rawTab = req.query['tab'] as string | undefined;
      const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
        ? (rawTab as TutorialTab)
        : 'photography';
      const tabCounts: Record<TutorialTab, number> = {
        photography: (tutorials['photography'] ?? []).length,
        forms: (tutorials['forms'] ?? []).length,
        process: (tutorials['process'] ?? []).length,
        financial: (tutorials['financial'] ?? []).length,
      };
      const activeItems = tutorials[activeTab] ?? [];
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      return res.render('pages/admin/tutorials', {
        tutorials: activeItems,
        activeTab,
        tabCounts,
        currentPath: '/admin/tutorials',
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 2: Run tests**

```bash
npx jest src/domains/admin/__tests__/admin.router.test.ts --no-coverage
```

Expected: All 4 tests pass.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: All previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: tutorials route passes activeTab and tabCounts"
```

---

## Chunk 2: Views — tab bar, list partial, row reorder, form pre-select

### Task 3: Update tutorial-list.njk to show only the active category

**Files:**
- Modify: `src/views/partials/admin/tutorial-list.njk`

The partial now receives `tutorials` as a flat array (the active category's items) and `activeTab`.

- [ ] **Step 1: Replace the partial content**

```nunjucks
{% if tutorials | length == 0 %}
<p class="text-gray-500 text-sm">{{ "No tutorials in this category yet." | t }}</p>
{% else %}
<table class="w-full text-sm">
  <thead>
    <tr class="text-left text-gray-500 border-b">
      <th class="pb-2 pr-4">{{ "Order" | t }}</th>
      <th class="pb-2 pr-4">{{ "Title" | t }}</th>
      <th class="pb-2 pr-4">{{ "Slug" | t }}</th>
      <th class="pb-2"></th>
    </tr>
  </thead>
  <tbody>
    {% for tutorial in tutorials %}
    {% include "partials/admin/tutorial-row.njk" %}
    {% endfor %}
  </tbody>
</table>
<p class="mt-1 text-xs text-gray-500">{{ tutorials | length }} {{ "tutorials" | t }}</p>
{% endif %}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass (no server-side logic changed, just template structure).

---

### Task 4: Update tutorial-row.njk to preserve active tab on reorder

**Files:**
- Modify: `src/views/partials/admin/tutorial-row.njk`

Reorder forms must include `activeTab` in the HTMX request so the list re-renders the correct category after reordering.

- [ ] **Step 1: Update reorder forms to include tab param**

Replace the entire file content:

```nunjucks
<tr class="border-b last:border-0 hover:bg-gray-50" id="tutorial-row-{{ tutorial.id }}">
  <td class="py-2 pr-4 text-gray-500">{{ tutorial.orderIndex }}</td>
  <td class="py-2 pr-4 font-medium">{{ tutorial.title }}</td>
  <td class="py-2 pr-4 text-gray-500 font-mono text-xs">{{ tutorial.slug }}</td>
  <td class="py-2 text-right space-x-2">
    <form method="POST" action="/admin/tutorials/reorder?tab={{ activeTab }}" class="inline"
          hx-post="/admin/tutorials/reorder?tab={{ activeTab }}" hx-target="#tutorial-list" hx-swap="innerHTML">
      <input type="hidden" name="items[0][id]" value="{{ tutorial.id }}">
      <input type="hidden" name="items[0][orderIndex]" value="{{ tutorial.orderIndex - 1 }}">
      <button type="submit" class="text-gray-400 hover:text-gray-600 px-1" aria-label="{{ 'Move up' | t }}">↑</button>
    </form>
    <form method="POST" action="/admin/tutorials/reorder?tab={{ activeTab }}" class="inline"
          hx-post="/admin/tutorials/reorder?tab={{ activeTab }}" hx-target="#tutorial-list" hx-swap="innerHTML">
      <input type="hidden" name="items[0][id]" value="{{ tutorial.id }}">
      <input type="hidden" name="items[0][orderIndex]" value="{{ tutorial.orderIndex + 1 }}">
      <button type="submit" class="text-gray-400 hover:text-gray-600 px-1" aria-label="{{ 'Move down' | t }}">↓</button>
    </form>
    <a href="/admin/tutorials/{{ tutorial.id }}/edit" class="text-indigo-600 hover:underline text-xs">{{ "Edit" | t }}</a>
    <form method="POST" action="/admin/tutorials/{{ tutorial.id }}/delete" class="inline"
          data-action="confirm-submit" data-message="{{ 'Delete this tutorial?' | t }}">
      <button type="submit" class="text-red-500 hover:underline text-xs">{{ "Delete" | t }}</button>
    </form>
  </td>
</tr>
```

The only change: `hx-post` URL gains `?tab={{ activeTab }}` so the reorder response re-renders the correct category.

Also update the reorder route handler in `admin.router.ts` to pass `activeTab` + `activeItems` when responding to HTMX:

Find this block (around line 637):

```typescript
adminRouter.post(
  '/admin/tutorials/reorder',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      ...
      if (req.headers['hx-request']) {
        return res.status(200).send('');
      }
      return res.redirect('/admin/tutorials');
```

Replace the HTMX branch:

```typescript
      if (req.headers['hx-request']) {
        const tutorials = await contentService.getTutorialsGrouped();
        const rawTab = req.query['tab'] as string | undefined;
        const TABS = ['photography', 'forms', 'process', 'financial'] as const;
        type Tab = (typeof TABS)[number];
        const activeTab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'photography';
        const activeItems = tutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/tutorial-list.njk src/views/partials/admin/tutorial-row.njk src/domains/admin/admin.router.ts
git commit -m "feat: tutorial-list partial shows active tab only; reorder preserves tab"
```

---

### Task 5: Update tutorials.njk — add tab bar

**Files:**
- Modify: `src/views/pages/admin/tutorials.njk`

- [ ] **Step 1: Replace the page content**

```nunjucks
{% extends "layouts/admin.njk" %}

{% block title %}{{ "Video Tutorials" | t }} — Admin{% endblock %}

{% block content %}
{% set pageTitle = "Video Tutorials" %}
{% set pageActionsHtml %}
<a href="/admin/tutorials/new?category={{ activeTab }}" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700">
  {{ "+ Add Tutorial" | t }}
</a>
{% endset %}
{% include "partials/shared/page-header.njk" %}

{% set tabs = [
  { key: 'photography', label: 'Photography' },
  { key: 'forms',       label: 'Forms' },
  { key: 'process',     label: 'Process' },
  { key: 'financial',   label: 'Financial' }
] %}

<div class="flex border-b border-gray-200 mb-4 text-sm overflow-x-auto">
  {% for tab in tabs %}
  <a href="/admin/tutorials?tab={{ tab.key }}"
     hx-get="/admin/tutorials?tab={{ tab.key }}"
     hx-target="#tutorial-list"
     hx-swap="innerHTML"
     hx-push-url="true"
     class="px-4 py-2 whitespace-nowrap font-medium border-b-2 -mb-px
       {% if activeTab == tab.key %}
         border-indigo-600 text-indigo-600
       {% else %}
         border-transparent text-gray-500 hover:text-gray-700
       {% endif %}">
    {{ tab.label | t }}
    {% if tabCounts[tab.key] is defined %}
    <span class="ml-1.5 text-xs rounded-full px-1.5 py-0.5
      {% if activeTab == tab.key %}bg-indigo-100 text-indigo-700{% else %}bg-gray-100 text-gray-500{% endif %}">
      {{ tabCounts[tab.key] }}
    </span>
    {% endif %}
  </a>
  {% endfor %}
</div>

<div id="tutorial-list">
  {% include "partials/admin/tutorial-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/tutorials.njk
git commit -m "feat: tutorials page tab bar with underline style and count badges"
```

---

### Task 6: Update tutorial-form.njk — pre-select category from query param

**Files:**
- Modify: `src/views/pages/admin/tutorial-form.njk`

When navigating from the `+ Add Tutorial` button (e.g. `/admin/tutorials/new?category=forms`), the category dropdown should be pre-selected. The router already passes `req.query` context through — we just need the template to read `category` from the query string.

- [ ] **Step 1: Update the GET /admin/tutorials/new route to pass preselectedCategory**

In `admin.router.ts`, find the `GET /admin/tutorials/new` handler:

```typescript
adminRouter.get(
  '/admin/tutorials/new',
  ...adminAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      return res.render('pages/admin/tutorial-form', {
        tutorial: null,
        errors: [],
        currentPath: '/admin/tutorials',
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

Replace with:

```typescript
adminRouter.get(
  '/admin/tutorials/new',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_CATEGORIES = ['photography', 'forms', 'process', 'financial'];
      const rawCategory = req.query['category'] as string | undefined;
      const preselectedCategory = VALID_CATEGORIES.includes(rawCategory ?? '') ? rawCategory : '';
      return res.render('pages/admin/tutorial-form', {
        tutorial: null,
        errors: [],
        preselectedCategory,
        currentPath: '/admin/tutorials',
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 2: Update tutorial-form.njk category select to use preselectedCategory**

Find the category `<select>` block in `src/views/pages/admin/tutorial-form.njk`:

```nunjucks
      {% set currentCategory = values.category if values.category else (tutorial.category if tutorial else '') %}
```

Replace with:

```nunjucks
      {% set currentCategory = values.category if values.category else (tutorial.category if tutorial else preselectedCategory) %}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.router.ts src/views/pages/admin/tutorial-form.njk
git commit -m "feat: pre-select category on new tutorial form when ?category= param present"
```

---

## Chunk 3: Final verification

### Task 7: Smoke test in browser

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify tab switching**

Navigate to `http://localhost:3000/admin/tutorials`. Verify:
- Default tab is Photography with indigo underline
- Clicking Forms tab updates `#tutorial-list` via HTMX and URL changes to `?tab=forms`
- Count badges are correct per category
- Direct URL `http://localhost:3000/admin/tutorials?tab=financial` loads with Financial tab active
- Invalid URL `http://localhost:3000/admin/tutorials?tab=bogus` falls back to Photography

- [ ] **Step 3: Verify reorder preserves tab**

On Photography tab, click ↑ or ↓. Confirm:
- Table re-renders with reordered items
- Still showing Photography tab content (not switched to another category)

- [ ] **Step 4: Verify Add Tutorial button pre-selects category**

Click `+ Add Tutorial` from the Forms tab. Confirm:
- URL is `/admin/tutorials/new?category=forms`
- Category dropdown defaults to "Forms"

- [ ] **Step 5: Run full test suite one final time**

```bash
npm test -- --no-coverage
```

Expected: All tests pass, no regressions.

- [ ] **Step 6: Final commit if any fixups needed**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts \
        src/views/pages/admin/tutorials.njk src/views/partials/admin/tutorial-list.njk \
        src/views/partials/admin/tutorial-row.njk src/views/pages/admin/tutorial-form.njk
git commit -m "fix: tutorials tab smoke test fixups"
```
