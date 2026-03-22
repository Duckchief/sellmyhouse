# Seller Status Pills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the status `<select>` dropdown on `/agent/sellers` and `/admin/sellers` with a row of clickable pill buttons that show per-status counts, matching the visual style of `/admin/pipeline`.

**Architecture:** Two new `groupBy` queries (one per domain) return global status counts. Both routers call the count query in `Promise.all` alongside the existing list query. A shared Nunjucks partial renders the pills; HTMX on each pill filters the list while a hidden status input in the search form preserves the selected status when the Search button is clicked.

**Tech Stack:** TypeScript, Prisma, Express, Nunjucks, HTMX, Tailwind CSS, Jest, Supertest

---

### Task 1: Add `getSellerStatusCounts` to `agent.repository.ts`

**Files:**
- Modify: `src/domains/agent/agent.repository.ts` (append after `getSellerList`)
- Test: `src/domains/agent/__tests__/agent.service.test.ts` (repo tests live in service test file — check existing pattern; add a new describe block)

**Step 1: Write the failing test**

Open `src/domains/agent/__tests__/agent.service.test.ts`. Find the existing `jest.mock('@/infra/database/prisma', ...)` block and the `mockRepo` pattern. Add this describe block at the bottom of the file (before the closing `}`):

```typescript
describe('getSellerStatusCounts (repo boundary)', () => {
  it('returns zero-filled counts when no sellers exist', async () => {
    mockRepo.getSellerStatusCounts.mockResolvedValue({
      lead: 0, engaged: 0, active: 0, completed: 0, archived: 0,
    });

    const result = await agentService.getSellerStatusCounts('agent-1');

    expect(mockRepo.getSellerStatusCounts).toHaveBeenCalledWith('agent-1');
    expect(result).toEqual({ lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 });
  });

  it('passes undefined agentId for admin (no filter)', async () => {
    mockRepo.getSellerStatusCounts.mockResolvedValue({
      lead: 5, engaged: 2, active: 3, completed: 1, archived: 0,
    });

    await agentService.getSellerStatusCounts(undefined);

    expect(mockRepo.getSellerStatusCounts).toHaveBeenCalledWith(undefined);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="agent.service.test" --no-coverage
```

