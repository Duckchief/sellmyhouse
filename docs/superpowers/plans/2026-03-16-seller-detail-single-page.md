# Seller Detail Single-Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the seller detail page from a tabbed layout to a single-page fieldset stack, loading all data server-side in one request with HTMX-only notification pagination.

**Architecture:** Merge all data fetches into the main route handler using `Promise.all`. Remove the tab HTMX routes (`/timeline`, `/compliance`). Repurpose the `/notifications` route as a pagination-only HTMX endpoint. Replace the tab nav and `#tab-content` div in the template with a vertical stack of `<fieldset>` elements.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS, Jest, Supertest

**Spec:** `docs/superpowers/specs/2026-03-16-seller-detail-single-page-design.md`

---

## Chunk 1: Data Layer

### Task 1: Add `NotificationHistoryResult` type

**Files:**
- Modify: `src/domains/agent/agent.types.ts`

- [ ] **Step 1: Add the type**

Open `src/domains/agent/agent.types.ts`. After the `NotificationHistoryItem` interface (line 149), add:

```ts
export interface NotificationHistoryResult {
  items: NotificationHistoryItem[];
  total: number;
  page: number;
  totalPages: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent/agent.types.ts
git commit -m "feat: add NotificationHistoryResult type"
```

---

### Task 2: Update repository `getNotificationHistory` with pagination

**Files:**
- Modify: `src/domains/agent/agent.repository.ts`

- [ ] **Step 1: Write the failing test**

There is no repository test file for agent. The existing service tests mock the repo, so add a new describe block directly in `src/domains/agent/__tests__/agent.service.test.ts` to test the service delegates correctly to the repo with pagination args. Do that in Task 3 instead — the repo change here is verified through the service test. For now, modify the repo.

Replace the existing `getNotificationHistory` function (lines 366–384 of `agent.repository.ts`):

```ts
export async function getNotificationHistory(
  sellerId: string,
  agentId?: string,
  opts?: { skip?: number; take?: number },
): Promise<{ items: Awaited<ReturnType<typeof prisma.notification.findMany>>; total: number }> {
  // RBAC: verify seller belongs to agent before returning notifications
  if (agentId) {
    const seller = await prisma.seller.findFirst({
      where: { id: sellerId, agentId },
      select: { id: true },
    });
    if (!seller) return { items: [], total: 0 };
  }

  const where = {
    recipientType: 'seller' as const,
    recipientId: sellerId,
  };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts?.skip ?? 0,
      take: opts?.take ?? 10,
    }),
    prisma.notification.count({ where }),
  ]);

  return { items, total };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/agent/agent.repository.ts
git commit -m "feat: add pagination to getNotificationHistory repository"
```

---

### Task 3: Update service `getNotificationHistory` with pagination

