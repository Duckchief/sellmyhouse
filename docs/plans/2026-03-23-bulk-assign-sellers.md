# Bulk Assign Sellers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add checkboxes to the admin sellers table for bulk selecting and assigning/reassigning sellers to an agent in one action.

**Architecture:** Checkboxes in `seller-list.njk` with inline JS for select-all and bulk action bar visibility. New `assign-bulk-modal.njk` template. New `POST /admin/sellers/bulk-assign` endpoint that loops through selected sellers calling existing `assignSeller`/`reassignSeller` service methods. New `GET /admin/sellers/bulk-assign-modal` to load the modal.

**Tech Stack:** Nunjucks templates, HTMX, Express router, existing admin service methods, Jest + Supertest tests.

---

### Task 1: Add checkboxes to seller table

**Files:**
- Modify: `src/views/partials/admin/seller-list.njk`

**Step 1: Add checkbox column to header and rows**

Replace the full content of `src/views/partials/admin/seller-list.njk` with:

```html
{% if result and result.sellers.length > 0 %}
<div id="bulk-action-bar" class="mb-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded flex items-center gap-3 hidden">
  <span class="text-sm text-indigo-700" id="bulk-count">0 selected</span>
  <button
    type="button"
    class="text-sm bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700"
    id="bulk-assign-btn"
    hx-get="/admin/sellers/bulk-assign-modal"
    hx-target="#modal-container"
  >{{ "Assign" | t }}</button>
</div>
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
      <tr>
        <th class="px-4 py-3 text-left w-10">
          <input type="checkbox" id="select-all-sellers" class="rounded" />
        </th>
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
          <input type="checkbox" class="seller-checkbox rounded" value="{{ seller.id }}" />
        </td>
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

<script>
(function() {
  const list = document.getElementById('seller-list');
  if (!list) return;

  function getCheckboxes() {
    return list.querySelectorAll('.seller-checkbox');
  }

  function getCheckedIds() {
    return Array.from(getCheckboxes())
      .filter(function(cb) { return cb.checked; })
      .map(function(cb) { return cb.value; });
  }

  function updateBar() {
    var ids = getCheckedIds();
    var bar = document.getElementById('bulk-action-bar');
    var countEl = document.getElementById('bulk-count');
    var btn = document.getElementById('bulk-assign-btn');
    if (!bar) return;
    if (ids.length > 0) {
      bar.classList.remove('hidden');
      countEl.textContent = ids.length + ' selected';
      btn.setAttribute('hx-vals', JSON.stringify({ sellerIds: ids.join(',') }));
      htmx.process(btn);
    } else {
      bar.classList.add('hidden');
    }
  }

  list.addEventListener('change', function(e) {
    if (e.target.id === 'select-all-sellers') {
      var checked = e.target.checked;
      getCheckboxes().forEach(function(cb) { cb.checked = checked; });
    }
    updateBar();
  });
})();
</script>
{% else %}
<p class="text-gray-400 text-sm">{{ "No sellers found." | t }}</p>
{% endif %}
```

**Step 2: Verify visually**

Run `npm run dev`, go to `/admin/sellers`:
- Checkboxes appear in each row and header
- Clicking header checkbox selects/deselects all
- Bulk action bar appears/disappears based on selection
- Count updates correctly

**Step 3: Commit**

```bash
git add src/views/partials/admin/seller-list.njk
git commit -m "feat(admin): add checkboxes and bulk action bar to seller list"
```

---

### Task 2: Create bulk assign modal template

**Files:**
- Create: `src/views/partials/admin/assign-bulk-modal.njk`

**Step 1: Create the template**

Create `src/views/partials/admin/assign-bulk-modal.njk`:

```html
<div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" id="assign-bulk-modal">
  <div class="bg-white rounded-lg shadow-xl p-6 w-96">
    <h3 class="text-lg font-semibold mb-4">
      {{ "Assign" | t }} {{ sellerCount }} {{ "sellers" | t }}
    </h3>
    <form hx-post="/admin/sellers/bulk-assign" hx-target="#action-result" data-remove-on-success="assign-bulk-modal">
      <input type="hidden" name="sellerIds" value="{{ sellerIds }}" />
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ "Select Agent" | t }}</label>
        <select name="agentId" class="w-full border rounded px-3 py-2 text-sm">
          {% for agent in team %}
            {% if agent.isActive %}
              <option value="{{ agent.id }}">{{ agent.name }}</option>
            {% endif %}
          {% endfor %}
        </select>
      </div>
      <div class="flex gap-3 justify-end">
        <button type="button" data-action="remove-element" data-target="assign-bulk-modal" class="px-4 py-2 text-sm border rounded hover:bg-gray-50">{{ "Cancel" | t }}</button>
        <button type="submit" class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">{{ "Confirm" | t }}</button>
      </div>
    </form>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add src/views/partials/admin/assign-bulk-modal.njk
git commit -m "feat(admin): add bulk assign modal template"
```

---

### Task 3: Add bulk assign routes

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Modify: `src/domains/admin/admin.validator.ts`
- Test: `src/domains/admin/__tests__/admin.router.test.ts`

**Step 1: Add validator for bulk assign**

In `src/domains/admin/admin.validator.ts`, add after the existing `validateAssign`:

