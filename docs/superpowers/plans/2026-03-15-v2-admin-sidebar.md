# V2 Admin Sidebar & Missing Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port V1's admin sidebar navigation structure into V2 and build the 5 missing pages (Pipeline, Leads, Review Queue, Notifications, Audit Log).

**Architecture:** Modify the existing admin layout sidebar to use a two-section layout (Operations + Admin). Add repository methods, service methods, routes, page templates, and HTMX partials for each new page. All new routes go through `admin.router.ts` with existing `adminAuth` middleware.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS

---

## File Structure

### New files:
| File | Responsibility |
|------|---------------|
| `src/views/pages/admin/pipeline.njk` | Pipeline page — admin view of all sellers by stage |
| `src/views/pages/admin/leads.njk` | Leads page — unassigned lead queue |
| `src/views/pages/admin/review-queue.njk` | Review queue page — pending content reviews |
| `src/views/pages/admin/notifications.njk` | Notifications page — notification history |
| `src/views/pages/admin/audit-log.njk` | Audit log page — filterable audit trail |
| `src/views/partials/admin/pipeline-table.njk` | HTMX partial — pipeline table content |
| `src/views/partials/admin/lead-list.njk` | HTMX partial — lead list table |
| `src/views/partials/admin/review-list.njk` | HTMX partial — review queue items |
| `src/views/partials/admin/notification-list.njk` | HTMX partial — notification table |
| `src/views/partials/admin/audit-list.njk` | HTMX partial — audit log table |

### Modified files:
| File | Changes |
|------|---------|
| `src/views/layouts/admin.njk` | Two-section sidebar with all menu items + active state |
| `src/domains/admin/admin.types.ts` | Add NotificationFilter, AuditLogFilter, ReviewItem, LeadListResult, PipelineSeller types |
| `src/domains/admin/admin.repository.ts` | Add findUnassignedLeads, countUnassignedLeads, getReviewQueue, getPipelineForAdmin |
| `src/domains/admin/admin.service.ts` | Add getUnassignedLeads, getReviewQueue, getNotifications, getAuditLog, exportAuditLogCsv, getAdminPipeline |
| `src/domains/admin/admin.router.ts` | Add 6 new route handlers |
| `src/domains/notification/notification.repository.ts` | Add findMany method for admin listing |
| `src/domains/shared/audit.repository.ts` | Add findMany and exportAll methods |

---

## Chunk 1: Types, Sidebar, and Foundation

### Task 1: Add new types to admin.types.ts

**Files:**
- Modify: `src/domains/admin/admin.types.ts`

- [ ] **Step 1: Add the new type definitions**

Append these types to the end of `src/domains/admin/admin.types.ts`:

```typescript
export interface NotificationFilter {
  channel?: 'whatsapp' | 'email' | 'in_app';
  status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface AuditLogFilter {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface ReviewItem {
  type: 'listing' | 'report';
  sellerId: string | undefined;
  sellerName: string | undefined;
  property: string;
  submittedAt: Date;
  reviewUrl: string;
}

export interface LeadListResult {
  leads: Array<{
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    leadSource: string | null;
    createdAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminPipelineStage {
  status: string;
  count: number;
  sellers: Array<{
    id: string;
    name: string;
    phone: string | null;
    town: string | null;
    agentName: string | null;
    askingPrice: number | null;
    status: string;
  }>;
}

export interface AdminPipelineResult {
  stages: AdminPipelineStage[];
  totalSellers: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.types.ts
git commit -m "feat(admin): add types for pipeline, leads, review, notifications, audit log"
```

---

### Task 2: Update admin sidebar layout

**Files:**
- Modify: `src/views/layouts/admin.njk`

- [ ] **Step 1: Replace the sidebar navigation**

Replace the entire `<nav class="space-y-1">` block inside the `<aside>` element with the two-section sidebar. The current sidebar nav section looks like this:

```njk
    <nav class="space-y-1">
      <a href="/admin/dashboard" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Dashboard" | t }}</a>
      <a href="/admin/team" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Team" | t }}</a>
      <a href="/admin/sellers" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Sellers" | t }}</a>
      <a href="/admin/settings" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Settings" | t }}</a>
      <a href="/admin/hdb" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "HDB Data" | t }}</a>
      <a href="/admin/tutorials" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Tutorials" | t }}</a>
      <a href="/admin/content/market" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Market Content" | t }}</a>
      <a href="/admin/content/testimonials" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Testimonials" | t }}</a>
      <a href="/admin/content/referrals" class="block px-3 py-2 rounded hover:bg-white/10 text-sm">{{ "Referrals" | t }}</a>
    </nav>
```

Replace with:

