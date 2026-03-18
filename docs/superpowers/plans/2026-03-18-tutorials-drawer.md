# Tutorials Admin Drawer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side slide-in drawer to `/admin/tutorials` so row clicks open an inline edit form and the "New Tutorial" button opens an inline create form — mirroring the existing testimonials drawer pattern.

**Architecture:** A single new Nunjucks partial (`tutorial-form-drawer.njk`) handles both create and edit. Two new router branches on existing GET routes serve the partial as an HTMX fragment. Existing POST handlers get HTMX branches that return list or drawer fragments instead of redirects/full pages. JavaScript handlers in `app.js` manage drawer show/hide via CSS class toggling, exactly as the testimonials drawer does.

**Tech Stack:** Nunjucks templates, HTMX, Tailwind CSS, Express.js (TypeScript), Jest + Supertest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/views/partials/admin/tutorial-form-drawer.njk` | Drawer UI: header, close button, form with all fields, slug auto-gen script |
| Modify | `src/views/pages/admin/tutorials.njk` | Add drawer scaffold (backdrop + panel); change "Add Tutorial" button to HTMX |
| Modify | `src/views/partials/admin/tutorial-row.njk` | Add `data-action` + `data-tutorial-url` to `<tr>`; add `no-row-click` to reorder/delete forms |
| Modify | `src/domains/admin/admin.router.ts` | Add HTMX branch to `GET /admin/tutorials/new`; add `GET /admin/tutorials/:id/drawer`; add HTMX branches to both POST handlers |
| Modify | `public/js/app.js` | Add `close-tutorial-drawer`, `open-tutorial-drawer` click handlers + `htmx:afterRequest` listener |
| Modify | `src/domains/admin/__tests__/admin.router.test.ts` | Tests for new HTMX routes and POST fragment responses |

---

## Chunk 1: Partial + View + JS Changes

### Task 1: Create `tutorial-form-drawer.njk`

**Files:**
- Create: `src/views/partials/admin/tutorial-form-drawer.njk`

- [ ] **Step 1: Create the partial**

```nunjucks
{#
  tutorial-form-drawer.njk
  Slide-in drawer form for creating or editing a tutorial.
  New:  GET /admin/tutorials/new (hx-request) → loaded into #tutorial-drawer-content
  Edit: GET /admin/tutorials/:id/drawer      → loaded into #tutorial-drawer-content
  On success POST: server renders partials/admin/tutorial-list into #tutorial-list
#}
<div class="p-6 flex flex-col gap-4 min-h-full">

  <div class="flex items-center justify-between mb-2">
    <h2 class="text-lg font-semibold text-gray-900">
      {% if tutorial %}{{ "Edit Tutorial" | t }}{% else %}{{ "New Tutorial" | t }}{% endif %}
    </h2>
    <button
      type="button"
      data-action="close-tutorial-drawer"
      aria-label="{{ 'Close' | t }}"
      class="text-gray-400 hover:text-gray-600 p-1 rounded">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>

  {% if errors | length %}
  <div class="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
    <ul class="list-disc list-inside space-y-1">
      {% for err in errors %}
      <li>{{ err.msg }}</li>
      {% endfor %}
    </ul>
  </div>
  {% endif %}

  <form
    hx-post="{% if tutorial %}/admin/tutorials/{{ tutorial.id }}{% else %}/admin/tutorials{% endif %}"
    hx-target="#tutorial-list"
    hx-swap="innerHTML"
    class="flex flex-col gap-4">

    {# Pass active tab so POST handler knows which list to render on success #}
    <input type="hidden" name="activeTab" value="{{ activeTab }}">

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-title">
        {{ "Title" | t }} *
      </label>
      <input
        type="text"
        id="drawer-title"
        name="title"
        required
        value="{{ values.title if values else (tutorial.title if tutorial else '') }}"
        class="input-field w-full"
        oninput="tutorialDrawerUpdateSlug(this.value)">
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-slug">
        {{ "Slug" | t }}
      </label>
      <input
        type="text"
        id="drawer-slug"
        name="slug"
        value="{{ values.slug if values else (tutorial.slug if tutorial else '') }}"
        placeholder="{{ 'Auto-generated from title if blank' | t }}"
        class="input-field w-full font-mono text-xs">
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-youtubeUrl">
        {{ "YouTube URL" | t }} *
      </label>
      <input
        type="url"
        id="drawer-youtubeUrl"
        name="youtubeUrl"
        required
        value="{{ values.youtubeUrl if values else (tutorial.youtubeUrl if tutorial else '') }}"
        placeholder="https://www.youtube.com/watch?v=..."
        class="input-field w-full">
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-category">
        {{ "Category" | t }} *
      </label>
      {% set currentCategory = values.category if values else (tutorial.category if tutorial else activeTab) %}
      <select
        id="drawer-category"
        name="category"
        required
        class="input-field w-full">
        <option value="">{{ "Select category..." | t }}</option>
        <option value="photography" {% if currentCategory == 'photography' %}selected{% endif %}>{{ "Photography" | t }}</option>
        <option value="forms" {% if currentCategory == 'forms' %}selected{% endif %}>{{ "Forms" | t }}</option>
        <option value="process" {% if currentCategory == 'process' %}selected{% endif %}>{{ "Process" | t }}</option>
        <option value="financial" {% if currentCategory == 'financial' %}selected{% endif %}>{{ "Financial" | t }}</option>
      </select>
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-description">
        {{ "Description" | t }}
        <span class="text-gray-400 normal-case font-normal ml-1">{{ "(optional)" | t }}</span>
      </label>
      <textarea
        id="drawer-description"
        name="description"
        rows="3"
        class="input-field w-full resize-y">{{ values.description if values else (tutorial.description if tutorial else '') }}</textarea>
    </div>

    <div class="flex gap-2 pt-2">
      <button type="submit" class="btn-primary flex-1">
        {% if tutorial %}{{ "Save Changes" | t }}{% else %}{{ "Create Tutorial" | t }}{% endif %}
      </button>
      <button
        type="button"
        data-action="close-tutorial-drawer"
        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
        {{ "Cancel" | t }}
      </button>
    </div>
  </form>

  <script nonce="{{ cspNonce }}">
    (function () {
      var slugManuallyEdited = {{ 'true' if (tutorial and tutorial.slug) else 'false' }};

      function tutorialDrawerUpdateSlug(title) {
        if (slugManuallyEdited) return;
        var slug = title.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        document.getElementById('drawer-slug').value = slug;
      }

      var slugInput = document.getElementById('drawer-slug');
      if (slugInput) {
        slugInput.addEventListener('input', function () {
          slugManuallyEdited = true;
        });
      }

      window.tutorialDrawerUpdateSlug = tutorialDrawerUpdateSlug;
    })();
  </script>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/admin/tutorial-form-drawer.njk
git commit -m "feat: add tutorial-form-drawer partial"
```

---

### Task 2: Update `tutorials.njk` — add drawer scaffold + change button

**Files:**
- Modify: `src/views/pages/admin/tutorials.njk`

- [ ] **Step 1: Replace the "Add Tutorial" link with an HTMX button**

Find:
```nunjucks
<a href="/admin/tutorials/new?category={{ activeTab }}" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700">
  {{ "+ Add Tutorial" | t }}
</a>
```

Replace with:
```nunjucks
<button
  hx-get="/admin/tutorials/new?category={{ activeTab }}"
  hx-target="#tutorial-drawer-content"
  hx-swap="innerHTML"
  class="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700">
  {{ "+ Add Tutorial" | t }}
</button>
```

- [ ] **Step 2: Add drawer scaffold before `{% endblock %}`**

Find:
```nunjucks
<script nonce="{{ cspNonce }}">
  document.addEventListener('htmx:afterSwap', function (e) {
```

Insert the following BEFORE that `<script>` block (i.e., after the `<div id="tutorial-list">` block and before the existing script tag):

```nunjucks
{# Drawer backdrop #}
<div id="tutorial-drawer-backdrop"
     class="hidden fixed inset-0 z-[39]"
     data-action="close-tutorial-drawer"></div>

{# Drawer panel (slides in from right) #}
<div id="tutorial-drawer-panel"
     class="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-40
            translate-x-full opacity-0 pointer-events-none
            transition-all duration-300 ease-out overflow-y-auto"
     aria-hidden="true">
  <div id="tutorial-drawer-content"></div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/tutorials.njk
git commit -m "feat: add tutorial drawer scaffold to tutorials page"
```

---

### Task 3: Update `tutorial-row.njk` — add row click + no-row-click guards

> **Note:** The spec's file map lists `tutorial-list.njk` here, but that file only contains the `<table>` wrapper and `{% include "partials/admin/tutorial-row.njk" %}`. The `<tr>`, reorder forms, and delete form all live in `tutorial-row.njk` — that is the correct file to modify.

**Files:**
- Modify: `src/views/partials/admin/tutorial-row.njk`

- [ ] **Step 1: Replace the `<tr>` opening tag to add drawer action and cursor**

Find:
```nunjucks
<tr class="border-b last:border-0 hover:bg-gray-50" id="tutorial-row-{{ tutorial.id }}">
```

Replace with:
```nunjucks
<tr class="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
    id="tutorial-row-{{ tutorial.id }}"
    data-action="open-tutorial-drawer"
    data-tutorial-url="/admin/tutorials/{{ tutorial.id }}/drawer?tab={{ activeTab }}">
```

- [ ] **Step 2: Add `no-row-click` class to both reorder forms and the delete form**

Find the first reorder form:
```nunjucks
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
```

Replace with (adds `no-row-click` to all three forms and the edit link):
```nunjucks
    <form method="POST" action="/admin/tutorials/reorder?tab={{ activeTab }}" class="inline no-row-click"
          hx-post="/admin/tutorials/reorder?tab={{ activeTab }}" hx-target="#tutorial-list" hx-swap="innerHTML">
      <input type="hidden" name="items[0][id]" value="{{ tutorial.id }}">
      <input type="hidden" name="items[0][orderIndex]" value="{{ tutorial.orderIndex - 1 }}">
      <button type="submit" class="text-gray-400 hover:text-gray-600 px-1" aria-label="{{ 'Move up' | t }}">↑</button>
    </form>
    <form method="POST" action="/admin/tutorials/reorder?tab={{ activeTab }}" class="inline no-row-click"
          hx-post="/admin/tutorials/reorder?tab={{ activeTab }}" hx-target="#tutorial-list" hx-swap="innerHTML">
      <input type="hidden" name="items[0][id]" value="{{ tutorial.id }}">
      <input type="hidden" name="items[0][orderIndex]" value="{{ tutorial.orderIndex + 1 }}">
      <button type="submit" class="text-gray-400 hover:text-gray-600 px-1" aria-label="{{ 'Move down' | t }}">↓</button>
    </form>
    <a href="/admin/tutorials/{{ tutorial.id }}/edit" class="text-indigo-600 hover:underline text-xs no-row-click">{{ "Edit" | t }}</a>
    <form method="POST" action="/admin/tutorials/{{ tutorial.id }}/delete" class="inline no-row-click"
          data-action="confirm-submit" data-message="{{ 'Delete this tutorial?' | t }}">
      <button type="submit" class="text-red-500 hover:underline text-xs">{{ "Delete" | t }}</button>
    </form>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/tutorial-row.njk
git commit -m "feat: add drawer row-click to tutorial rows"
```

---

### Task 4: Add tutorial drawer JS handlers to `app.js`

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add close + open click handlers**

Find:
```javascript
    if (action === 'close-testimonial-drawer') {
```

Insert BEFORE that block:
```javascript
    if (action === 'close-tutorial-drawer') {
      var tutorialDrawer = document.getElementById('tutorial-drawer-panel');
      var tutorialBackdrop = document.getElementById('tutorial-drawer-backdrop');
      if (tutorialDrawer) {
        tutorialDrawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        tutorialDrawer.setAttribute('aria-hidden', 'true');
      }
      if (tutorialBackdrop) tutorialBackdrop.classList.add('hidden');
    }

    if (action === 'open-tutorial-drawer') {
      if (e.target.closest('.no-row-click')) return;
      var url = el.dataset.tutorialUrl;
      if (url) {
        htmx.ajax('GET', url, { target: '#tutorial-drawer-content', swap: 'innerHTML' });
      }
    }

```

- [ ] **Step 2: Add HTMX show/hide listener**

Find:
```javascript
  // ── HTMX: market content panel show/hide ──────────────────────
```

Insert BEFORE that block:
```javascript
  // ── HTMX: tutorial drawer show/hide ────────────────────────────
  document.addEventListener('htmx:afterRequest', function (e) {
    var drawer = document.getElementById('tutorial-drawer-panel');
    if (drawer) {
      // Show drawer when form content loads into it
      if (e.detail.target && e.detail.target.id === 'tutorial-drawer-content' && e.detail.successful) {
        drawer.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.removeAttribute('aria-hidden');
        var backdrop = document.getElementById('tutorial-drawer-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
      }
      // Hide drawer after successful form POST that targets #tutorial-list
      if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#tutorial-drawer-panel') && e.detail.successful && e.detail.target && e.detail.target.id === 'tutorial-list') {
        drawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        drawer.setAttribute('aria-hidden', 'true');
        var backdrop2 = document.getElementById('tutorial-drawer-backdrop');
        if (backdrop2) backdrop2.classList.add('hidden');
      }
    }
  });

```

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add tutorial drawer JS handlers"
```

---

## Chunk 2: Router Changes (TDD)

### Task 5: Write failing tests

**Files:**
- Modify: `src/domains/admin/__tests__/admin.router.test.ts`

Find the existing `describe('GET /admin/tutorials — tab param', ...)` block. Add the following `describe` blocks after it (before the testimonials tests):

- [ ] **Step 1: Add tests for the new HTMX routes**

Pattern notes — the test file:
- Uses `makeApp()` which injects `req.user` via mock middleware; no session cookies needed
- `res.render` stub unconditionally calls `res.status(200).send('<html></html>')` — this overrides any `res.status(400)` set before render. **Do not assert 400 status on validation-error paths** — assert service call patterns instead
- Uses `jest.mocked(contentService.method).mockResolvedValue(...)` for service mocks
- The success tests are proper TDD-red tests: before the HTMX branch, `POST` with `hx-request` header returns 302 (redirect); after, it returns 200 (rendered fragment)
- The `GET /admin/tutorials/new` tests are regression tests only (both paths already return 200)
- The `GET /admin/tutorials/:id/drawer` test IS a TDD-red test (the route doesn't exist yet → 404)

```typescript
describe('GET /admin/tutorials/new — HTMX drawer', () => {
  // Regression tests — both paths return 200 before and after; verifies no 500 errors
  it('returns 200 with hx-request header', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/admin/tutorials/new?category=forms')
      .set('hx-request', 'true');
    expect(res.status).toBe(200);
  });
});

describe('GET /admin/tutorials/:id/drawer', () => {
  // TDD-red: 404 before route added, 200 after
  it('returns 200 and calls getTutorialById with the correct id', async () => {
    jest.mocked(contentService.getTutorialById).mockResolvedValue({
      id: 'tutorial-uuid-1',
      title: 'How to Fill the OTP',
      slug: 'how-to-fill-otp',
      youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
      category: 'forms',
      description: 'Step by step guide',
      orderIndex: 1,
    } as any);
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials/tutorial-uuid-1/drawer?tab=forms');
    expect(res.status).toBe(200);
    expect(contentService.getTutorialById).toHaveBeenCalledWith('tutorial-uuid-1');
  });
});

describe('POST /admin/tutorials — HTMX', () => {
  // Validation error: res.render stub overrides status to 200, so assert service NOT called
  it('does not call createTutorial on validation error', async () => {
    const app = makeApp();
    await request(app)
      .post('/admin/tutorials')
      .set('hx-request', 'true')
      .send({ title: '', youtubeUrl: '', category: '', activeTab: 'forms' });
    expect(contentService.createTutorial).not.toHaveBeenCalled();
  });

  // TDD-red: before HTMX branch, returns 302 redirect; after, returns 200 + calls getTutorialsGrouped
  it('returns 200 and calls createTutorial + getTutorialsGrouped on success', async () => {
    const created = { id: 'new-id', title: 'New Tutorial', slug: 'new-tutorial', youtubeUrl: 'https://youtube.com/watch?v=xyz', category: 'forms', orderIndex: 1, description: null };
    jest.mocked(contentService.createTutorial).mockResolvedValue(created as any);
    jest.mocked(contentService.getTutorialsGrouped).mockResolvedValue({ photography: [], forms: [created], process: [], financial: [] } as any);
    const app = makeApp();
    const res = await request(app)
      .post('/admin/tutorials')
      .set('hx-request', 'true')
      .send({ title: 'New Tutorial', youtubeUrl: 'https://youtube.com/watch?v=xyz', category: 'forms', activeTab: 'forms' });
    expect(res.status).toBe(200);
    expect(contentService.createTutorial).toHaveBeenCalled();
    expect(contentService.getTutorialsGrouped).toHaveBeenCalled();
  });
});

describe('POST /admin/tutorials/:id — HTMX', () => {
  // Validation error: assert getTutorialById called for re-render data, updateTutorial NOT called
  it('calls getTutorialById but not updateTutorial on validation error', async () => {
    jest.mocked(contentService.getTutorialById).mockResolvedValue({
      id: 'tutorial-uuid-1', title: 'Old Title', slug: 'old-title',
      youtubeUrl: 'https://youtube.com/watch?v=old', category: 'forms', orderIndex: 1, description: null,
    } as any);
    const app = makeApp();
    await request(app)
      .post('/admin/tutorials/tutorial-uuid-1')
      .set('hx-request', 'true')
      .send({ title: '', youtubeUrl: '', category: '', activeTab: 'forms' });
    expect(contentService.getTutorialById).toHaveBeenCalledWith('tutorial-uuid-1');
    expect(contentService.updateTutorial).not.toHaveBeenCalled();
  });

  // TDD-red: before HTMX branch, returns 302; after, returns 200 + calls getTutorialsGrouped
  it('returns 200 and calls updateTutorial + getTutorialsGrouped on success', async () => {
    const updated = { id: 'tutorial-uuid-1', title: 'Updated', slug: 'updated', youtubeUrl: 'https://youtube.com/watch?v=new', category: 'forms', orderIndex: 1, description: null };
    jest.mocked(contentService.updateTutorial).mockResolvedValue(updated as any);
    jest.mocked(contentService.getTutorialsGrouped).mockResolvedValue({ photography: [], forms: [updated], process: [], financial: [] } as any);
    const app = makeApp();
    const res = await request(app)
      .post('/admin/tutorials/tutorial-uuid-1')
      .set('hx-request', 'true')
      .send({ title: 'Updated', youtubeUrl: 'https://youtube.com/watch?v=new', category: 'forms', activeTab: 'forms' });
    expect(res.status).toBe(200);
    expect(contentService.updateTutorial).toHaveBeenCalledWith('tutorial-uuid-1', expect.objectContaining({ title: 'Updated' }));
    expect(contentService.getTutorialsGrouped).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests to confirm the TDD-red ones fail**

```bash
npm test -- --testPathPattern="admin.router.test" --testNamePattern="HTMX" 2>&1 | tail -30
```

Expected failures (before router changes):
- `GET /admin/tutorials/:id/drawer` → 404 (route doesn't exist)
- `POST /admin/tutorials` success → 302 (redirect, not 200)
- `POST /admin/tutorials/:id` success → 302 (redirect, not 200)

---

### Task 6: Modify `GET /admin/tutorials/new` + add `GET /admin/tutorials/:id/drawer`

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Add HTMX branch to `GET /admin/tutorials/new`**

Find:
```typescript
adminRouter.get(
  '/admin/tutorials/new',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_CATEGORIES = ['photography', 'forms', 'process', 'financial'];
      const rawCategory = req.query['category'] as string | undefined;
      const preselectedCategory = VALID_CATEGORIES.includes(rawCategory ?? '') ? rawCategory : '';
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/tutorial-form', {
        pageTitle: 'New Tutorial',
        user,
        hasAvatar,
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
      if (req.headers['hx-request']) {
        return res.render('partials/admin/tutorial-form-drawer', {
          tutorial: null,
          errors: [],
          activeTab: preselectedCategory || 'photography',
        });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/tutorial-form', {
        pageTitle: 'New Tutorial',
        user,
        hasAvatar,
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

- [ ] **Step 2: Add `GET /admin/tutorials/:id/drawer` after the /new route**

Find:
```typescript
adminRouter.post(
  '/admin/tutorials',
  ...adminAuth,
  ...validateTutorialCreate,
```

Insert BEFORE that block:
```typescript
adminRouter.get(
  '/admin/tutorials/:id/drawer',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tutorial = await contentService.getTutorialById(req.params['id'] as string);
      const rawTab = req.query['tab'] as string | undefined;
      const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
        ? (rawTab as TutorialTab)
        : tutorial.category;
      return res.render('partials/admin/tutorial-form-drawer', {
        tutorial,
        errors: [],
        activeTab,
      });
    } catch (err) {
      return next(err);
    }
  },
);

```

---

### Task 7: Add HTMX branches to `POST /admin/tutorials`

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Add HTMX branch for validation error in `POST /admin/tutorials`**

Find (inside `POST /admin/tutorials`, the validation error block):
```typescript
      if (!errors.isEmpty()) {
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
          tutorial: null,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

Replace with:
```typescript
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab) ? rawTab : 'photography';
          return res.status(400).render('partials/admin/tutorial-form-drawer', {
            tutorial: null,
            errors: errors.array(),
            values: req.body,
            activeTab,
          });
        }
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
          tutorial: null,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

- [ ] **Step 2: Add HTMX branch for success in `POST /admin/tutorials`**

Find (inside `POST /admin/tutorials`, after `await contentService.createTutorial(...)`):
```typescript
      return res.redirect('/admin/tutorials');
```

Replace with:
```typescript
      if (req.headers['hx-request']) {
        const rawTab = (req.body.activeTab as string) ?? 'photography';
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const allTutorials = await contentService.getTutorialsGrouped();
        const activeItems = allTutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      return res.redirect('/admin/tutorials');
```

- [ ] **Step 3: Add HTMX branch for ConflictError in `POST /admin/tutorials`**

Find (inside the `catch` block of `POST /admin/tutorials`):
```typescript
      if (err instanceof ConflictError) {
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
          tutorial: null,
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

Replace with:
```typescript
      if (err instanceof ConflictError) {
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab) ? rawTab : 'photography';
          return res.status(409).render('partials/admin/tutorial-form-drawer', {
            tutorial: null,
            errors: [{ msg: err.message }],
            values: req.body,
            activeTab,
          });
        }
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'New Tutorial',
          user,
          hasAvatar,
          tutorial: null,
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

---

### Task 8: Add HTMX branches to `POST /admin/tutorials/:id`

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Add HTMX branch for validation error in `POST /admin/tutorials/:id`**

Find (inside `POST /admin/tutorials/:id`, the validation error block):
```typescript
      if (!errors.isEmpty()) {
        const tutorial = await contentService.getTutorialById(req.params['id'] as string);
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
          tutorial,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

Replace with:
```typescript
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          const tutorial = await contentService.getTutorialById(req.params['id'] as string);
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab) ? rawTab : 'photography';
          return res.status(400).render('partials/admin/tutorial-form-drawer', {
            tutorial,
            errors: errors.array(),
            values: req.body,
            activeTab,
          });
        }
        const tutorial = await contentService.getTutorialById(req.params['id'] as string);
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(400).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
          tutorial,
          errors: errors.array(),
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

- [ ] **Step 2: Add HTMX branch for success in `POST /admin/tutorials/:id`**

Find (inside `POST /admin/tutorials/:id`, after `await contentService.updateTutorial(...)`):
```typescript
      return res.redirect('/admin/tutorials');
```

Replace with:
```typescript
      if (req.headers['hx-request']) {
        const rawTab = (req.body.activeTab as string) ?? 'photography';
        const activeTab: TutorialTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab)
          ? (rawTab as TutorialTab)
          : 'photography';
        const allTutorials = await contentService.getTutorialsGrouped();
        const activeItems = allTutorials[activeTab] ?? [];
        return res.render('partials/admin/tutorial-list', { tutorials: activeItems, activeTab });
      }
      return res.redirect('/admin/tutorials');
```

- [ ] **Step 3: Add HTMX branch for ConflictError in `POST /admin/tutorials/:id`**

Find (inside the `catch` block of `POST /admin/tutorials/:id`):
```typescript
      if (err instanceof ConflictError) {
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
          tutorial: { id: req.params['id'] as string },
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

Replace with:
```typescript
      if (err instanceof ConflictError) {
        if (req.headers['hx-request']) {
          const rawTab = (req.body.activeTab as string) ?? 'photography';
          const activeTab = VALID_TUTORIAL_TABS.includes(rawTab as TutorialTab) ? rawTab : 'photography';
          return res.status(409).render('partials/admin/tutorial-form-drawer', {
            tutorial: { id: req.params['id'] as string },
            errors: [{ msg: err.message }],
            values: req.body,
            activeTab,
          });
        }
        const hasAvatar = await getHasAvatar(user.id);
        return res.status(409).render('pages/admin/tutorial-form', {
          pageTitle: 'Edit Tutorial',
          user,
          hasAvatar,
          tutorial: { id: req.params['id'] as string },
          errors: [{ msg: err.message }],
          values: req.body,
          currentPath: '/admin/tutorials',
        });
      }
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```bash
npm test -- --testPathPattern="admin.router.test" --testNamePattern="HTMX" 2>&1 | tail -30
```

Expected: all HTMX tests pass.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit router changes**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: add HTMX drawer routes for tutorial create/edit"
```

---

## Done

All tasks complete. Start the dev server with `npm run dev` and verify:

1. `/admin/tutorials` — clicking a row slides in the edit drawer from the right
2. "Add Tutorial" button — slides in the create drawer
3. Saving a tutorial — drawer closes, list refreshes in place
4. Validation errors — drawer stays open, errors shown inline
5. Reorder ↑↓ buttons — work as before, no drawer opens
6. Delete button — confirm dialog works, no drawer opens
7. Direct navigation to `/admin/tutorials/:id/edit` — full-page form still works
