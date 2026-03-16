# Admin Leads — All Leads Section Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "All Leads" section below "Unassigned Leads" on `/admin/leads`, showing every seller with `status = 'lead'` regardless of agent assignment.

**Architecture:** Add `findAllLeads` to the admin repo, `getAdminLeadQueue` to the admin service (returns `{ unassigned, all }`), update the router to call the new function and pass both variables, and restructure the `lead-list.njk` partial to render two sections using a Nunjucks macro.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, Tailwind CSS, Jest

---

## Chunk 1: Data Layer

### Task 1: Add `findAllLeads` to admin repository

**Files:**
- Modify: `src/domains/admin/admin.repository.ts` (after `countUnassignedLeads`, around line 149)

- [ ] **Step 1: Add `findAllLeads` function**

Insert after `countUnassignedLeads`:

```typescript
export async function findAllLeads(limit = 50) {
  return prisma.seller.findMany({
    where: { status: 'lead' },
    select: {
      id: true,
      name: true,
      phone: true,
      leadSource: true,
      createdAt: true,
      properties: { take: 1, select: { town: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
```

- [ ] **Step 2: Run existing tests to confirm no breakage**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test -- --testPathPattern="admin.service" 2>&1 | tail -10
```
Expected: all existing tests pass.

---

### Task 2: Add `AdminLeadQueueResult` type

**Files:**
- Modify: `src/domains/admin/admin.types.ts` (after `LeadListResult`, around line 130)

- [ ] **Step 1: Add the type**

Insert after the `LeadListResult` interface:

```typescript
export interface AdminLeadQueueResult {
  unassigned: LeadListResult;
  all: Array<{
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
}
```

- [ ] **Step 2: Run build to check types**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm run build 2>&1 | head -20
```
Expected: no new TypeScript errors.

---

### Task 3: Add `getAdminLeadQueue` to admin service + tests

**Files:**
- Modify: `src/domains/admin/admin.service.ts` (imports + after `getUnassignedLeads`, around line 319)
- Modify: `src/domains/admin/__tests__/admin.service.test.ts` (after `getUnassignedLeads` describe block, around line 115)

- [ ] **Step 1: Add `AdminLeadQueueResult` to the imports in `admin.service.ts`**

The type imports at the top of the file (lines 14–26) currently import from `./admin.types`. Add `AdminLeadQueueResult` to that import:

```typescript
import type {
  AdminLeadQueueResult,    // add this
  AdminSellerDetail,
  AgentCreateInput,
  AdminPipelineResult,
  AdminPipelineStage,
  AnalyticsData,
  AnalyticsFilter,
  HdbDataStatus,
  LeadListResult,
  ReviewItem,
  SettingGroup,
  SettingWithMeta,
} from './admin.types';
```

- [ ] **Step 2: Write the failing test first**

In `admin.service.test.ts`, add a new describe block after the existing `getUnassignedLeads` describe block (after line 115):

```typescript
// ─── getAdminLeadQueue ──────────────────────────────────────

describe('getAdminLeadQueue', () => {
  const unassignedSeller = {
    id: 's1',
    name: 'Alice',
    phone: '91234567',
    status: 'lead',
    leadSource: 'website',
    createdAt: new Date('2026-01-01'),
    properties: [{ town: 'TAMPINES' }],
  };

  const assignedSeller = {
    id: 's2',
    name: 'Bob',
    phone: '91234568',
    status: 'lead',
    leadSource: null,
    createdAt: new Date('2026-01-02'),
    properties: [],
  };

  it('returns unassigned and all leads', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([unassignedSeller] as never);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(1);
    mockAdminRepo.findAllLeads.mockResolvedValue([assignedSeller, unassignedSeller] as never);

    const result = await adminService.getAdminLeadQueue();

    expect(result.unassigned.leads).toHaveLength(1);
    expect(result.unassigned.leads[0].name).toBe('Alice');
    expect(result.all).toHaveLength(2);
    expect(result.all[0].name).toBe('Bob');
    expect(result.all[0].town).toBeNull();
    expect(result.all[1].town).toBe('TAMPINES');
  });

  it('returns empty arrays when no leads exist', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([]);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(0);
    mockAdminRepo.findAllLeads.mockResolvedValue([]);

    const result = await adminService.getAdminLeadQueue();

    expect(result.unassigned.leads).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });

  it('passes page to getUnassignedLeads', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([]);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(0);
    mockAdminRepo.findAllLeads.mockResolvedValue([]);

    await adminService.getAdminLeadQueue(3);

    expect(mockAdminRepo.findUnassignedLeads).toHaveBeenCalledWith(3, 25);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test -- --testPathPattern="admin.service" --testNamePattern="getAdminLeadQueue" 2>&1 | tail -15
```
Expected: FAIL — `adminService.getAdminLeadQueue is not a function`.

- [ ] **Step 4: Implement `getAdminLeadQueue` in `admin.service.ts`**

Insert after `getUnassignedLeads` (after line 319):

```typescript
export async function getAdminLeadQueue(page?: number): Promise<AdminLeadQueueResult> {
  const [unassigned, allRaw] = await Promise.all([
    getUnassignedLeads(page),
    adminRepo.findAllLeads(),
  ]);

  return {
    unassigned,
    all: allRaw.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
    })),
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test -- --testPathPattern="admin.service" 2>&1 | tail -15
```
Expected: all tests pass including the 3 new `getAdminLeadQueue` tests.

- [ ] **Step 6: Commit data layer**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2
git add src/domains/admin/admin.repository.ts \
        src/domains/admin/admin.types.ts \
        src/domains/admin/admin.service.ts \
        src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat: add getAdminLeadQueue returning unassigned and all leads"
```

---

## Chunk 2: Router + Template

### Task 4: Update admin router

**Files:**
- Modify: `src/domains/admin/admin.router.ts:69-86`

- [ ] **Step 1: Replace the `/admin/leads` route handler**

The current handler calls `adminService.getUnassignedLeads(page)` and passes `{ result }`. Replace it so it calls `getAdminLeadQueue` and passes `{ unassigned, all }`:

```typescript
// ─── Leads ───────────────────────────────────────────────────
adminRouter.get(
  '/admin/leads',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined;
      const { unassigned, all } = await adminService.getAdminLeadQueue(page);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/lead-list', { unassigned, all });
      }
      res.render('pages/admin/leads', { unassigned, all, currentPath: '/admin/leads' });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test -- --testPathPattern="admin.router" 2>&1 | tail -15
```
Expected: all router tests pass (any existing `/admin/leads` router tests will need updating — see note below).

**Note:** If any router tests mock `adminService.getUnassignedLeads` for the `/admin/leads` route, update them to mock `adminService.getAdminLeadQueue` instead, returning `{ unassigned: { leads: [], total: 0, page: 1, limit: 25, totalPages: 0 }, all: [] }`.

---

### Task 5: Rewrite `lead-list.njk` partial

**Files:**
- Modify: `src/views/partials/admin/lead-list.njk`
- Modify: `src/views/pages/admin/leads.njk`

- [ ] **Step 1: Update the page title in `leads.njk`**

Change line 4 from:
```nunjucks
<h1 class="text-2xl font-bold mb-6">{{ "Unassigned Leads" | t }}</h1>
```
to:
```nunjucks
<h1 class="text-2xl font-bold mb-6">{{ "Leads" | t }}</h1>
```

- [ ] **Step 2: Replace `lead-list.njk` content**

Replace the entire file with:

```nunjucks
{% macro leadTable(leads) %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Phone" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Town" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Lead Source" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Created" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for lead in leads %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-medium">
          <a href="/admin/sellers/{{ lead.id }}" class="text-accent hover:underline">{{ lead.name }}</a>
        </td>
        <td class="px-4 py-3 text-gray-600">{{ lead.phone or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">{{ lead.town or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">{{ lead.leadSource or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">{{ lead.createdAt | date }}</td>
        <td class="px-4 py-3">
          <button
            class="text-xs text-accent hover:underline"
            hx-get="/admin/sellers/{{ lead.id }}/assign-modal"
            hx-target="#modal-container"
          >{{ "Assign" | t }}</button>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>
{% endmacro %}

{% if unassigned.leads.length > 0 %}
<div class="mb-6">
  <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "Unassigned Leads" | t }}</h2>
  {{ leadTable(unassigned.leads) }}
  {% if unassigned.totalPages > 1 %}
  <div class="flex justify-between items-center mt-4 px-4">
    <span class="text-xs text-gray-500">{{ "Page" | t }} {{ unassigned.page }} {{ "of" | t }} {{ unassigned.totalPages }} ({{ unassigned.total }} {{ "total" | t }})</span>
    <div class="flex gap-2">
      {% if unassigned.page > 1 %}
      <a href="/admin/leads?page={{ unassigned.page - 1 }}" hx-get="/admin/leads?page={{ unassigned.page - 1 }}" hx-target="#lead-list" class="text-xs text-accent hover:underline">{{ "Previous" | t }}</a>
      {% endif %}
      {% if unassigned.page < unassigned.totalPages %}
      <a href="/admin/leads?page={{ unassigned.page + 1 }}" hx-get="/admin/leads?page={{ unassigned.page + 1 }}" hx-target="#lead-list" class="text-xs text-accent hover:underline">{{ "Next" | t }}</a>
      {% endif %}
    </div>
  </div>
  {% else %}
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ unassigned.leads.length }} {{ "of" | t }} {{ unassigned.total }}
  </div>
  {% endif %}
</div>
{% endif %}

{% if all.length > 0 %}
<div>
  <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "All Leads" | t }}</h2>
  {{ leadTable(all) }}
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ all.length }} {{ "leads" | t }}
  </div>
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No leads." | t }}</p>
{% endif %}
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2 && npm test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2
git add src/domains/admin/admin.router.ts \
        src/views/pages/admin/leads.njk \
        src/views/partials/admin/lead-list.njk
git commit -m "feat: show all leads section on admin leads page"
```