```njk
    <nav class="space-y-1 flex-1">
      <a href="/admin/pipeline" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Pipeline" | t }}</a>
      <a href="/admin/leads" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/leads' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Leads" | t }}</a>
      <a href="/admin/review" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/review' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Review Queue" | t }}</a>
      <a href="/admin/compliance/deletion-queue" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/compliance/deletion-queue' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Compliance" | t }}</a>
      <a href="/admin/notifications" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/notifications' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Notifications" | t }}</a>
      <a href="/admin/content/market" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/market' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Market Content" | t }}</a>
      <a href="/admin/content/testimonials" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/testimonials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Testimonials" | t }}</a>
      <a href="/admin/content/referrals" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/content/referrals' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Referrals" | t }}</a>

      <div class="border-t border-white/10 my-3"></div>
      <p class="px-3 py-1 text-xs text-gray-400 uppercase tracking-wider">{{ "Admin" | t }}</p>

      <a href="/admin/team" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/team' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Team" | t }}</a>
      <a href="/admin/sellers" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/sellers' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "All Sellers" | t }}</a>
      <a href="/admin/dashboard" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/dashboard' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Analytics" | t }}</a>
      <a href="/admin/settings" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/settings' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Settings" | t }}</a>
      <a href="/admin/audit" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/audit' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Audit Log" | t }}</a>
      <a href="/admin/hdb" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/hdb' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "HDB Data" | t }}</a>
      <a href="/admin/tutorials" class="block px-3 py-2 rounded text-sm {% if currentPath == '/admin/tutorials' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ "Tutorials" | t }}</a>
    </nav>
    <div class="mt-auto pt-4 border-t border-white/10">
      <a href="/auth/logout" class="block px-3 py-2 text-sm text-red-400 hover:text-red-300">{{ "Sign Out" | t }}</a>
    </div>
```

- [ ] **Step 2: Update existing admin route handlers to pass currentPath**

Every existing route handler in `admin.router.ts` that calls `res.render()` for a full page (not an HTMX partial) needs to pass `currentPath` in the render context. For example, the dashboard route's `res.render('pages/admin/dashboard', { analytics })` becomes `res.render('pages/admin/dashboard', { analytics, currentPath: '/admin/dashboard' })`.

The routes to update (existing ones only — new routes will include it from the start):

| Route | currentPath value |
|-------|------------------|
| `GET /admin/dashboard` | `'/admin/dashboard'` |
| `GET /admin/team` | `'/admin/team'` |
| `GET /admin/sellers` | `'/admin/sellers'` |
| `GET /admin/settings` | `'/admin/settings'` |
| `GET /admin/hdb` | `'/admin/hdb'` |
| `GET /admin/tutorials` | `'/admin/tutorials'` |
| `GET /admin/tutorials/new` | `'/admin/tutorials'` |
| `GET /admin/tutorials/:id/edit` | `'/admin/tutorials'` |
| `GET /admin/content/market` | `'/admin/content/market'` |
| `GET /admin/content/market/:id` | `'/admin/content/market'` |
| `GET /admin/content/testimonials` | `'/admin/content/testimonials'` |
| `GET /admin/content/referrals` | `'/admin/content/referrals'` |
| `GET /admin/compliance/deletion-queue` | `'/admin/compliance/deletion-queue'` |
| `GET /admin/team/:id/pipeline` | `'/admin/team'` |

For each `res.render('pages/admin/...',  { ... })` call, add `currentPath: '/admin/...'` to the data object.

- [ ] **Step 3: Verify the app builds and existing tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No TypeScript errors, all existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/views/layouts/admin.njk src/domains/admin/admin.router.ts
git commit -m "feat(admin): update sidebar to V1 two-section layout with active states"
```

---

## Chunk 2: Pipeline & Leads Pages

### Task 3: Add pipeline repository method

**Files:**
- Modify: `src/domains/admin/admin.repository.ts`
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/domains/admin/__tests__/admin.service.test.ts`:

```typescript
describe('getAdminPipeline', () => {
  it('returns stages grouped by seller status', async () => {
    mockRepo.getPipelineForAdmin.mockResolvedValue([
      {
        id: 's1', name: 'Alice', phone: '91234567', status: 'lead',
        agent: { name: 'Agent A' },
        properties: [{ town: 'TAMPINES', askingPrice: new Decimal(500000) }],
      },
      {
        id: 's2', name: 'Bob', phone: '91234568', status: 'active',
        agent: null,
        properties: [],
      },
    ]);

    const result = await adminService.getAdminPipeline();
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe('lead');
    expect(result.stages[0].sellers[0].agentName).toBe('Agent A');
    expect(result.stages[0].sellers[0].town).toBe('TAMPINES');
    expect(result.stages[1].status).toBe('active');
    expect(result.totalSellers).toBe(2);
  });
});
```

Note: The test file already mocks the admin repository. Add `getPipelineForAdmin` to the existing mock setup. The test imports will need `Decimal` from `@prisma/client/runtime/library` (or use a mock).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getAdminPipeline" --no-coverage`
Expected: FAIL — `getPipelineForAdmin` is not a function

- [ ] **Step 3: Add repository method**

Add to `src/domains/admin/admin.repository.ts`:

