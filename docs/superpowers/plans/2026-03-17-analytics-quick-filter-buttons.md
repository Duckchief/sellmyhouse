# Analytics Dashboard Quick Filter Buttons Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five quick-access preset filter buttons (This Week, This Month, 3 Months, 6 Months, YTD) above the datepicker on the Admin Analytics Dashboard that immediately apply the selected date range.

**Architecture:** Client-side JS calculates the date range for each preset, updates the existing date inputs and a new hidden `preset` input, then programmatically triggers the existing HTMX Filter button. The `preset` param is threaded through the router and back to the template to persist active button state after the HTMX swap.

**Tech Stack:** Nunjucks templates, HTMX, vanilla JS (inline with CSP nonce), Express router, Jest + Supertest for router test.

**Spec:** `docs/superpowers/specs/2026-03-17-analytics-quick-filter-buttons.md`

---

## Chunk 1: Router — thread `preset` param

### Task 1: Add `preset` to the analytics filter

**Files:**
- Modify: `src/domains/admin/admin.router.ts:27-30`
- Test: `src/domains/admin/__tests__/admin.router.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block in `src/domains/admin/__tests__/admin.router.test.ts`. You'll need to mock `adminService` at the top of the file. Check the file — it currently mocks `contentService`. Add a mock for `adminService` as well.

```typescript
// At the top of admin.router.test.ts, add:
import * as adminService from '../admin.service';
jest.mock('../admin.service');
const mockAdminService = adminService as jest.Mocked<typeof adminService>;
```

Then add this describe block at the bottom of the file:

```typescript
describe('GET /admin/dashboard — preset param', () => {
  beforeEach(() => {
    mockAdminService.getAnalytics.mockResolvedValue({
      revenue: { totalRevenue: 0, completedCount: 0, pipelineValue: 0, activeTransactions: 0, pendingInvoices: 0, commissionPerTransaction: 0 },
      funnel: { lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 },
      timeToClose: { averageDays: 0, count: 0, byFlatType: {} },
      leadSources: {},
      viewings: { totalViewings: 0, completed: 0, noShowRate: 0, cancellationRate: 0 },
      referrals: { totalLinks: 0, totalClicks: 0, leadsCreated: 0, transactionsCompleted: 0, conversionRate: 0, topReferrers: [] },
    } as any);
  });

  it('passes preset param through to getAnalytics', async () => {
    const app = makeApp();
    await request(app).get('/admin/dashboard?preset=this-month');
    expect(mockAdminService.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'this-month' }),
    );
  });

  it('passes undefined preset when not provided', async () => {
    const app = makeApp();
    await request(app).get('/admin/dashboard');
    expect(mockAdminService.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ preset: undefined }),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- --testPathPattern="admin.router.test" --no-coverage
```

Expected: FAIL — `preset` is not yet in the filter object.

- [ ] **Step 3: Extend `AnalyticsFilter` type**

In `src/domains/admin/admin.types.ts`, add `preset` to the `AnalyticsFilter` interface (currently at line 89):

```typescript
export interface AnalyticsFilter {
  dateFrom?: string;
  dateTo?: string;
  preset?: string;
}
```

- [ ] **Step 4: Add `preset` to the filter in the router**

In `src/domains/admin/admin.router.ts`, update the dashboard filter object (lines 27–30):

```typescript
const filter = {
  dateFrom: req.query['dateFrom'] as string | undefined,
  dateTo: req.query['dateTo'] as string | undefined,
  preset: req.query['preset'] as string | undefined,
};
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test -- --testPathPattern="admin.router.test" --no-coverage
```

Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/admin/admin.types.ts src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): thread preset param through analytics dashboard filter"
```

---

## Chunk 2: Template — quick filter buttons + JS helper

### Task 2: Add quick filter row and JS helper to analytics partial

**Files:**
- Modify: `src/views/partials/admin/analytics.njk`

There is no unit test for Nunjucks templates — the router test above covers the server side. The template change is verified manually.

- [ ] **Step 1: Add hidden `preset` input**

In `src/views/partials/admin/analytics.njk`, find the opening `<div class="flex flex-wrap items-end gap-4 mb-6">` (line 2). Insert a hidden input just before this div, and add `id="filterBtn"` to the Filter button and `#preset` to its `hx-include`. The full updated filter section should look like this:

```nunjucks
{# Hidden preset input — included in HTMX filter request #}
<input type="hidden" id="preset" name="preset" value="{{ filter.preset or '' }}">

{# Quick filter preset buttons #}
<div class="flex flex-wrap gap-2 mb-3">
  {% set presets = [
    { value: 'this-week',  label: 'This Week' },
    { value: 'this-month', label: 'This Month' },
    { value: '3-months',   label: '3 Months' },
    { value: '6-months',   label: '6 Months' },
    { value: 'ytd',        label: 'YTD' }
  ] %}
  {% for p in presets %}
    <button
      type="button"
      onclick="setPreset('{{ p.value }}')"
      class="px-3 py-1 text-sm rounded border transition-colors
        {% if filter.preset == p.value %}
          border-2 border-accent text-accent font-semibold
        {% else %}
          border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600
        {% endif %}">
      {{ p.label | t }}
    </button>
  {% endfor %}
</div>

<hr class="border-gray-200 mb-3">

{# Date filter #}
<div class="flex flex-wrap items-end gap-4 mb-6">
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "From" | t }}</label>
    <input type="date" name="dateFrom" id="dateFrom" value="{{ filter.dateFrom or '' }}" class="input-field w-40">
  </div>
  <div>
    <label class="block text-xs text-gray-500 mb-1">{{ "To" | t }}</label>
    <input type="date" name="dateTo" id="dateTo" value="{{ filter.dateTo or '' }}" class="input-field w-40">
  </div>
  <button
    id="filterBtn"
    hx-get="/admin/dashboard"
    hx-include="#dateFrom, #dateTo, #preset"
    hx-target="#analytics-content"
    hx-swap="innerHTML"
    class="btn-primary">
    {{ "Filter" | t }}
  </button>
</div>
```

Note: The original `hx-include` was `#dateFrom, #dateTo` — we've added `#preset` and added `id="filterBtn"` to the button.

- [ ] **Step 2: Add the `setPreset` JS helper**

Append the following script block at the **bottom** of `src/views/partials/admin/analytics.njk`, after the closing `</div>` of the referral card:

```nunjucks
<script nonce="{{ cspNonce }}">
(function () {
  function setPreset(name) {
    var today = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var fmt = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var todayStr = fmt(today);
    var from;

    if (name === 'this-week') {
      var d = new Date(today);
      var day = d.getDay() || 7; // Mon=1…Sun=7
      d.setDate(d.getDate() - day + 1);
      from = fmt(d);
    } else if (name === 'this-month') {
      from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    } else if (name === '3-months') {
      var d3 = new Date(today);
      d3.setMonth(d3.getMonth() - 3);
      from = fmt(d3);
    } else if (name === '6-months') {
      var d6 = new Date(today);
      d6.setMonth(d6.getMonth() - 6);
      from = fmt(d6);
    } else if (name === 'ytd') {
      from = fmt(new Date(today.getFullYear(), 0, 1));
    }

    document.getElementById('dateFrom').value = from;
    document.getElementById('dateTo').value = todayStr;
    document.getElementById('preset').value = name;
    htmx.trigger(document.getElementById('filterBtn'), 'click');
  }

  window.setPreset = setPreset;
})();
</script>
```

- [ ] **Step 3: Verify the build compiles cleanly**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Smoke test in dev server**

```bash
npm run dev
```

Open `http://localhost:3000/admin/dashboard` (log in as admin first). Verify:
1. Five preset buttons appear above the datepicker.
2. Clicking "This Month" immediately refreshes analytics and the button shows the active (accent) style.
3. Clicking "This Week" switches the active button and updates the date inputs.
4. Manually editing the date fields and clicking Filter shows no preset button highlighted.
5. Refreshing the page with no preset shows no active button.

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/admin/analytics.njk
git commit -m "feat(admin): add quick filter preset buttons to analytics dashboard"
```

---

## Done

Run the full test suite one final time:

```bash
npm test --no-coverage
```

All tests should pass. The feature is complete.