Expected: FAIL — `mockRepo.getSellerStatusCounts is not a function` (function doesn't exist yet)

**Step 3: Add repo function**

Append to `src/domains/agent/agent.repository.ts` after the closing `}` of `getSellerList`:

```typescript
export async function getSellerStatusCounts(agentId?: string): Promise<Record<string, number>> {
  const rows = await prisma.seller.groupBy({
    by: ['status'],
    where: agentId ? { agentId } : {},
    _count: { id: true },
  });
  const counts: Record<string, number> = { lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 };
  for (const row of rows) {
    counts[row.status] = row._count.id;
  }
  return counts;
}
```

**Step 4: Add service wrapper**

Append to `src/domains/agent/agent.service.ts`:

```typescript
export async function getSellerStatusCounts(agentId?: string): Promise<Record<string, number>> {
  return agentRepo.getSellerStatusCounts(agentId);
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="agent.service.test" --no-coverage
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/agent/agent.repository.ts src/domains/agent/agent.service.ts src/domains/agent/__tests__/agent.service.test.ts
git commit -m "feat(agent): add getSellerStatusCounts repo + service function"
```

---

### Task 2: Update agent router to pass `statusCounts` and `currentStatus`

**Files:**
- Modify: `src/domains/agent/agent.router.ts` (the `GET /agent/sellers` handler)
- Test: `src/domains/agent/__tests__/agent.router.test.ts`

**Step 1: Write the failing test**

In `src/domains/agent/__tests__/agent.router.test.ts`, find the `describe('GET /agent/sellers', ...)` block. Add a second test inside it:

```typescript
it('calls getSellerStatusCounts with the agent id', async () => {
  const app = createTestApp({ id: 'agent-1', role: 'agent' });
  mockService.getSellerList.mockResolvedValue({
    sellers: [],
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 0,
  });
  mockService.getSellerStatusCounts = jest.fn().mockResolvedValue({
    lead: 3, engaged: 1, active: 2, completed: 0, archived: 0,
  });

  await request(app).get('/agent/sellers');

  expect(mockService.getSellerStatusCounts).toHaveBeenCalledWith('agent-1');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="agent.router.test" --no-coverage
```

Expected: FAIL — `mockService.getSellerStatusCounts is not a function`

**Step 3: Update the router handler**

In `src/domains/agent/agent.router.ts`, find the `GET /agent/sellers` handler. Replace:

```typescript
      const result = await agentService.getSellerList(filter, getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-list', { result });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/sellers', { pageTitle: 'Sellers', user, hasAvatar, result });
```

With:

```typescript
      const [result, statusCounts] = await Promise.all([
        agentService.getSellerList(filter, getAgentFilter(user)),
        agentService.getSellerStatusCounts(getAgentFilter(user)),
      ]);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-list', { result, statusCounts });
      }
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/agent/sellers', {
        pageTitle: 'Sellers',
        user,
        hasAvatar,
        result,
        statusCounts,
        currentStatus: filter.status ?? '',
      });
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="agent.router.test" --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat(agent): pass statusCounts and currentStatus to sellers page"
```

---

### Task 3: Add `getAdminSellerStatusCounts` to `admin.repository.ts` and `admin.service.ts`

**Files:**
- Modify: `src/domains/admin/admin.repository.ts` (append after `findAllSellers`)
- Modify: `src/domains/admin/admin.service.ts` (append after `getAllSellers`)
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

**Step 1: Write the failing test**

In `src/domains/admin/__tests__/admin.service.test.ts`, add a new describe block:

```typescript
describe('getAdminSellerStatusCounts', () => {
  it('returns counts from repo', async () => {
    const expected = { lead: 4, engaged: 2, active: 5, completed: 3, archived: 1 };
    jest.spyOn(adminRepo, 'getAdminSellerStatusCounts').mockResolvedValue(expected);

    const result = await adminService.getAdminSellerStatusCounts();

    expect(result).toEqual(expected);
  });
});
```

Note: check how other tests in this file mock the repo — if they use `jest.mock('../admin.repository')` + a `mockRepo` pattern, follow that instead of `jest.spyOn`.

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.service.test" --no-coverage
```

Expected: FAIL

**Step 3: Add repo function**

In `src/domains/admin/admin.repository.ts`, append after `findAllSellers` (in the `// ─── Seller Queries` section):

```typescript
export async function getAdminSellerStatusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.seller.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  const counts: Record<string, number> = { lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 };
  for (const row of rows) {
    counts[row.status] = row._count.id;
  }
  return counts;
}
```

**Step 4: Add service wrapper**

In `src/domains/admin/admin.service.ts`, append after `getAllSellers`:

```typescript
export async function getAdminSellerStatusCounts(): Promise<Record<string, number>> {
  return adminRepo.getAdminSellerStatusCounts();
}
```

**Step 5: Run tests**

```bash
npm test -- --testPathPattern="admin.service.test" --no-coverage
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/admin/admin.repository.ts src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add getAdminSellerStatusCounts repo + service function"
```

---

### Task 4: Update admin router to pass `statusCounts` and `currentStatus`

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (the `GET /admin/sellers` handler)
- Test: `src/domains/admin/__tests__/admin.router.test.ts`

**Step 1: Write the failing test**

In `src/domains/admin/__tests__/admin.router.test.ts`, add a new describe block:

```typescript
describe('GET /admin/sellers', () => {
  it('calls getAdminSellerStatusCounts and passes statusCounts to render', async () => {
    mockAdminService.getAllSellers = jest.fn().mockResolvedValue({
      sellers: [], total: 0, page: 1, limit: 25,
    });
    mockAdminService.getTeam = jest.fn().mockResolvedValue([]);
    mockAdminService.getAdminSellerStatusCounts = jest.fn().mockResolvedValue({
      lead: 2, engaged: 1, active: 3, completed: 0, archived: 0,
    });

    const app = makeApp();
    const res = await request(app).get('/admin/sellers');

    expect(res.status).toBe(200);
    expect(mockAdminService.getAdminSellerStatusCounts).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.router.test" --no-coverage
```

Expected: FAIL

**Step 3: Update the router handler**

In `src/domains/admin/admin.router.ts`, find the `GET /admin/sellers` handler. Replace:

```typescript
      const [result, team] = await Promise.all([
        adminService.getAllSellers(filter),
        adminService.getTeam(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/seller-list', { result, team });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/sellers', {
        pageTitle: 'Sellers',
        user,
        hasAvatar,
        result,
        team,
        currentPath: '/admin/sellers',
      });
```

With:

```typescript
      const [result, team, statusCounts] = await Promise.all([
        adminService.getAllSellers(filter),
        adminService.getTeam(),
        adminService.getAdminSellerStatusCounts(),
      ]);
      if (req.headers['hx-request']) {
        return res.render('partials/admin/seller-list', { result, team, statusCounts });
      }
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      res.render('pages/admin/sellers', {
        pageTitle: 'Sellers',
        user,
        hasAvatar,
        result,
        team,
        statusCounts,
        currentStatus: filter.status ?? '',
        currentPath: '/admin/sellers',
      });
```

**Step 4: Run tests**

```bash
npm test -- --testPathPattern="admin.router.test" --no-coverage
```

Expected: PASS

**Step 5: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: all passing

**Step 6: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): pass statusCounts and currentStatus to sellers page"
```

---

### Task 5: Create the shared `seller-status-pills.njk` partial

**Files:**
- Create: `src/views/partials/shared/seller-status-pills.njk`

No unit tests for Nunjucks partials — verified visually in Task 6 and 7.

**Step 1: Create the partial**

Create `src/views/partials/shared/seller-status-pills.njk`:

```nunjucks
{#
  Variables required:
    statusCounts   — Record<string, number>  e.g. { lead: 3, engaged: 1, active: 5, ... }
    currentStatus  — string                  the currently active status value, or '' for All
    hxEndpoint     — string                  e.g. '/agent/sellers' or '/admin/sellers'
    formId         — string                  id of the search form (for hx-include)
#}

{% set pillList = [
  { value: '',          label: 'All',       bg: 'bg-gray-50',   ring: 'ring-gray-400',   countColor: 'text-gray-700'   },
  { value: 'lead',      label: 'Lead',      bg: 'bg-blue-50',   ring: 'ring-blue-400',   countColor: 'text-blue-700'   },
  { value: 'engaged',   label: 'Engaged',   bg: 'bg-yellow-50', ring: 'ring-yellow-400', countColor: 'text-yellow-700' },
  { value: 'active',    label: 'Active',    bg: 'bg-green-50',  ring: 'ring-green-400',  countColor: 'text-green-700'  },
  { value: 'completed', label: 'Completed', bg: 'bg-gray-50',   ring: 'ring-gray-400',   countColor: 'text-gray-700'   },
  { value: 'archived',  label: 'Archived',  bg: 'bg-red-50',    ring: 'ring-red-400',    countColor: 'text-red-700'    }
] %}

<div class="flex flex-wrap gap-3 mb-4">
  {% for p in pillList %}
  <button
    type="button"
    data-status-pill
    data-value="{{ p.value }}"
    data-ring="{{ p.ring }}"
    hx-get="{{ hxEndpoint }}"
    hx-target="#seller-list"
    hx-include="#{{ formId }}"
    hx-vals='{"status": "{{ p.value }}"}'
    class="px-4 py-2 rounded-lg text-sm font-medium border-0 cursor-pointer transition {{ p.bg }}
      {%- if currentStatus == p.value %} ring-2 ring-offset-1 {{ p.ring }}
      {%- else %} hover:ring-2 hover:ring-offset-1 hover:{{ p.ring }}
      {%- endif %}"
  >
    <p class="text-xs font-medium text-gray-500 uppercase text-center">{{ p.label | t }}</p>
    <p class="text-2xl font-bold text-center {{ p.countColor }}">
      {%- if p.value == '' -%}
        {{ (statusCounts.lead or 0) + (statusCounts.engaged or 0) + (statusCounts.active or 0) + (statusCounts.completed or 0) + (statusCounts.archived or 0) }}
      {%- else -%}
        {{ statusCounts[p.value] or 0 }}
      {%- endif -%}
    </p>
  </button>
  {% endfor %}
</div>

<script nonce="{{ cspNonce }}">
  (function () {
    var pills = document.querySelectorAll('[data-status-pill]');
    var statusInput = document.getElementById('status-input');

    pills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Update active visual state
        pills.forEach(function (b) {
          b.classList.remove('ring-2', 'ring-offset-1', b.dataset.ring);
          b.classList.add('hover:ring-2', 'hover:ring-offset-1', 'hover:' + b.dataset.ring);
        });
        this.classList.remove('hover:ring-2', 'hover:ring-offset-1', 'hover:' + this.dataset.ring);
        this.classList.add('ring-2', 'ring-offset-1', this.dataset.ring);

        // Keep hidden status input in sync so Search button preserves selection
        if (statusInput) statusInput.value = this.dataset.value;
      });
    });
  })();
