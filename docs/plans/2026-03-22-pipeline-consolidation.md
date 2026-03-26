# Pipeline Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `/admin/pipeline` with an enhanced `/admin/sellers` page, add tooltips to status pills on both sellers pages, and delete all pipeline-specific dead code.

**Architecture:** The shared `seller-status-pills.njk` partial gains tooltip markup (affects both agent and admin sellers). The admin `findAllSellers` repo function gains a `properties` select to expose town and asking price. The `/admin/pipeline` route becomes a redirect. All pipeline-specific service/repo/type/view code is deleted.

**Tech Stack:** TypeScript, Prisma, Express, Nunjucks, HTMX, Tailwind CSS, Jest, Supertest

---

### Task 1: Add tooltips to `seller-status-pills.njk`

**Files:**
- Modify: `src/views/partials/shared/seller-status-pills.njk`

No unit tests for Nunjucks partials. Visual verification in Task 6.

**Step 1: Replace the file**

Replace the entire content of `src/views/partials/shared/seller-status-pills.njk` with:

```nunjucks
{#
  Variables required:
    statusCounts   — Record<string, number>  e.g. { lead: 3, engaged: 1, active: 5, ... }
    currentStatus  — string                  the currently active status value, or '' for All
    hxEndpoint     — string                  e.g. '/agent/sellers' or '/admin/sellers'
    formId         — string                  id of the search form (for hx-include)
#}

{% set pillList = [
  { value: '',          label: 'All',       bg: 'bg-gray-50',   ring: 'ring-gray-400',   countColor: 'text-gray-700',   tooltip: 'All sellers currently in your pipeline'                                         },
  { value: 'lead',      label: 'Lead',      bg: 'bg-blue-50',   ring: 'ring-blue-400',   countColor: 'text-blue-700',   tooltip: 'New enquiry received. Not yet contacted or assigned to an agent'             },
  { value: 'engaged',   label: 'Engaged',   bg: 'bg-yellow-50', ring: 'ring-yellow-400', countColor: 'text-yellow-700', tooltip: 'In active consultation. EAA being prepared or signed'                        },
  { value: 'active',    label: 'Active',    bg: 'bg-green-50',  ring: 'ring-green-400',  countColor: 'text-green-700',  tooltip: 'Property listed and transaction in progress. Viewings, offers, OTP'          },
  { value: 'completed', label: 'Completed', bg: 'bg-gray-50',   ring: 'ring-gray-400',   countColor: 'text-gray-700',   tooltip: 'Transaction closed. Commission paid'                                         },
  { value: 'archived',  label: 'Archived',  bg: 'bg-red-50',    ring: 'ring-red-400',    countColor: 'text-red-700',    tooltip: 'Case closed without a completed transaction, or past retention period'       }
] %}

<div class="flex gap-3 mb-4 w-full">
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
    class="relative flex-1 p-6 rounded-lg text-sm font-medium border-0 cursor-pointer transition {{ p.bg }}
      {%- if currentStatus == p.value %} ring-2 ring-offset-1 {{ p.ring }}
      {%- else %} hover:ring-2 hover:ring-offset-1 hover:{{ p.ring }}
      {%- endif %}"
  >
    <div class="absolute top-2 right-2 group">
      <span class="w-4 h-4 rounded-full bg-white bg-opacity-60 text-gray-400 text-xs flex items-center justify-center cursor-default select-none">?</span>
      <div class="absolute bottom-full right-0 mb-2 w-48 bg-gray-900 text-white text-xs rounded px-2 py-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        {{ p.tooltip | t }}
        <div class="absolute top-full right-2 border-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
    <p class="text-xs font-medium text-gray-500 uppercase text-center">{{ p.label | t }}</p>
    <p class="text-2xl font-bold mt-1 text-center {{ p.countColor }}">
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

Key changes from previous version:
- `tooltip` field added to each pill in `pillList`
- `relative` added to button class (needed for absolute tooltip positioning)
- Tooltip `<div>` block added inside each button (identical pattern to `/admin/pipeline` cards)

**Step 2: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add src/views/partials/shared/seller-status-pills.njk && git commit -m "feat(views): add tooltips to seller status pills"
```

---

### Task 2: Add town and asking price to `findAllSellers` in `admin.repository.ts`

**Files:**
- Modify: `src/domains/admin/admin.repository.ts` — `findAllSellers` function

