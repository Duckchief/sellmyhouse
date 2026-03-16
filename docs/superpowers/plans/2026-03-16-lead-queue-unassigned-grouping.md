# Lead Queue Unassigned Grouping Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the Lead Queue page into an "Unassigned Leads" section at the top and an "All Leads" section below, shown only when unassigned leads exist.

**Architecture:** Add a `LeadQueueResult` type returning `{ unassigned, all }` arrays from the service; the repo already fetches `agentId`; the template conditionally renders two sections.

**Tech Stack:** TypeScript, Prisma, Express, Nunjucks, Tailwind CSS

---

## Chunk 1: Types and Service

### Task 1: Update `LeadQueueItem` and add `LeadQueueResult` type

**Files:**
- Modify: `src/domains/agent/agent.types.ts`

- [ ] **Step 1: Add `agentId` to `LeadQueueItem` and define `LeadQueueResult`**

In `src/domains/agent/agent.types.ts`, update `LeadQueueItem` and add `LeadQueueResult`:

```typescript
export interface LeadQueueItem {
  id: string;
  name: string;
  phone: string;
  leadSource: LeadSource | null;
  createdAt: Date;
  timeSinceCreation: number; // milliseconds
  welcomeNotificationSent: boolean;
  agentId: string | null;
}

export interface LeadQueueResult {
  unassigned: LeadQueueItem[];
  all: LeadQueueItem[];
}
```

---

### Task 2: Update `getLeadQueue` service to return partitioned result

**Files:**
- Modify: `src/domains/agent/agent.service.ts`
- Test: `src/domains/agent/__tests__/agent.service.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/domains/agent/__tests__/agent.service.test.ts`, replace the existing `describe('getLeadQueue', ...)` block with:

```typescript
describe('getLeadQueue', () => {
  it('partitions leads into unassigned and all arrays', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    mockRepo.getLeadQueue.mockResolvedValue([
      {
        id: 'seller-1',
        name: 'John Tan',
        phone: '91234567',
        leadSource: 'website',
        createdAt: twoHoursAgo,
        agentId: null,
        status: 'lead',
      } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
      {
        id: 'seller-2',
        name: 'Mary Lim',
        phone: '98765432',
        leadSource: 'tiktok',
        createdAt: oneHourAgo,
        agentId: 'agent-1',
        status: 'lead',
      } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
    ]);
    mockRepo.getWelcomeNotificationStatus.mockResolvedValue(
      new Map([['seller-1', true], ['seller-2', false]]),
    );

    const result = await agentService.getLeadQueue('agent-1');

    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].id).toBe('seller-1');
    expect(result.unassigned[0].agentId).toBeNull();
    expect(result.all).toHaveLength(2);
    expect(result.all[0].id).toBe('seller-1');
    expect(result.all[1].id).toBe('seller-2');
  });

  it('returns empty unassigned when all leads are assigned', async () => {
    const now = new Date();
    mockRepo.getLeadQueue.mockResolvedValue([
      {
        id: 'seller-1',
        name: 'John Tan',
        phone: '91234567',
        leadSource: null,
        createdAt: now,
        agentId: 'agent-1',
        status: 'lead',
      } as unknown as Awaited<ReturnType<typeof agentRepo.getLeadQueue>>[0],
    ]);
    mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map([['seller-1', false]]));

    const result = await agentService.getLeadQueue('agent-1');

    expect(result.unassigned).toHaveLength(0);
    expect(result.all).toHaveLength(1);
  });

  it('returns both empty arrays when no leads exist', async () => {
    mockRepo.getLeadQueue.mockResolvedValue([]);
    mockRepo.getWelcomeNotificationStatus.mockResolvedValue(new Map());

    const result = await agentService.getLeadQueue();

    expect(result.unassigned).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/domains/agent/__tests__/agent.service.test.ts --testNamePattern "getLeadQueue" --no-coverage 2>&1 | tail -20`
Expected: FAIL — `result.unassigned` is not defined (current service returns an array, not an object)

- [ ] **Step 3: Update `getLeadQueue` in the service**

In `src/domains/agent/agent.service.ts`, replace the `getLeadQueue` function:

