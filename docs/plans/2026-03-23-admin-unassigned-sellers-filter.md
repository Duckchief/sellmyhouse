# Admin Unassigned Sellers Filter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Assignment" dropdown filter to the admin sellers page that lets admins filter by Unassigned or a specific agent.

**Architecture:** Single dropdown in the existing filter form, backed by the already-wired `agentId` query param. The repo gets a small change to handle `"unassigned"` → `null`. The `team` data (active agents) is already fetched and passed to the template.

**Tech Stack:** Nunjucks template, Express router, Prisma repository, Jest + Supertest tests.

---

### Task 1: Update repository to handle "unassigned" filter value

**Files:**
- Modify: `src/domains/admin/admin.repository.ts:160-161`
- Test: `src/domains/admin/__tests__/admin.repository.test.ts` (create if absent)

**Step 1: Write the failing test**

In `src/domains/admin/__tests__/admin.repository.test.ts`, add a test for the `"unassigned"` agentId handling. If the file doesn't exist, create it with the standard prisma mock pattern:

```typescript
import { findAllSellers } from '../admin.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    seller: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockFindMany = prisma.seller.findMany as jest.Mock;
const mockCount = prisma.seller.count as jest.Mock;

describe('findAllSellers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by agentId = null when agentId is "unassigned"', async () => {
    await findAllSellers({ agentId: 'unassigned' });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: null }),
      }),
    );
  });

  it('filters by specific agentId when a UUID is provided', async () => {
    await findAllSellers({ agentId: 'agent-123' });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: 'agent-123' }),
      }),
    );
  });

  it('does not add agentId to where when agentId is undefined', async () => {
    await findAllSellers({});
    const calledWhere = mockFindMany.mock.calls[0][0].where;
    expect(calledWhere).not.toHaveProperty('agentId');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/admin/__tests__/admin.repository.test.ts --no-coverage`
Expected: First test FAILS — `"unassigned"` is passed as a literal string, not converted to `null`.

**Step 3: Implement the fix**

In `src/domains/admin/admin.repository.ts`, replace line 161:

```typescript
// Old:
if (filter.agentId) where.agentId = filter.agentId;

// New:
if (filter.agentId === 'unassigned') {
  where.agentId = null;
} else if (filter.agentId) {
  where.agentId = filter.agentId;
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/domains/admin/__tests__/admin.repository.test.ts --no-coverage`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add src/domains/admin/admin.repository.ts src/domains/admin/__tests__/admin.repository.test.ts
git commit -m "feat(admin): handle 'unassigned' agentId filter in seller query"
```

---

### Task 2: Pass current agentId filter to template

**Files:**
- Modify: `src/domains/admin/admin.router.ts:498-506`
- Test: `src/domains/admin/__tests__/admin.router.test.ts:1100-1116`

**Step 1: Write the failing test**

Add a test in the existing `describe('GET /admin/sellers')` block:

```typescript
it('passes currentAgentId to render context', async () => {
  mockAdminService.getAllSellers.mockResolvedValue({
    sellers: [], total: 0, page: 1, limit: 25,
  } as any);
  mockAdminService.getTeam.mockResolvedValue([] as any);
  mockAdminService.getAdminSellerStatusCounts.mockResolvedValue({
    lead: 0, engaged: 0, active: 0, completed: 0, archived: 0,
  });

  const app = makeApp();
  const res = await request(app).get('/admin/sellers?agentId=unassigned');

  expect(res.status).toBe(200);
  expect(mockAdminService.getAllSellers).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: 'unassigned' }),
  );
});
```

**Step 2: Run test to verify it passes (or fails)**

Run: `npx jest src/domains/admin/__tests__/admin.router.test.ts -t "GET /admin/sellers" --no-coverage`

This test should already pass since `agentId` is already read from `req.query`. If it does pass, we still need to pass `currentAgentId` to the template render context.

**Step 3: Add currentAgentId to render context**

In `src/domains/admin/admin.router.ts`, in the GET `/admin/sellers` handler, add `currentAgentId` to both render calls:

For the HTMX branch (line ~494):
```typescript
return res.render('partials/admin/seller-list', { result, team, statusCounts, currentAgentId: filter.agentId ?? '' });
```

For the full-page branch (line ~498-506):
```typescript
res.render('pages/admin/sellers', {
  pageTitle: 'Sellers',
  user,
  hasAvatar,
  result,
  team,
  statusCounts,
  currentStatus: filter.status ?? '',
  currentAgentId: filter.agentId ?? '',
  currentPath: '/admin/sellers',
});
```

**Step 4: Run tests**

Run: `npx jest src/domains/admin/__tests__/admin.router.test.ts -t "GET /admin/sellers" --no-coverage`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): pass currentAgentId to sellers template context"
```

---

### Task 3: Add the assignment dropdown to the sellers template

**Files:**
- Modify: `src/views/pages/admin/sellers.njk:11-15`

**Step 1: Update the filter form**

Replace the form (lines 11-15) with:

```html
<form id="admin-seller-filter-form" class="flex gap-3 mb-6" hx-get="/admin/sellers" hx-target="#seller-list" hx-trigger="submit">
  <input type="hidden" name="status" id="status-input" value="{{ currentStatus }}" />
  <input type="text" name="search" placeholder="{{ 'Search by name, email, phone' | t }}" class="border rounded px-3 py-2 text-sm flex-1" value="{{ currentSearch }}" />
  <select name="agentId" class="border rounded px-3 py-2 text-sm">
    <option value="">{{ "All Agents" | t }}</option>
    <option value="unassigned" {% if currentAgentId == 'unassigned' %}selected{% endif %}>{{ "Unassigned" | t }}</option>
    <option disabled>─────────</option>
    {% for agent in team %}
      {% if agent.isActive %}
        <option value="{{ agent.id }}" {% if currentAgentId == agent.id %}selected{% endif %}>{{ agent.name }}</option>
      {% endif %}
    {% endfor %}
  </select>
  <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">{{ "Filter" | t }}</button>
</form>
```

**Step 2: Also pass `currentSearch` from the router**

In `src/domains/admin/admin.router.ts`, add `currentSearch: filter.search ?? ''` to both render calls (same locations as Task 2).

**Step 3: Verify visually**

Run: `npm run dev`
Navigate to `/admin/sellers` and verify:
- Dropdown appears between search bar and Filter button
- Options: "All Agents", "Unassigned", separator, then active agents
- Selecting "Unassigned" + clicking Filter shows only unassigned sellers
- Selecting a specific agent shows only that agent's sellers
- "All Agents" clears the filter

**Step 4: Commit**

```bash
git add src/views/pages/admin/sellers.njk src/domains/admin/admin.router.ts
git commit -m "feat(admin): add assignment dropdown filter to sellers page"
```

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, no regressions.

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compile, no TypeScript errors.

**Step 3: Manual smoke test**

1. Go to `/admin/sellers` — dropdown visible, defaults to "All Agents"
2. Select "Unassigned" → Filter → only sellers with no agent shown
3. Select a specific agent → Filter → only that agent's sellers shown
4. Combine with search text → both filters apply
5. Combine with status pills → all three filters apply
6. HTMX partial reload works (no full page refresh)