**Step 1: Read the current `findAllSellers` function**

It's at line 175 of `src/domains/admin/admin.repository.ts`. The `select` block currently has no `properties` field and returns `{ sellers, total, page, limit }`.

**Step 2: Update the function**

Inside `findAllSellers`, add `properties` to the Prisma `select`, and map the result to expose `town` and `askingPrice` as top-level fields (converting Prisma Decimal to `number`).

Replace:

```typescript
  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        agentId: true,
        notificationPreference: true,
        consentService: true,
        consentMarketing: true,
        consentTimestamp: true,
        consentWithdrawnAt: true,
        leadSource: true,
        onboardingStep: true,
        twoFactorEnabled: true,
        consultationCompletedAt: true,
        retentionExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  return { sellers, total, page: filter.page ?? 1, limit };
```

With:

```typescript
  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        agentId: true,
        notificationPreference: true,
        consentService: true,
        consentMarketing: true,
        consentTimestamp: true,
        consentWithdrawnAt: true,
        leadSource: true,
        onboardingStep: true,
        twoFactorEnabled: true,
        consultationCompletedAt: true,
        retentionExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        agent: { select: { id: true, name: true } },
        properties: { take: 1, select: { town: true, askingPrice: true } },
      },
    }),
    prisma.seller.count({ where }),
  ]);

  const mappedSellers = sellers.map((s) => ({
    ...s,
    town: s.properties[0]?.town ?? null,
    askingPrice: s.properties[0]?.askingPrice ? Number(s.properties[0].askingPrice) : null,
  }));

  return { sellers: mappedSellers, total, page: filter.page ?? 1, limit };
```

**Step 3: Run the full test suite to check for regressions**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all passing (the existing tests only assert status codes, not field values)