```typescript
export async function getPipelineForAdmin(stage?: string) {
  const where: Record<string, unknown> = {};
  if (stage) where.status = stage;

  return prisma.seller.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      agent: { select: { name: true } },
      properties: { take: 1, select: { town: true, askingPrice: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 4: Add service method**

Add to `src/domains/admin/admin.service.ts`:

```typescript
import type { AdminPipelineResult, AdminPipelineStage } from './admin.types';

export async function getAdminPipeline(stage?: string): Promise<AdminPipelineResult> {
  const sellers = await adminRepo.getPipelineForAdmin(stage);

  const stageMap = new Map<string, AdminPipelineStage>();
  const stageOrder = ['lead', 'engaged', 'active', 'completed', 'archived'];

  for (const s of sellers) {
    const key = s.status;
    if (!stageMap.has(key)) {
      stageMap.set(key, { status: key, count: 0, sellers: [] });
    }
    const stageEntry = stageMap.get(key)!;
    stageEntry.count++;
    stageEntry.sellers.push({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      agentName: s.agent?.name ?? null,
      askingPrice: s.properties[0]?.askingPrice ? Number(s.properties[0].askingPrice) : null,
      status: s.status,
    });
  }

  const stages = stageOrder
    .filter((status) => stageMap.has(status))
    .map((status) => stageMap.get(status)!);

  return { stages, totalSellers: sellers.length };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getAdminPipeline" --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.repository.ts src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add pipeline repository and service methods"
```

---

### Task 4: Add pipeline route + templates

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/pipeline.njk`
- Create: `src/views/partials/admin/pipeline-table.njk`

- [ ] **Step 1: Add the pipeline route**

Add to `src/domains/admin/admin.router.ts`, after the existing dashboard route:

```typescript
// ─── Pipeline ────────────────────────────────────────────────
adminRouter.get(
  '/admin/pipeline',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stage = req.query['stage'] as string | undefined;
      const pipeline = await adminService.getAdminPipeline(stage);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/pipeline-table', { pipeline, stage });
      }
      res.render('pages/admin/pipeline', { pipeline, stage, currentPath: '/admin/pipeline' });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Create the pipeline page template**

Create `src/views/pages/admin/pipeline.njk`:

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Pipeline" | t }}</h1>

<div class="flex gap-2 mb-6">
  <a href="/admin/pipeline" hx-get="/admin/pipeline" hx-target="#pipeline-content"
    class="px-3 py-1 rounded text-sm {% if not stage %}bg-accent text-white{% else %}bg-bg-alt text-gray-600 hover:bg-gray-200{% endif %}">
    {{ "All" | t }}
  </a>
  {% set stages = [
    { value: 'lead', label: 'Lead' },
    { value: 'engaged', label: 'Engaged' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'archived', label: 'Archived' }
  ] %}
  {% for s in stages %}
  <a href="/admin/pipeline?stage={{ s.value }}" hx-get="/admin/pipeline?stage={{ s.value }}" hx-target="#pipeline-content"
    class="px-3 py-1 rounded text-sm {% if stage == s.value %}bg-accent text-white{% else %}bg-bg-alt text-gray-600 hover:bg-gray-200{% endif %}">
    {{ s.label | t }}
  </a>
  {% endfor %}
</div>

<div id="pipeline-content">
  {% include "partials/admin/pipeline-table.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 3: Create the pipeline table partial**

Create `src/views/partials/admin/pipeline-table.njk`:

```njk
{% if pipeline.stages.length > 0 %}
  {% for stageData in pipeline.stages %}
  <div class="mb-8">
    <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
      {{ stageData.status | capitalize }}
      <span class="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">{{ stageData.count }}</span>
    </h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">{{ "Name" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Phone" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Town" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Agent" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Asking Price" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          {% for seller in stageData.sellers %}
          <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 font-medium">{{ seller.name }}</td>
            <td class="px-4 py-3 text-gray-600">{{ seller.phone or '-' }}</td>
            <td class="px-4 py-3 text-gray-600">{{ seller.town or '-' }}</td>
            <td class="px-4 py-3 text-gray-600">
              {% if seller.agentName %}{{ seller.agentName }}{% else %}<span class="text-amber-600">{{ "Unassigned" | t }}</span>{% endif %}
            </td>
            <td class="px-4 py-3 text-gray-600">
              {% if seller.askingPrice %}${{ seller.askingPrice | formatPrice }}{% else %}-{% endif %}
            </td>
            <td class="px-4 py-3">
              <a href="/admin/sellers" class="text-xs text-accent hover:underline">{{ "View" | t }}</a>
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </div>
  {% endfor %}
  <p class="text-xs text-gray-500">{{ "Total:" | t }} {{ pipeline.totalSellers }} {{ "sellers" | t }}</p>
{% else %}
  <p class="text-gray-400 text-sm">{{ "No sellers in pipeline." | t }}</p>
{% endif %}
```

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/views/pages/admin/pipeline.njk src/views/partials/admin/pipeline-table.njk
git commit -m "feat(admin): add pipeline page with stage filtering"
```

---

### Task 5: Add leads repository and service methods

**Files:**
- Modify: `src/domains/admin/admin.repository.ts`
- Modify: `src/domains/admin/admin.service.ts`
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/domains/admin/__tests__/admin.service.test.ts`:

```typescript
describe('getUnassignedLeads', () => {
  it('returns paginated unassigned leads', async () => {
    mockRepo.findUnassignedLeads.mockResolvedValue([
      { id: 's1', name: 'Alice', phone: '91234567', status: 'lead', leadSource: 'website', createdAt: new Date(), properties: [{ town: 'TAMPINES' }] },
    ]);
    mockRepo.countUnassignedLeads.mockResolvedValue(1);

    const result = await adminService.getUnassignedLeads(1);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].town).toBe('TAMPINES');
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getUnassignedLeads" --no-coverage`
Expected: FAIL

- [ ] **Step 3: Add repository methods**

Add to `src/domains/admin/admin.repository.ts`:

```typescript
export async function findUnassignedLeads(page = 1, limit = 25) {
  return prisma.seller.findMany({
    where: { status: 'lead', agentId: null },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      leadSource: true,
      createdAt: true,
      properties: { take: 1, select: { town: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function countUnassignedLeads(): Promise<number> {
  return prisma.seller.count({ where: { status: 'lead', agentId: null } });
}
```

- [ ] **Step 4: Add service method**

Add to `src/domains/admin/admin.service.ts`:

```typescript
import type { LeadListResult } from './admin.types';

export async function getUnassignedLeads(page?: number): Promise<LeadListResult> {
  const currentPage = page ?? 1;
  const limit = 25;
  const [sellers, total] = await Promise.all([
    adminRepo.findUnassignedLeads(currentPage, limit),
    adminRepo.countUnassignedLeads(),
  ]);

  return {
    leads: sellers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      town: s.properties[0]?.town ?? null,
      leadSource: s.leadSource,
      createdAt: s.createdAt,
    })),
    total,
    page: currentPage,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getUnassignedLeads" --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.repository.ts src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add unassigned leads repository and service methods"
```

---

### Task 6: Add leads route + templates

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/leads.njk`
- Create: `src/views/partials/admin/lead-list.njk`

- [ ] **Step 1: Add the leads route**

Add to `src/domains/admin/admin.router.ts`:

```typescript
// ─── Leads ───────────────────────────────────────────────────
adminRouter.get(
  '/admin/leads',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined;
      const result = await adminService.getUnassignedLeads(page);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/lead-list', { result });
      }
      res.render('pages/admin/leads', { result, currentPath: '/admin/leads' });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Create the leads page template**

Create `src/views/pages/admin/leads.njk`:

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Unassigned Leads" | t }}</h1>
<div id="action-result" class="mb-4"></div>
<div id="modal-container"></div>
<div id="lead-list">
  {% include "partials/admin/lead-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 3: Create the lead list partial**

Create `src/views/partials/admin/lead-list.njk`:

```njk
{% if result and result.leads.length > 0 %}
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
      {% for lead in result.leads %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-medium">{{ lead.name }}</td>
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
  {% if result.totalPages > 1 %}
  <div class="flex justify-between items-center mt-4 px-4">
    <span class="text-xs text-gray-500">{{ "Page" | t }} {{ result.page }} {{ "of" | t }} {{ result.totalPages }} ({{ result.total }} {{ "total" | t }})</span>
    <div class="flex gap-2">
      {% if result.page > 1 %}
      <a href="/admin/leads?page={{ result.page - 1 }}" hx-get="/admin/leads?page={{ result.page - 1 }}" hx-target="#lead-list" class="text-xs text-accent hover:underline">{{ "Previous" | t }}</a>
      {% endif %}
      {% if result.page < result.totalPages %}
      <a href="/admin/leads?page={{ result.page + 1 }}" hx-get="/admin/leads?page={{ result.page + 1 }}" hx-target="#lead-list" class="text-xs text-accent hover:underline">{{ "Next" | t }}</a>
      {% endif %}
    </div>
  </div>
  {% else %}
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ result.leads.length }} {{ "of" | t }} {{ result.total }}
  </div>
  {% endif %}
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No unassigned leads." | t }}</p>
{% endif %}
```

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/views/pages/admin/leads.njk src/views/partials/admin/lead-list.njk
git commit -m "feat(admin): add leads page with assign workflow"
```

---

## Chunk 3: Review Queue & Notifications Pages

### Task 7: Add review queue repository and service methods

**Files:**
- Modify: `src/domains/admin/admin.repository.ts`
- Modify: `src/domains/admin/admin.service.ts`
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/domains/admin/__tests__/admin.service.test.ts`:

```typescript
describe('getReviewQueue', () => {
  it('returns unified review items sorted by date', async () => {
    const earlyDate = new Date('2026-01-01');
    const lateDate = new Date('2026-02-01');
    mockRepo.getReviewQueue.mockResolvedValue({
      pendingListings: [
        {
          id: 'p1', block: '123', street: 'Tampines St 11', updatedAt: lateDate,
          seller: { id: 's1', name: 'Alice' },
        },
      ],
      pendingReports: [
        {
          id: 'r1', generatedAt: earlyDate,
          transaction: {
            seller: { id: 's2', name: 'Bob' },
            property: { block: '456', street: 'Bedok St 22' },
          },
        },
      ],
    });

    const result = await adminService.getReviewQueue();
    expect(result).toHaveLength(2);
    // Sorted ascending by submittedAt — earlyDate first
    expect(result[0].type).toBe('report');
    expect(result[1].type).toBe('listing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getReviewQueue" --no-coverage`
Expected: FAIL

- [ ] **Step 3: Add repository method**

Add to `src/domains/admin/admin.repository.ts`:

```typescript
export async function getReviewQueue() {
  const [pendingListings, pendingReports] = await Promise.all([
    prisma.property.findMany({
      where: { status: 'pending_review' },
      select: {
        id: true,
        block: true,
        street: true,
        updatedAt: true,
        seller: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.financialReport.findMany({
      where: { approvedAt: null, aiNarrative: { not: null } },
      select: {
        id: true,
        generatedAt: true,
        transaction: {
          select: {
            seller: { select: { id: true, name: true } },
            property: { select: { block: true, street: true } },
          },
        },
      },
      orderBy: { generatedAt: 'asc' },
    }),
  ]);

  return { pendingListings, pendingReports };
}
```

- [ ] **Step 4: Add service method**

Add to `src/domains/admin/admin.service.ts`:

```typescript
import type { ReviewItem } from './admin.types';

export async function getReviewQueue(): Promise<ReviewItem[]> {
  const { pendingListings, pendingReports } = await adminRepo.getReviewQueue();

  const items: ReviewItem[] = [
    ...pendingListings.map((p) => ({
      type: 'listing' as const,
      sellerId: p.seller?.id,
      sellerName: p.seller?.name,
      property: `${p.block} ${p.street}`,
      submittedAt: p.updatedAt,
      reviewUrl: `/agent/sellers/${p.seller?.id}`,
    })),
    ...pendingReports.map((r) => ({
      type: 'report' as const,
      sellerId: r.transaction?.seller?.id,
      sellerName: r.transaction?.seller?.name,
      property: `${r.transaction?.property?.block} ${r.transaction?.property?.street}`,
      submittedAt: r.generatedAt,
      reviewUrl: `/agent/sellers/${r.transaction?.seller?.id}`,
    })),
  ];

  return items.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/domains/admin/__tests__/admin.service.test.ts --testNamePattern="getReviewQueue" --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.repository.ts src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat(admin): add review queue repository and service methods"
```

---

### Task 8: Add review queue route + templates

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/review-queue.njk`
- Create: `src/views/partials/admin/review-list.njk`

- [ ] **Step 1: Add the review queue route**

Add to `src/domains/admin/admin.router.ts`:

```typescript
// ─── Review Queue ────────────────────────────────────────────
adminRouter.get(
  '/admin/review',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await adminService.getReviewQueue();

      if (req.headers['hx-request']) {
        return res.render('partials/admin/review-list', { items });
      }
      res.render('pages/admin/review-queue', { items, currentPath: '/admin/review' });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Create the review queue page template**

Create `src/views/pages/admin/review-queue.njk`:

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Review Queue" | t }}</h1>
<div id="review-list">
  {% include "partials/admin/review-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 3: Create the review list partial**

Create `src/views/partials/admin/review-list.njk`:

```njk
{% if items and items.length > 0 %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Type" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Seller" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Property" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Submitted" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for item in items %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">
          {% if item.type == 'listing' %}
            <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{{ "Listing" | t }}</span>
          {% elif item.type == 'report' %}
            <span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs">{{ "Report" | t }}</span>
          {% endif %}
        </td>
        <td class="px-4 py-3 font-medium">{{ item.sellerName or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">{{ item.property }}</td>
        <td class="px-4 py-3 text-gray-600">{{ item.submittedAt | date }}</td>
        <td class="px-4 py-3">
          <a href="{{ item.reviewUrl }}" class="text-xs text-accent hover:underline">{{ "Review" | t }}</a>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No items pending review." | t }}</p>
{% endif %}
```

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/views/pages/admin/review-queue.njk src/views/partials/admin/review-list.njk
git commit -m "feat(admin): add review queue page"
```

---

### Task 9: Add notification listing repository method

**Files:**
- Modify: `src/domains/notification/notification.repository.ts`

- [ ] **Step 1: Add the findMany method for admin listing**

Add to `src/domains/notification/notification.repository.ts`:

```typescript
import type { Prisma } from '@prisma/client';

export async function findMany(filter: {
  channel?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const where: Prisma.NotificationWhereInput = {};
  if (filter.channel) where.channel = filter.channel as Prisma.EnumNotificationChannelFilter;
  if (filter.status) where.status = filter.status as Prisma.EnumNotificationStatusFilter;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = filter.dateFrom;
    if (filter.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = filter.dateTo;
  }

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total, page, limit, totalPages: Math.ceil(total / limit) };
}
```

Note: The `Prisma` import may already exist (check top of file). If it does, just add the `Prisma` namespace to the existing import. The `prisma` client instance is already imported.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/domains/notification/notification.repository.ts
git commit -m "feat(notification): add findMany method for admin notification listing"
```

---

### Task 10: Add notifications service method and route + templates

**Files:**
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/notifications.njk`
- Create: `src/views/partials/admin/notification-list.njk`

- [ ] **Step 1: Add the service method**

Add to `src/domains/admin/admin.service.ts`:

```typescript
import * as notificationRepo from '@/domains/notification/notification.repository';
import type { NotificationFilter } from './admin.types';

export async function getNotifications(filter: NotificationFilter) {
  return notificationRepo.findMany({
    channel: filter.channel,
    status: filter.status,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    page: filter.page,
    limit: filter.limit,
  });
}
```

- [ ] **Step 2: Add the notifications route**

Add to `src/domains/admin/admin.router.ts`:

```typescript
// ─── Notifications ───────────────────────────────────────────
adminRouter.get(
  '/admin/notifications',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        channel: req.query['channel'] as string | undefined,
        status: req.query['status'] as string | undefined,
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      };
      const result = await adminService.getNotifications(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/notification-list', { result, filter });
      }
      res.render('pages/admin/notifications', { result, filter, currentPath: '/admin/notifications' });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Create the notifications page template**

Create `src/views/pages/admin/notifications.njk`:

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<h1 class="text-2xl font-bold mb-6">{{ "Notifications" | t }}</h1>

<form class="card p-4 flex flex-wrap gap-3 mb-6" hx-get="/admin/notifications" hx-target="#notification-list">
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Channel" | t }}</label>
    <select name="channel" class="border rounded px-3 py-2 text-sm">
      <option value="">{{ "All" | t }}</option>
      <option value="whatsapp" {% if filter.channel == 'whatsapp' %}selected{% endif %}>WhatsApp</option>
      <option value="email" {% if filter.channel == 'email' %}selected{% endif %}>Email</option>
      <option value="in_app" {% if filter.channel == 'in_app' %}selected{% endif %}>In-App</option>
    </select>
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Status" | t }}</label>
    <select name="status" class="border rounded px-3 py-2 text-sm">
      <option value="">{{ "All" | t }}</option>
      <option value="pending" {% if filter.status == 'pending' %}selected{% endif %}>Pending</option>
      <option value="sent" {% if filter.status == 'sent' %}selected{% endif %}>Sent</option>
      <option value="delivered" {% if filter.status == 'delivered' %}selected{% endif %}>Delivered</option>
      <option value="failed" {% if filter.status == 'failed' %}selected{% endif %}>Failed</option>
    </select>
  </div>
  <div class="flex items-end">
    <button type="submit" class="btn-primary px-4 py-2 text-sm">{{ "Filter" | t }}</button>
  </div>
</form>

<div id="notification-list">
  {% include "partials/admin/notification-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 4: Create the notification list partial**

Create `src/views/partials/admin/notification-list.njk`:

```njk
{% if result and result.notifications.length > 0 %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Channel" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Template" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Recipient" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Date" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for n in result.notifications %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">
          {% if n.channel == 'whatsapp' %}
            <span class="text-green-600 text-xs font-medium">WhatsApp</span>
          {% elif n.channel == 'email' %}
            <span class="text-blue-600 text-xs font-medium">Email</span>
          {% else %}
            <span class="text-gray-600 text-xs font-medium">In-App</span>
          {% endif %}
        </td>
        <td class="px-4 py-3 text-gray-600">{{ n.templateName }}</td>
        <td class="px-4 py-3 text-gray-600">
          <span class="capitalize">{{ n.recipientType }}</span>
          <span class="text-xs text-gray-400">{{ n.recipientId | truncate(12) }}</span>
        </td>
        <td class="px-4 py-3">
          {% if n.status == 'pending' %}
            <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{{ "Pending" | t }}</span>
          {% elif n.status == 'sent' %}
            <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{{ "Sent" | t }}</span>
          {% elif n.status == 'delivered' %}
            <span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">{{ "Delivered" | t }}</span>
          {% elif n.status == 'failed' %}
            <span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">{{ "Failed" | t }}</span>
          {% elif n.status == 'read' %}
            <span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs">{{ "Read" | t }}</span>
          {% endif %}
        </td>
        <td class="px-4 py-3 text-gray-600">{{ n.createdAt | date }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% if result.totalPages > 1 %}
  <div class="flex justify-between items-center mt-4 px-4">
    <span class="text-xs text-gray-500">{{ "Page" | t }} {{ result.page }} {{ "of" | t }} {{ result.totalPages }} ({{ result.total }} {{ "total" | t }})</span>
    <div class="flex gap-2">
      {% if result.page > 1 %}
      <a href="/admin/notifications?page={{ result.page - 1 }}&channel={{ filter.channel or '' }}&status={{ filter.status or '' }}"
         hx-get="/admin/notifications?page={{ result.page - 1 }}&channel={{ filter.channel or '' }}&status={{ filter.status or '' }}"
         hx-target="#notification-list" class="text-xs text-accent hover:underline">{{ "Previous" | t }}</a>
      {% endif %}
      {% if result.page < result.totalPages %}
      <a href="/admin/notifications?page={{ result.page + 1 }}&channel={{ filter.channel or '' }}&status={{ filter.status or '' }}"
         hx-get="/admin/notifications?page={{ result.page + 1 }}&channel={{ filter.channel or '' }}&status={{ filter.status or '' }}"
         hx-target="#notification-list" class="text-xs text-accent hover:underline">{{ "Next" | t }}</a>
      {% endif %}
    </div>
  </div>
  {% else %}
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ result.notifications.length }} {{ "of" | t }} {{ result.total }}
  </div>
  {% endif %}
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No notifications found." | t }}</p>
{% endif %}
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/admin.router.ts src/views/pages/admin/notifications.njk src/views/partials/admin/notification-list.njk
git commit -m "feat(admin): add notifications page with channel/status filters"
```

---

## Chunk 4: Audit Log Page & Verification

### Task 11: Add audit log repository methods

**Files:**
- Modify: `src/domains/shared/audit.repository.ts`

- [ ] **Step 1: Add findMany and exportAll methods**

Add to `src/domains/shared/audit.repository.ts`:

```typescript
export async function findMany(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' };
  if (filter.entityType) where.entityType = { contains: filter.entityType, mode: 'insensitive' };
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = filter.dateFrom;
    if (filter.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = filter.dateTo;
  }

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function exportAll(filter: {
  action?: string;
  entityType?: string;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.action) where.action = { contains: filter.action, mode: 'insensitive' };
  if (filter.entityType) where.entityType = { contains: filter.entityType, mode: 'insensitive' };
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = filter.dateFrom;
    if (filter.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = filter.dateTo;
  }

  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
}
```

Also add the `Prisma` import at the top of the file:

```typescript
import { Prisma } from '@prisma/client';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/domains/shared/audit.repository.ts
git commit -m "feat(audit): add findMany and exportAll repository methods"
```

---

### Task 12: Add audit log service methods, route, and templates

**Files:**
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/audit-log.njk`
- Create: `src/views/partials/admin/audit-list.njk`

- [ ] **Step 1: Add service methods**

Add to `src/domains/admin/admin.service.ts`:

```typescript
import * as auditRepo from '@/domains/shared/audit.repository';
import type { AuditLogFilter } from './admin.types';

export async function getAuditLog(filter: AuditLogFilter) {
  return auditRepo.findMany({
    action: filter.action,
    entityType: filter.entityType,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    page: filter.page,
    limit: filter.limit,
  });
}

export async function exportAuditLogCsv(filter: AuditLogFilter, adminId: string) {
  const entries = await auditRepo.exportAll({
    action: filter.action,
    entityType: filter.entityType,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
  });

  // Log the export action itself
  await auditService.log({
    agentId: adminId,
    action: 'audit_log.exported',
    entityType: 'AuditLog',
    entityId: 'bulk',
    details: { filter, entryCount: entries.length },
  });

  return entries;
}
```

Note: `auditService` is already imported in the file (used elsewhere). `auditRepo` may need to be imported — check if it's already imported with a different alias. The existing file imports `* as auditService from '@/domains/shared/audit.service'`. Add the repo import as `* as auditRepo from '@/domains/shared/audit.repository'`.

- [ ] **Step 2: Add audit log routes**

Add to `src/domains/admin/admin.router.ts`:

```typescript
// ─── Audit Log ───────────────────────────────────────────────
adminRouter.get(
  '/admin/audit',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter = {
        action: req.query['action'] as string | undefined,
        entityType: req.query['entityType'] as string | undefined,
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      };
      const result = await adminService.getAuditLog(filter);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/audit-list', { result, filter });
      }
      res.render('pages/admin/audit-log', { result, filter, currentPath: '/admin/audit' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Audit Log CSV Export ────────────────────────────────────
adminRouter.get(
  '/admin/audit/export',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const filter = {
        action: req.query['action'] as string | undefined,
        entityType: req.query['entityType'] as string | undefined,
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
      };
      const entries = await adminService.exportAuditLogCsv(filter, user.id);

      const today = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${today}.csv"`);

      // CSV header
      res.write('Timestamp,Action,Entity Type,Entity ID,Agent ID,IP Address,Details\n');

      for (const entry of entries) {
        const details = JSON.stringify(entry.details ?? {}).replace(/"/g, '""');
        res.write(
          `"${entry.createdAt.toISOString()}","${entry.action}","${entry.entityType}","${entry.entityId}","${entry.agentId ?? ''}","${entry.ipAddress ?? ''}","${details}"\n`,
        );
      }

      res.end();
    } catch (err) {
      next(err);
    }
  },
);
```

**Important:** The `/admin/audit/export` route MUST come BEFORE `/admin/audit` in the file, otherwise Express will match `/admin/audit` first and treat `export` as a query. Alternatively, since `/admin/audit/export` is a more specific path, Express will match it correctly if both use `get`. Double-check order: put the export route first.

- [ ] **Step 3: Create the audit log page template**

Create `src/views/pages/admin/audit-log.njk`:

```njk
{% extends "layouts/admin.njk" %}

{% block content %}
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">{{ "Audit Log" | t }}</h1>
  <a href="/admin/audit/export?action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}&dateFrom={{ filter.dateFrom or '' }}&dateTo={{ filter.dateTo or '' }}"
     class="btn-secondary px-4 py-2 text-sm">{{ "Export CSV" | t }}</a>
</div>

<form class="card p-4 flex flex-wrap gap-3 mb-6" hx-get="/admin/audit" hx-target="#audit-list">
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Action" | t }}</label>
    <input type="text" name="action" value="{{ filter.action or '' }}" placeholder="{{ 'e.g. notification.sent' | t }}" class="border rounded px-3 py-2 text-sm" />
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Entity Type" | t }}</label>
    <input type="text" name="entityType" value="{{ filter.entityType or '' }}" placeholder="{{ 'e.g. Seller' | t }}" class="border rounded px-3 py-2 text-sm" />
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Date From" | t }}</label>
    <input type="date" name="dateFrom" value="{{ filter.dateFrom or '' }}" class="border rounded px-3 py-2 text-sm" />
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "Date To" | t }}</label>
    <input type="date" name="dateTo" value="{{ filter.dateTo or '' }}" class="border rounded px-3 py-2 text-sm" />
  </div>
  <div class="flex items-end">
    <button type="submit" class="btn-primary px-4 py-2 text-sm">{{ "Filter" | t }}</button>
  </div>
</form>

<div id="audit-list">
  {% include "partials/admin/audit-list.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 4: Create the audit list partial**

Create `src/views/partials/admin/audit-list.njk`:

```njk
{% if result and result.entries.length > 0 %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Timestamp" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Action" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Entity" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Agent" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "IP" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Details" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for entry in result.entries %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-gray-600 whitespace-nowrap">{{ entry.createdAt | date }}</td>
        <td class="px-4 py-3">
          <span class="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono">{{ entry.action }}</span>
        </td>
        <td class="px-4 py-3 text-gray-600">
          {{ entry.entityType }}
          <span class="text-xs text-gray-400">{{ entry.entityId | truncate(12) }}</span>
        </td>
        <td class="px-4 py-3 text-gray-600">{{ entry.agentId | truncate(12) if entry.agentId else '-' }}</td>
        <td class="px-4 py-3 text-gray-600 text-xs">{{ entry.ipAddress or '-' }}</td>
        <td class="px-4 py-3 text-gray-400 text-xs max-w-xs truncate" title="{{ entry.details | dump }}">
          {{ entry.details | dump | truncate(50) }}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% if result.totalPages > 1 %}
  <div class="flex justify-between items-center mt-4 px-4">
    <span class="text-xs text-gray-500">{{ "Page" | t }} {{ result.page }} {{ "of" | t }} {{ result.totalPages }} ({{ result.total }} {{ "total" | t }})</span>
    <div class="flex gap-2">
      {% if result.page > 1 %}
      <a href="/admin/audit?page={{ result.page - 1 }}&action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}"
         hx-get="/admin/audit?page={{ result.page - 1 }}&action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}"
         hx-target="#audit-list" class="text-xs text-accent hover:underline">{{ "Previous" | t }}</a>
      {% endif %}
      {% if result.page < result.totalPages %}
      <a href="/admin/audit?page={{ result.page + 1 }}&action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}"
         hx-get="/admin/audit?page={{ result.page + 1 }}&action={{ filter.action or '' }}&entityType={{ filter.entityType or '' }}"
         hx-target="#audit-list" class="text-xs text-accent hover:underline">{{ "Next" | t }}</a>
      {% endif %}
    </div>
  </div>
  {% else %}
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ result.entries.length }} {{ "of" | t }} {{ result.total }}
  </div>
  {% endif %}
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No audit log entries found." | t }}</p>
{% endif %}
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/admin.router.ts src/domains/shared/audit.repository.ts src/views/pages/admin/audit-log.njk src/views/partials/admin/audit-list.njk
git commit -m "feat(admin): add audit log page with filtering and CSV export"
```

---

### Task 13: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build CSS**

Run: `npx tailwindcss -i src/views/styles/input.css -o public/css/output.css --minify`
Expected: Build succeeds

- [ ] **Step 4: Verify all new routes are accessible**

Check that `admin.router.ts` includes these new routes:
- `GET /admin/pipeline`
- `GET /admin/leads`
- `GET /admin/review`
- `GET /admin/notifications`
- `GET /admin/audit`
- `GET /admin/audit/export`

- [ ] **Step 5: Verify all existing routes still have currentPath**

Grep `admin.router.ts` for `res.render('pages/admin/` calls and verify each passes `currentPath`.