</script>
```

**Step 2: Commit**

```bash
git add src/views/partials/shared/seller-status-pills.njk
git commit -m "feat(views): add seller-status-pills shared partial"
```

---

### Task 6: Update `pages/agent/sellers.njk`

**Files:**
- Modify: `src/views/pages/agent/sellers.njk`

**Step 1: Replace the template**

The existing form has `id="seller-filter-form"`. Remove the `<select name="status">` and add: the pills partial above the form, a hidden status input inside the form.

Replace the entire file contents with:

```nunjucks
{% extends "layouts/agent.njk" %}

{% block content %}
{% set pageTitle = "Sellers" %}
{% include "partials/shared/page-header.njk" %}

{% set hxEndpoint = '/agent/sellers' %}
{% set formId = 'seller-filter-form' %}
{% include "partials/shared/seller-status-pills.njk" %}

<form id="seller-filter-form" hx-get="/agent/sellers" hx-target="#seller-list" hx-trigger="submit" class="flex gap-3 mb-6 flex-wrap">
  <input type="hidden" name="status" id="status-input" value="{{ currentStatus }}" />
  <input type="text" name="search" placeholder="{{ 'Search name, email, phone...' | t }}" class="border rounded px-3 py-2 text-sm w-64" />
  <input type="text" name="town" placeholder="{{ 'Town' | t }}" class="border rounded px-3 py-2 text-sm w-40" />
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Search" | t }}</button>
</form>