**Files:**
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/__tests__/agent.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('getNotificationHistory')` block at the bottom of the `describe('agent.service')` block in `src/domains/agent/__tests__/agent.service.test.ts` (before the final `});`):

```ts
describe('getNotificationHistory', () => {
  it('returns paginated result with items, total, page, totalPages', async () => {
    const item = {
      id: 'n1',
      channel: 'email',
      templateName: 'welcome',
      content: 'Hello',
      status: 'sent',
      sentAt: new Date('2026-01-01'),
      deliveredAt: null,
      createdAt: new Date('2026-01-01'),
    };
    mockRepo.getNotificationHistory.mockResolvedValue({ items: [item], total: 25 });

    const result = await agentService.getNotificationHistory('seller-1', 'agent-1', { page: 2, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('n1');
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(mockRepo.getNotificationHistory).toHaveBeenCalledWith('seller-1', 'agent-1', { skip: 10, take: 10 });
  });

  it('defaults to page 1 with limit 10 when opts omitted', async () => {
    mockRepo.getNotificationHistory.mockResolvedValue({ items: [], total: 0 });

    const result = await agentService.getNotificationHistory('seller-1');

    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(0);
    expect(mockRepo.getNotificationHistory).toHaveBeenCalledWith('seller-1', undefined, { skip: 0, take: 10 });
  });

  it('returns totalPages 1 when total equals limit', async () => {
    mockRepo.getNotificationHistory.mockResolvedValue({ items: [], total: 10 });

    const result = await agentService.getNotificationHistory('seller-1', undefined, { page: 1, limit: 10 });

    expect(result.totalPages).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="agent.service.test" 2>&1 | tail -20
```

Expected: FAIL — `getNotificationHistory` does not yet accept `opts` param.

- [ ] **Step 3: Update the service function**

Replace `getNotificationHistory` in `src/domains/agent/agent.service.ts` (lines 129–144):

```ts
export async function getNotificationHistory(
  sellerId: string,
  agentId?: string,
  opts?: { page?: number; limit?: number },
): Promise<NotificationHistoryResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 10;
  const skip = (page - 1) * limit;

  const { items, total } = await agentRepo.getNotificationHistory(sellerId, agentId, { skip, take: limit });
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items: items.map((n) => ({
      id: n.id,
      channel: n.channel,
      templateName: n.templateName,
      content: n.content,
      status: n.status,
      sentAt: n.sentAt,
      deliveredAt: n.deliveredAt,
      createdAt: n.createdAt,
    })),
    total,
    page,
    totalPages,
  };
}
```

Also add `NotificationHistoryResult` to the existing type import block at the top of `agent.service.ts` (line 5–14). Add it after `NotificationHistoryItem`:

```ts
import type {
  PipelineOverview,
  LeadQueueItem,
  LeadQueueResult,
  SellerListFilter,
  SellerListResult,
  SellerDetail,
  ComplianceStatus,
  NotificationHistoryItem,
  NotificationHistoryResult,  // add this line
} from './agent.types';
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern="agent.service.test" 2>&1 | tail -20
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/agent/agent.service.ts src/domains/agent/__tests__/agent.service.test.ts
git commit -m "feat: add pagination to getNotificationHistory service"
```

---

## Chunk 2: Router Changes

### Task 4: Update `GET /agent/sellers/:id` to load all data in parallel

**Files:**
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/domains/agent/__tests__/agent.router.test.ts`

- [ ] **Step 1: Write the failing tests**

Find the existing `describe('GET /agent/sellers/:id')` block in `agent.router.test.ts` (line 132). Add two new tests inside it after the existing ones:

```ts
it('loads compliance and notifications alongside seller detail', async () => {
  const app = createTestApp({ id: 'agent-1', role: 'agent' });
  mockService.getSellerDetail.mockResolvedValue({
    id: 'seller-1',
    name: 'John',
    status: 'active',
    property: null,
  } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);
  mockService.getComplianceStatus.mockResolvedValue({
    cdd: { status: 'not_started', verifiedAt: null, riskLevel: null, fullName: null, nricLast4: null },
    eaa: { id: null, status: 'not_started', signedAt: null, signedCopyPath: null, expiryDate: null, explanationConfirmedAt: null, explanationMethod: null },
    consent: { service: false, marketing: false, withdrawnAt: null },
    caseFlags: [],
    counterpartyCdd: null,
  } as never);
  mockService.getNotificationHistory.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    totalPages: 0,
  } as never);
  mockService.getTimeline.mockReturnValue([]);

  const res = await request(app).get('/agent/sellers/seller-1');

  expect(res.status).toBe(200);
  expect(mockService.getComplianceStatus).toHaveBeenCalledWith('seller-1', 'agent-1');
  expect(mockService.getNotificationHistory).toHaveBeenCalledWith('seller-1', 'agent-1', { page: 1, limit: 10 });
  expect(mockService.getTimeline).toHaveBeenCalled();
});

it('does not have an HTMX partial path for the main seller detail route', async () => {
  const app = createTestApp({ id: 'agent-1', role: 'agent' });
  mockService.getSellerDetail.mockResolvedValue({
    id: 'seller-1',
    name: 'John',
    status: 'active',
    property: null,
  } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);
  mockService.getComplianceStatus.mockResolvedValue({
    cdd: { status: 'not_started', verifiedAt: null, riskLevel: null, fullName: null, nricLast4: null },
    eaa: { id: null, status: 'not_started', signedAt: null, signedCopyPath: null, expiryDate: null, explanationConfirmedAt: null, explanationMethod: null },
    consent: { service: false, marketing: false, withdrawnAt: null },
    caseFlags: [],
    counterpartyCdd: null,
  } as never);
  mockService.getNotificationHistory.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    totalPages: 0,
  } as never);
  mockService.getTimeline.mockReturnValue([]);

  // Even with HX-Request header, still renders full page (no HTMX partial branch)
  const res = await request(app)
    .get('/agent/sellers/seller-1')
    .set('HX-Request', 'true');

  expect(res.status).toBe(200);
  expect(mockService.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
});
```

- [ ] **Step 2: Run tests to confirm the new tests fail**

```bash
npm test -- --testPathPattern="agent.router.test" 2>&1 | tail -20
```

Expected: FAIL — the two new tests fail because `getComplianceStatus` and `getNotificationHistory` are not yet called. The existing tests in this describe block will still pass (Jest auto-mocks return `undefined` and the render mock swallows all arguments).

- [ ] **Step 3: Update the route handler**

Replace the `GET /agent/sellers/:id` handler body (lines 128–143 of `agent.router.ts`) with:

```ts
async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const sellerId = req.params['id'] as string;
    const agentId = getAgentFilter(user);

    const [seller, compliance, notifications] = await Promise.all([
      agentService.getSellerDetail(sellerId, agentId),
      agentService.getComplianceStatus(sellerId, agentId),
      agentService.getNotificationHistory(sellerId, agentId, { page: 1, limit: 10 }),
    ]);
    const milestones = agentService.getTimeline(seller.property?.status ?? null, null); // synchronous

    res.render('pages/agent/seller-detail', {
      seller,
      compliance,
      notifications,
      milestones,
      sellerId: seller.id,
    });
  } catch (err) {
    next(err);
  }
},
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern="agent.router.test" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat: load all seller detail data in parallel on page load"
```

---

### Task 5: Add notifications pagination route; remove obsolete tab routes

**Files:**
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/domains/agent/__tests__/agent.router.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new describe block in `agent.router.test.ts`:

```ts
describe('GET /agent/sellers/:id/notifications (pagination)', () => {
  it('returns 200 and calls getNotificationHistory with page param', async () => {
    const app = createTestApp({ id: 'agent-1', role: 'agent' });
    mockService.getNotificationHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      totalPages: 3,
    } as never);

    const res = await request(app).get('/agent/sellers/seller-1/notifications?page=2');

    expect(res.status).toBe(200);
    expect(mockService.getNotificationHistory).toHaveBeenCalledWith('seller-1', 'agent-1', { page: 2, limit: 10 });
  });

  it('defaults to page 1 when page param omitted', async () => {
    const app = createTestApp({ id: 'agent-1', role: 'agent' });
    mockService.getNotificationHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      totalPages: 0,
    } as never);

    await request(app).get('/agent/sellers/seller-1/notifications');

    expect(mockService.getNotificationHistory).toHaveBeenCalledWith('seller-1', 'agent-1', { page: 1, limit: 10 });
  });
});

// Note: no tests for removed routes — Express does not return 404 for unregistered
// routes without a fallback handler. The removal is verified by the absence of the
// route in agent.router.ts (confirmed in Step 3) and the full test suite passing.
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="agent.router.test" 2>&1 | tail -20
```

Expected: FAIL — `/timeline` and `/compliance` still return 200, new `/notifications` handler doesn't exist with page parsing.

- [ ] **Step 3: Update the router**

In `agent.router.ts`:

1. **Delete** the entire `GET /agent/sellers/:id/timeline` route block (lines 210–228).
2. **Delete** the entire `GET /agent/sellers/:id/compliance` route block (lines 230–247).
3. **Replace** the entire `GET /agent/sellers/:id/notifications` route block (lines 249–266) with:

```ts
// GET /agent/sellers/:id/notifications — HTMX pagination partial
agentRouter.get(
  '/agent/sellers/:id/notifications',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;

      const notifications = await agentService.getNotificationHistory(
        sellerId,
        getAgentFilter(user),
        { page, limit: 10 },
      );

      res.render('partials/agent/seller-notifications', { notifications, sellerId });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern="agent.router.test" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat: add notifications pagination route; remove timeline and compliance tab routes"
```

---

## Chunk 3: Templates

> Templates are Nunjucks — no unit tests. Verify by running the dev server and loading a seller detail page in the browser.

### Task 6: Update `seller-notifications.njk` with renamed variable and pagination controls

**Files:**
- Modify: `src/views/partials/agent/seller-notifications.njk`

- [ ] **Step 1: Rewrite the partial**

The router passes `{ notifications, sellerId }` where `notifications` is a `NotificationHistoryResult` object (`{ items, total, page, totalPages }`). The partial accesses `notifications.items`, `notifications.page`, etc. — do **not** use a flat `items` variable.

Replace the entire contents of `src/views/partials/agent/seller-notifications.njk` with:

```njk
{% if notifications.items.length == 0 %}
<div class="p-6 text-center text-gray-500 text-sm">{{ "No notifications sent" | t }}</div>
{% else %}
<table class="min-w-full divide-y divide-gray-200">
  <thead class="bg-gray-50">
    <tr>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Channel" | t }}</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Template" | t }}</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Status" | t }}</th>
      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Sent" | t }}</th>
    </tr>
  </thead>
  <tbody class="divide-y divide-gray-200">
    {% for n in notifications.items %}
    <tr>
      <td class="px-4 py-3 text-sm">{{ n.channel }}</td>
      <td class="px-4 py-3 text-sm">{{ n.templateName }}</td>
      <td class="px-4 py-3 text-sm">
        <span class="px-2 py-1 text-xs rounded-full
          {% if n.status == 'delivered' %}bg-green-100 text-green-800
          {% elif n.status == 'sent' %}bg-blue-100 text-blue-800
          {% elif n.status == 'failed' %}bg-red-100 text-red-800
          {% else %}bg-gray-100 text-gray-800{% endif %}">{{ n.status | t }}</span>
      </td>
      <td class="px-4 py-3 text-sm text-gray-500">{{ n.sentAt or n.createdAt }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>
{% endif %}

{% if notifications.totalPages > 1 %}
<div class="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm">
  <span class="text-gray-500">
    {{ "Page" | t }} {{ notifications.page }} {{ "of" | t }} {{ notifications.totalPages }}
    ({{ notifications.total }} {{ "total" | t }})
  </span>
  <div class="flex gap-2">
    {% if notifications.page > 1 %}
    <a hx-get="/agent/sellers/{{ sellerId }}/notifications?page={{ notifications.page - 1 }}"
       hx-target="#notifications-section"
       hx-swap="innerHTML"
       class="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 cursor-pointer">
      {{ "Prev" | t }}
    </a>
    {% endif %}

    {% for p in range(1, notifications.totalPages + 1) %}
    <a hx-get="/agent/sellers/{{ sellerId }}/notifications?page={{ p }}"
       hx-target="#notifications-section"
       hx-swap="innerHTML"
       class="px-3 py-1 border rounded cursor-pointer
         {% if p == notifications.page %}bg-indigo-600 text-white border-indigo-600
         {% else %}text-gray-600 hover:bg-gray-50{% endif %}">
      {{ p }}
    </a>
    {% endfor %}

    {% if notifications.page < notifications.totalPages %}
    <a hx-get="/agent/sellers/{{ sellerId }}/notifications?page={{ notifications.page + 1 }}"
       hx-target="#notifications-section"
       hx-swap="innerHTML"
       class="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 cursor-pointer">
      {{ "Next" | t }}
    </a>
    {% endif %}
  </div>
</div>
{% endif %}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass (templates are not unit-tested).

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/agent/seller-notifications.njk
git commit -m "feat: update notifications partial with pagination controls"
```

---

### Task 7: Rewrite `seller-detail.njk` as single-page fieldset layout; delete `seller-compliance.njk`

**Files:**
- Modify: `src/views/pages/agent/seller-detail.njk`
- Delete: `src/views/partials/agent/seller-compliance.njk`

- [ ] **Step 1: Rewrite `seller-detail.njk`**

Replace the entire contents of `src/views/pages/agent/seller-detail.njk` with:

```njk
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="mb-4">
  <a href="/agent/sellers" class="text-sm text-blue-600 hover:underline">← {{ "Back to Sellers" | t }}</a>
</div>

{% include "partials/agent/seller-header.njk" %}

<div class="space-y-6">

  {# 1. Overview #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Overview" | t }}</legend>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Seller Info" | t }}</h3>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.status }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Lead Source" | t }}</dt><dd>{{ seller.leadSource or "—" }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Onboarding" | t }}</dt><dd>{{ "Step" | t }} {{ seller.onboardingStep }} / 5</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Created" | t }}</dt><dd>{{ seller.createdAt }}</dd></div>
        </dl>
      </div>
      {% if seller.property %}
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Property" | t }}</h3>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Address" | t }}</dt><dd>{{ seller.property.block }} {{ seller.property.street }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Town" | t }}</dt><dd>{{ seller.property.town }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Type" | t }}</dt><dd>{{ seller.property.flatType }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Floor Area" | t }}</dt><dd>{{ seller.property.floorAreaSqm }} sqm</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Asking Price" | t }}</dt><dd>{% if seller.property.askingPrice %}${{ seller.property.askingPrice | formatPrice }}{% else %}{{ "Not set" | t }}{% endif %}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Status" | t }}</dt><dd>{{ seller.property.status }}</dd></div>
        </dl>
      </div>
      {% else %}
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-3">{{ "Property" | t }}</h3>
        <p class="text-gray-500 text-sm">{{ "No property added yet" | t }}</p>
      </div>
      {% endif %}
    </div>
  </fieldset>

  {# 2. Transaction Timeline #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Transaction Timeline" | t }}</legend>
    <div class="space-y-4 mt-2">
      {% for milestone in milestones %}
      <div class="flex items-start gap-3">
        <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0
          {% if milestone.status == 'completed' %}bg-green-500
          {% elif milestone.status == 'current' %}bg-blue-500
          {% else %}bg-gray-300{% endif %}"></div>
        <div>
          <div class="text-sm font-medium {% if milestone.status == 'upcoming' %}text-gray-400{% endif %}">{{ milestone.label | t }}</div>
          <div class="text-xs text-gray-500">{{ milestone.description | t }}</div>
        </div>
      </div>
      {% endfor %}
    </div>
  </fieldset>

  {# 3. CDD Status #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "CDD Status" | t }}</legend>
    <div class="mt-2">
      {% include "partials/agent/compliance-cdd-card.njk" %}
    </div>
  </fieldset>

  {# 4. Estate Agency Agreement #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Estate Agency Agreement" | t }}</legend>
    <div class="mt-2">
      {% include "partials/agent/compliance-eaa-card.njk" %}
    </div>
  </fieldset>

  {# 5. Counterparty CDD — only when active transaction exists #}
  {% if compliance.counterpartyCdd %}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Counterparty CDD" | t }}</legend>
    <div class="mt-2">
      {% include "partials/agent/compliance-counterparty-cdd-card.njk" %}
    </div>
  </fieldset>
  {% endif %}

  {# 6. Consent #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Consent" | t }}</legend>
    <dl class="space-y-2 text-sm mt-2">
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Service" | t }}</dt><dd>{% if compliance.consent.service %}✓{% else %}✗{% endif %}</dd></div>
      <div class="flex justify-between"><dt class="text-gray-500">{{ "Marketing" | t }}</dt><dd>{% if compliance.consent.marketing %}✓{% else %}✗{% endif %}</dd></div>
      {% if compliance.consent.withdrawnAt %}
      <div class="text-xs text-red-500">{{ "Withdrawn:" | t }} {{ compliance.consent.withdrawnAt | date }}</div>
      {% endif %}
    </dl>
  </fieldset>

  {# 7. Case Flags #}
  <fieldset class="border border-gray-200 rounded-lg p-6 bg-white shadow-sm">
    <legend class="px-2 text-base font-semibold text-gray-900">{{ "Case Flags" | t }}</legend>
    <div class="mt-2">
      {% if compliance.caseFlags.length == 0 %}
      <p class="text-sm text-gray-500">{{ "No active flags" | t }}</p>
      {% else %}
      <div class="space-y-2">
        {% for flag in compliance.caseFlags %}
        <div class="text-sm border-l-2 border-yellow-500 pl-3">
          <div class="font-medium">{{ flag.flagType }}</div>
          <div class="text-gray-500">{{ flag.description }}</div>
        </div>
        {% endfor %}
      </div>
      {% endif %}
    </div>
  </fieldset>

  {# 8. Notifications #}
  <fieldset id="notifications-fieldset" class="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
    <legend class="px-2 text-base font-semibold text-gray-900 ml-4 mt-2">{{ "Notifications" | t }}</legend>
    <div id="notifications-section" class="mt-2">
      {% include "partials/agent/seller-notifications.njk" %}
    </div>
  </fieldset>

</div>

{# Modal containers #}
<div id="compliance-modal-container"></div>
{% endblock %}
```

Note: The CDD card and EAA card partials (`compliance-cdd-card.njk`, `compliance-eaa-card.njk`) currently render their own `<div class="bg-white rounded-lg shadow p-6">` wrapper. Since these are now inside a `<fieldset>` that provides the card styling, the inner wrapper will create a double-card effect. To avoid this, wrap the include in a `<div>` and override the inner card's shadow/border in CSS, OR simply accept the minor double-card styling for now (inner card has its own shadow inside the fieldset). The cleanest fix is to let the partials render as-is — the slight extra padding is acceptable.

- [ ] **Step 2: Delete `seller-compliance.njk`**

Use `git rm -f` (force is needed because the file has local modifications):

```bash
git rm -f src/views/partials/agent/seller-compliance.njk
```

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Start dev server and verify manually**

```bash
npm run dev
```

Navigate to a seller detail page. Verify:
- No tab nav visible
- All 8 fieldsets render (Overview, Timeline, CDD Status, EAA, Consent, Case Flags, Notifications)
- Counterparty CDD fieldset only appears for sellers with an active transaction
- Notifications shows up to 10 rows with pagination controls when total > 10
- Clicking pagination links swaps only `#notifications-section` without full page reload
- Status change modal still works (Mark Completed / Archive buttons)
- CDD and EAA action buttons still open modals via `#compliance-modal-container`

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk src/views/partials/agent/seller-notifications.njk
git commit -m "feat: seller detail single-page layout with fieldsets"
```