```typescript
export const validateBulkAssign = [
  body('sellerIds').trim().notEmpty().withMessage('Seller IDs are required'),
  body('agentId').trim().notEmpty().withMessage('Agent ID is required'),
];
```

**Step 2: Write the failing tests**

In `src/domains/admin/__tests__/admin.router.test.ts`, add a new describe block:

```typescript
describe('GET /admin/sellers/bulk-assign-modal', () => {
  it('renders the bulk assign modal with seller count', async () => {
    mockAdminService.getTeam.mockResolvedValue([
      { id: 'agent-1', name: 'Agent One', isActive: true },
    ] as any);

    const app = makeApp();
    const res = await request(app)
      .get('/admin/sellers/bulk-assign-modal?sellerIds=s1,s2,s3')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.getTeam).toHaveBeenCalled();
  });
});

describe('POST /admin/sellers/bulk-assign', () => {
  it('assigns multiple sellers and returns success count', async () => {
    mockAdminService.getAllSellers.mockResolvedValue({
      sellers: [
        { id: 's1', agent: null },
        { id: 's2', agent: { id: 'old-agent', name: 'Old' } },
      ],
      total: 2, page: 1, limit: 25,
    } as any);
    mockAdminService.assignSeller.mockResolvedValue(undefined);
    mockAdminService.reassignSeller.mockResolvedValue(undefined);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/sellers/bulk-assign')
      .set('hx-request', 'true')
      .send({ sellerIds: 's1,s2', agentId: 'agent-1' });

    expect(res.status).toBe(200);
    expect(mockAdminService.assignSeller).toHaveBeenCalledWith('s1', 'agent-1', expect.any(String));
    expect(mockAdminService.reassignSeller).toHaveBeenCalledWith('s2', 'agent-1', expect.any(String));
  });

  it('returns 400 when sellerIds is empty', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/sellers/bulk-assign')
      .set('hx-request', 'true')
      .send({ sellerIds: '', agentId: 'agent-1' });

    expect(res.status).toBe(400);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx jest src/domains/admin/__tests__/admin.router.test.ts -t "bulk-assign" --no-coverage`
Expected: FAIL — routes don't exist yet.

**Step 4: Implement the routes**

In `src/domains/admin/admin.router.ts`, add the import for the new validator:

```typescript
import { validateAgentCreate, validateSettingUpdate, validateAssign, validateBulkAssign } from './admin.validator';
```

Add these two routes after the existing reassign route (after line 614):

```typescript
// GET route for loading the bulk assign modal
adminRouter.get(
  '/admin/sellers/bulk-assign-modal',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerIds = (req.query['sellerIds'] as string) || '';
      const team = await adminService.getTeam();
      const count = sellerIds.split(',').filter(Boolean).length;
      res.render('partials/admin/assign-bulk-modal', {
        team,
        sellerIds,
        sellerCount: count,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST route for bulk assigning sellers
adminRouter.post(
  '/admin/sellers/bulk-assign',
  ...adminAuth,
  ...validateBulkAssign,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const user = req.user as AuthenticatedUser;
      const sellerIds = (req.body.sellerIds as string).split(',').filter(Boolean);
      const agentId = req.body.agentId as string;

      // Fetch all sellers to determine assign vs reassign
      const { sellers } = await adminService.getAllSellers({});
      const sellerMap = new Map(sellers.map((s) => [s.id, s]));

      let successCount = 0;
      for (const sellerId of sellerIds) {
        try {
          const seller = sellerMap.get(sellerId);
          if (seller?.agent) {
            await adminService.reassignSeller(sellerId, agentId, user.id);
          } else {
            await adminService.assignSeller(sellerId, agentId, user.id);
          }
          successCount++;
        } catch {
          // Continue on individual failure
        }
      }

      if (req.headers['hx-request']) {
        res.setHeader('HX-Trigger', 'sellerAssigned');
        return res.render('partials/admin/team-action-result', {
          message: `${successCount} of ${sellerIds.length} sellers assigned.`,
          type: 'success',
        });
      }
      res.redirect('/admin/sellers');
    } catch (err) {
      next(err);
    }
  },
);
```

**IMPORTANT:** The bulk-assign-modal GET route must be placed **before** the `/admin/sellers/:id` catch-all route in the router. Check the router file and ensure it's placed after the `/admin/sellers` (exact) GET route but before any `/admin/sellers/:id` routes. This prevents Express from matching `bulk-assign-modal` as an `:id` parameter.

**Step 5: Run tests to verify they pass**

Run: `npx jest src/domains/admin/__tests__/admin.router.test.ts -t "bulk-assign" --no-coverage`
Expected: All 3 tests PASS.

**Step 6: Run full admin router tests**

Run: `npx jest src/domains/admin/__tests__/admin.router.test.ts --no-coverage`
Expected: All tests PASS (no regressions).

**Step 7: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/admin.validator.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): add bulk assign routes and validation"
```

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compile.

**Step 3: Manual smoke test**

1. Go to `/admin/sellers`
2. Check individual row checkboxes — bulk action bar appears with count
3. Click header checkbox — all rows selected, count updates
4. Uncheck header — all deselected, bar hides
5. Select 2-3 sellers, click "Assign" — bulk modal loads with correct count
6. Pick an agent, click Confirm — success message, list refreshes, sellers now assigned
7. Individual Assign/Reassign buttons in Actions column still work
8. After HTMX list refresh (from filters), checkboxes and JS still work (script re-runs)