**Step 4: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add src/domains/admin/admin.repository.ts && git commit -m "feat(admin): expose town and asking price in findAllSellers"
```

---

### Task 3: Update `partials/admin/seller-list.njk` to show Phone, Town, Asking Price

**Files:**
- Modify: `src/views/partials/admin/seller-list.njk`

**Step 1: Read the current file**

The current columns are: Seller (name+email), Agent, Status, Actions.

**Step 2: Replace the file**

```nunjucks
{% if result and result.sellers.length > 0 %}
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left">{{ "Seller" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Phone" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Town" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Agent" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Asking Price" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Status" | t }}</th>
        <th class="px-4 py-3 text-left">{{ "Actions" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y">
      {% for seller in result.sellers %}
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">
          <a href="/admin/sellers/{{ seller.id }}" class="font-medium text-accent hover:underline">{{ seller.name }}</a>
          <div class="text-xs text-gray-500">{{ seller.email }}</div>
        </td>
        <td class="px-4 py-3 text-gray-600">{{ seller.phone or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">{{ seller.town or '-' }}</td>
        <td class="px-4 py-3 text-gray-600">
          {% if seller.agent %}{{ seller.agent.name }}{% else %}<span class="text-amber-600">{{ "Unassigned" | t }}</span>{% endif %}
        </td>
        <td class="px-4 py-3 text-gray-600">
          {% if seller.askingPrice %}${{ seller.askingPrice | formatPrice }}{% else %}-{% endif %}
        </td>
        <td class="px-4 py-3">
          <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs">{{ seller.status }}</span>
        </td>
        <td class="px-4 py-3">
          <button
            class="text-xs text-indigo-600 hover:underline"
            hx-get="/admin/sellers/{{ seller.id }}/assign-modal"
            hx-target="#modal-container"
          >{% if seller.agent %}{{ "Reassign" | t }}{% else %}{{ "Assign" | t }}{% endif %}</button>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="mt-3 text-xs text-gray-500 px-4">
    {{ "Showing" | t }} {{ result.sellers.length }} {{ "of" | t }} {{ result.total }}
  </div>
</div>
{% else %}
<p class="text-gray-400 text-sm">{{ "No sellers found." | t }}</p>
{% endif %}
```

**Step 3: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add src/views/partials/admin/seller-list.njk && git commit -m "feat(views): add phone, town, asking price to admin seller list"
```

---

### Task 4: Replace `/admin/pipeline` handler with redirect + add test

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Test: `src/domains/admin/__tests__/admin.router.test.ts`

**Step 1: Write the failing test**

In `src/domains/admin/__tests__/admin.router.test.ts`, add a new describe block:

```typescript
describe('GET /admin/pipeline', () => {
  it('redirects to /admin/sellers', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/pipeline');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/sellers');
  });
});
```

**Step 2: Run to confirm failure**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test -- --testPathPattern="admin.router.test" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — route currently returns 200 with a full render, not a 302

**Step 3: Replace the pipeline handler in `admin.router.ts`**

Find the `GET /admin/pipeline` handler (around line 65). Replace the entire handler body:

```typescript
adminRouter.get(
  '/admin/pipeline',
  ...adminAuth,
  (_req: Request, res: Response) => {
    res.redirect('/admin/sellers');
  },
);
```

Note: the `next` parameter can be dropped since there's no async work and no error to forward.

**Step 4: Run tests to confirm pass**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test -- --testPathPattern="admin.router.test" --no-coverage 2>&1 | tail -20
```

Expected: PASS

**Step 5: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts && git commit -m "feat(admin): redirect /admin/pipeline to /admin/sellers"
```

---

### Task 5: Remove Pipeline from admin nav

**Files:**
- Modify: `src/views/layouts/admin.njk`

**Step 1: Delete the Pipeline nav entry**

In `src/views/layouts/admin.njk`, find and remove this entire line (line 25):

```nunjucks
      <a href="/admin/pipeline" title="{{ 'Pipeline' | t }}" class="flex items-center gap-2 px-3 py-2.5 rounded text-sm {% if currentPath == '/admin/pipeline' %}bg-white/10 text-accent border-l-2 border-accent{% else %}hover:bg-white/10{% endif %}">{{ icon('funnel') }}<span class="sidebar-tooltip">{{ "Pipeline" | t }}</span><span class="sidebar-label">{{ "Pipeline" | t }}</span></a>
```

**Step 2: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add src/views/layouts/admin.njk && git commit -m "feat(views): remove pipeline nav item, sellers page is the replacement"
```

---

### Task 6: Delete all pipeline-specific dead code

**Files:**
- Delete: `src/views/pages/admin/pipeline.njk`
- Delete: `src/views/partials/admin/pipeline-table.njk`
- Modify: `src/domains/admin/admin.service.ts` — remove `getAdminPipeline` and `getAdminPipelineCounts`
- Modify: `src/domains/admin/admin.repository.ts` — remove `getPipelineForAdmin` and `countPipelineStage`
- Modify: `src/domains/admin/admin.types.ts` — remove `AdminPipelineSeller`, `AdminPipelineStage`, `AdminPipelineResult`
- Modify: `src/domains/admin/__tests__/admin.service.test.ts` — remove `getAdminPipeline` describe block

**Step 1: Delete view files**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && rm src/views/pages/admin/pipeline.njk src/views/partials/admin/pipeline-table.njk
```

**Step 2: Remove from `admin.service.ts`**

Delete the entire `// ─── Pipeline ────────────` section (lines ~296–339), which contains `getAdminPipeline` and `getAdminPipelineCounts`.

Also remove the import of `AdminPipelineResult` from `admin.types.ts` at the top of the file if it's imported there.

**Step 3: Remove from `admin.repository.ts`**

Delete `getPipelineForAdmin` (around line 111) and `countPipelineStage` (around line 129) from the `// ─── Pipeline Queries` section.

**Step 4: Remove from `admin.types.ts`**

Delete these three interfaces (lines 150–169):
- `AdminPipelineSeller`
- `AdminPipelineStage`
- `AdminPipelineResult`

**Step 5: Remove tests from `admin.service.test.ts`**

Delete the entire `describe('getAdminPipeline', ...)` block (lines 51–90, including the section comment on line 51).

**Step 6: Run full test suite**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all passing. If TypeScript errors appear (unused imports etc.), fix them before committing.

**Step 7: Run TypeScript check**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

**Step 8: Commit**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && git add -A && git commit -m "refactor(admin): delete pipeline page, views, service, repo, and types"
```

---

### Task 7: Build check

**Step 1: Run the full build**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm run build 2>&1 | tail -20
```

Expected: clean build, no errors

**Step 2: Run the full test suite one final time**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test -- --no-coverage 2>&1 | tail -10
```

Expected: all passing

No commit needed if nothing changed.