```typescript
export async function getLeadQueue(agentId?: string): Promise<LeadQueueResult> {
  const leads = await agentRepo.getLeadQueue(agentId);
  const sellerIds = leads.map((l) => l.id);
  const notificationMap = await agentRepo.getWelcomeNotificationStatus(sellerIds);

  const now = Date.now();
  const all: LeadQueueItem[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt,
    timeSinceCreation: now - lead.createdAt.getTime(),
    welcomeNotificationSent: notificationMap.get(lead.id) ?? false,
    agentId: lead.agentId,
  }));

  const unassigned = all.filter((l) => l.agentId === null);

  return { unassigned, all };
}
```

Also update the import in `agent.service.ts` to include `LeadQueueResult`:

```typescript
import type {
  PipelineOverview,
  LeadQueueItem,
  LeadQueueResult,
  SellerListFilter,
  SellerListResult,
  SellerDetail,
  ComplianceStatus,
  NotificationHistoryItem,
} from './agent.types';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/domains/agent/__tests__/agent.service.test.ts --no-coverage 2>&1 | tail -20`
Expected: All tests in this file PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.service.ts src/domains/agent/__tests__/agent.service.test.ts
git commit -m "feat: partition lead queue into unassigned and all arrays"
```

---

## Chunk 2: Router and Template

### Task 3: Update the `/agent/leads` route handler

**Files:**
- Modify: `src/domains/agent/agent.router.ts`

- [ ] **Step 1: Update the router test mock**

In `src/domains/agent/__tests__/agent.router.test.ts`, the `GET /agent/leads` test mocks `getLeadQueue` returning an array. Update the mock to return the new shape:

```typescript
mockService.getLeadQueue.mockResolvedValue({ unassigned: [], all: [] });
```

- [ ] **Step 2: Update the route handler to pass `unassigned` and `all`**

In `src/domains/agent/agent.router.ts`, locate the `agentRouter.get('/agent/leads', ...)` handler and replace it:

```typescript
agentRouter.get(
  '/agent/leads',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { unassigned, all } = await agentService.getLeadQueue(getAgentFilter(user));

      if (req.headers['hx-request']) {
        return res.render('partials/agent/lead-queue', { unassigned, all });
      }
      res.render('pages/agent/leads', { unassigned, all });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build 2>&1 | grep -E "error TS" | head -20`
Expected: No TypeScript errors

- [ ] **Step 4: Run all agent tests**

Run: `npx jest src/domains/agent/ --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat: pass unassigned and all arrays to lead queue template"
```

---

### Task 4: Update the lead queue template

**Files:**
- Modify: `src/views/partials/agent/lead-queue.njk`

The table macro below is reused in both sections to avoid duplicating the full table HTML.

- [ ] **Step 1: Rewrite `lead-queue.njk`**

Replace the entire contents of `src/views/partials/agent/lead-queue.njk`:

```nunjucks
{% macro leadTable(leads) %}
<div class="bg-white rounded-lg shadow overflow-hidden">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Phone" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Source" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Time" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Notified" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-200">
      {% for lead in leads %}
      <tr class="hover:bg-gray-50 cursor-pointer" data-action="navigate" data-url="/agent/sellers/{{ lead.id }}">
        <td class="px-4 py-3 text-sm font-medium">{{ lead.name }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.phone }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.leadSource or "—" }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.createdAt }}</td>
        <td class="px-4 py-3 text-sm">
          {% if lead.welcomeNotificationSent %}
          <span class="text-green-600">✓</span>
          {% else %}
          <span class="text-gray-300">—</span>
          {% endif %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>
{% endmacro %}

{% if all.length == 0 %}
<div class="text-gray-500 py-8 text-center">{{ "No new leads" | t }}</div>

{% elif unassigned.length > 0 %}
<div class="space-y-6">
  <div>
    <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "Unassigned Leads" | t }}</h2>
    {{ leadTable(unassigned) }}
  </div>
  <div>
    <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "All Leads" | t }}</h2>
    {{ leadTable(all) }}
  </div>
</div>

{% else %}
{{ leadTable(all) }}
{% endif %}
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build 2>&1 | grep -E "error TS" | head -20`
Expected: No TypeScript errors

- [ ] **Step 3: Run all agent tests**

Run: `npx jest src/domains/agent/ --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 4: Run the full unit test suite**

Run: `npm test -- --no-coverage 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/agent/lead-queue.njk
git commit -m "feat: render unassigned leads section at top of lead queue"
```