<div id="seller-list">{% include "partials/agent/seller-list.njk" %}</div>
{% endblock %}
```

**Step 2: Verify visually**

Start the dev server:

```bash
npm run dev
```

Navigate to `/agent/sellers`. Verify:
- Pill row renders above the search form with counts
- No status dropdown visible
- Clicking "Lead" pill highlights it with a blue ring and filters the list to lead sellers
- Clicking "All" pill shows all sellers
- Typing in search and clicking Search preserves the selected pill's status
- Clicking a pill while search text is filled filters by both

**Step 3: Commit**

```bash
git add src/views/pages/agent/sellers.njk
git commit -m "feat(views): replace status select with pill row on agent sellers page"
```

---

### Task 7: Update `pages/admin/sellers.njk`

**Files:**
- Modify: `src/views/pages/admin/sellers.njk`

**Step 1: Replace the template**

The admin form currently has no id — add one. Remove `<select name="status">`, add pills partial and hidden status input.

Replace the entire file contents with:

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
{% set pageTitle = "All Sellers" %}
{% include "partials/shared/page-header.njk" %}

{% set hxEndpoint = '/admin/sellers' %}
{% set formId = 'admin-seller-filter-form' %}
{% include "partials/shared/seller-status-pills.njk" %}

<form id="admin-seller-filter-form" class="flex gap-3 mb-6" hx-get="/admin/sellers" hx-target="#seller-list" hx-trigger="submit">
  <input type="hidden" name="status" id="status-input" value="{{ currentStatus }}" />
  <input type="text" name="search" placeholder="{{ 'Search by name, email, phone' | t }}" class="border rounded px-3 py-2 text-sm flex-1" />
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Filter" | t }}</button>
</form>
<div id="action-result" class="mb-4"></div>
<div id="modal-container"></div>
<div id="seller-list" hx-get="/admin/sellers" hx-trigger="sellerAssigned from:body" hx-target="#seller-list" hx-swap="innerHTML">{% include "partials/admin/seller-list.njk" %}</div>
{% endblock %}
```

**Step 2: Verify visually**

Navigate to `/admin/sellers`. Verify:
- Pill row renders with counts matching the pipeline page totals
- Clicking a pill filters the table
- Filter button preserves the selected pill status
- The `sellerAssigned` HTMX trigger still refreshes the list correctly

**Step 3: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: all passing

**Step 4: Commit**

```bash
git add src/views/pages/admin/sellers.njk
git commit -m "feat(views): replace status select with pill row on admin sellers page"
```

---

### Task 8: Tailwind build check

The partial uses `hover:ring-blue-400`, `hover:ring-yellow-400` etc. via dynamic JS class toggling. These classes must exist in the CSS bundle. Since they appear statically in the Nunjucks template (for the inactive pill rendering path), Tailwind will include them. Verify the build is clean.

**Step 1: Build**

```bash
npm run build
```

Expected: no errors, no missing class warnings

**Step 2: If any hover ring classes are missing**

Add a Tailwind safelist entry in `tailwind.config.js`:

```js
safelist: [
  { pattern: /^hover:ring-(blue|yellow|green|gray|red)-400$/ },
  { pattern: /^ring-(blue|yellow|green|gray|red)-400$/ },
]
```

**Step 3: Final commit if safelist was needed**

```bash
git add tailwind.config.js
git commit -m "chore(tailwind): safelist ring color classes for status pills"
```
