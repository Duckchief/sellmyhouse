# Dynamic Storey Range Filter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the Storey Range dropdown to only show values that exist for the selected Town + Flat Type combination, using an HTMX-triggered server endpoint.

**Architecture:** A new `GET /api/hdb/storey-ranges` endpoint queries the DB for distinct storey ranges filtered by town and flat type, then returns an HTML partial. The Town and Flat Type selects in `market-report.njk` use HTMX `hx-get` to call this endpoint on change, swapping the storey range options in place.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX

**Spec:** `docs/superpowers/specs/2026-03-16-dynamic-storey-range-filter-design.md`

---

## Chunk 1: Repository + Service

### Task 1: Repository method

**Files:**
- Modify: `src/domains/hdb/repository.ts`
- Test: `src/domains/hdb/__tests__/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/domains/hdb/__tests__/repository.test.ts`. Add inside the existing `describe` block after the `getDistinctFlatTypes` tests (note: there is no `getDistinctStoreyRanges` describe block in the repo test file — that method is only tested in `service.test.ts`):

```typescript
describe('getDistinctStoreyRangesByTownAndFlatType', () => {
  it('returns storey ranges filtered by town and flat type', async () => {
    mockPrisma.hdbTransaction.findMany.mockResolvedValue([
      { storeyRange: '01 TO 03' },
      { storeyRange: '04 TO 06' },
    ]);

    const result = await repo.getDistinctStoreyRangesByTownAndFlatType('TAMPINES', '4 ROOM');

    expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith({
      distinct: ['storeyRange'],
      select: { storeyRange: true },
      orderBy: { storeyRange: 'asc' },
      where: { town: 'TAMPINES', flatType: '4 ROOM' },
    });
    expect(result).toEqual(['01 TO 03', '04 TO 06']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="hdb/__tests__/repository" --verbose
```

Expected: FAIL — `repo.getDistinctStoreyRangesByTownAndFlatType is not a function`

- [ ] **Step 3: Implement the method**

In `src/domains/hdb/repository.ts`, add after `getDistinctStoreyRanges()`:

```typescript
async getDistinctStoreyRangesByTownAndFlatType(town: string, flatType: string): Promise<string[]> {
  const results = await prisma.hdbTransaction.findMany({
    distinct: ['storeyRange'],
    select: { storeyRange: true },
    orderBy: { storeyRange: 'asc' },
    where: { town, flatType },
  });
  return results.map((r) => r.storeyRange);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="hdb/__tests__/repository" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/repository.ts src/domains/hdb/__tests__/repository.test.ts
git commit -m "feat: add getDistinctStoreyRangesByTownAndFlatType to HdbRepository"
```

---

### Task 2: Service method

**Files:**
- Modify: `src/domains/hdb/service.ts`
- Test: `src/domains/hdb/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/domains/hdb/__tests__/service.test.ts`. Add after the `getDistinctStoreyRanges` describe block. Note: the file uses auto-mocked repo methods via `jest.mock('../repository')`, so use `.mockResolvedValue()` directly (not `= jest.fn()`):

```typescript
describe('getDistinctStoreyRangesByTownAndFlatType', () => {
  it('delegates to repo with town and flatType', async () => {
    mockRepo.getDistinctStoreyRangesByTownAndFlatType.mockResolvedValue(['01 TO 03', '04 TO 06']);

    const result = await service.getDistinctStoreyRangesByTownAndFlatType('TAMPINES', '4 ROOM');

    expect(mockRepo.getDistinctStoreyRangesByTownAndFlatType).toHaveBeenCalledWith('TAMPINES', '4 ROOM');
    expect(result).toEqual(['01 TO 03', '04 TO 06']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="hdb/__tests__/service" --verbose
```

Expected: FAIL — `service.getDistinctStoreyRangesByTownAndFlatType is not a function`

- [ ] **Step 3: Implement the method**

In `src/domains/hdb/service.ts`, add after `getDistinctStoreyRanges()`:

```typescript
async getDistinctStoreyRangesByTownAndFlatType(town: string, flatType: string): Promise<string[]> {
  return this.repo.getDistinctStoreyRangesByTownAndFlatType(town, flatType);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="hdb/__tests__/service" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/service.ts src/domains/hdb/__tests__/service.test.ts
git commit -m "feat: add getDistinctStoreyRangesByTownAndFlatType to HdbService"
```

---

## Chunk 2: Endpoint + Partial

### Task 3: Nunjucks partial

**Files:**
- Create: `src/views/partials/public/storey-range-options.njk`

- [ ] **Step 1: Create the partial**

Create `src/views/partials/public/storey-range-options.njk`:

```nunjucks
<option value="">{{ "All storeys" | t }}</option>
{% for sr in storeyRanges %}
<option value="{{ sr }}">{{ sr }}</option>
{% endfor %}
```

No test needed — this is a pure template fragment with no logic. It will be covered by the router test in Task 4.

- [ ] **Step 2: Update `market-report.njk` to use the partial for initial render**

In `src/views/pages/public/market-report.njk`, replace the storey range `<select>` inner content. Find:

```nunjucks
          <select id="storeyRange" name="storeyRange" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white">
            <option value="">{{ "All storeys" | t }}</option>
            {% for sr in storeyRanges %}
            <option value="{{ sr }}">{{ sr }}</option>
            {% endfor %}
          </select>
```

Replace with:

```nunjucks
          <select id="storey-range-select" name="storeyRange" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white">
            {% include "partials/public/storey-range-options.njk" %}
          </select>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/public/storey-range-options.njk src/views/pages/public/market-report.njk
git commit -m "feat: extract storey-range-options partial, add id to select"
```

---

### Task 4: Router endpoint

**Files:**
- Modify: `src/domains/public/public.router.ts`
- Test: `src/domains/public/__tests__/hdb-transactions.router.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/domains/public/__tests__/hdb-transactions.router.test.ts`. Add a new `describe` block at the end:

```typescript
describe('GET /api/hdb/storey-ranges', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns filtered storey range options when town and flatType provided', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctStoreyRangesByTownAndFlatType')
      .mockResolvedValue(['01 TO 03', '04 TO 06', '07 TO 09']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?town=TAMPINES&flatType=4+ROOM')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(res.text).toContain('01 TO 03');
    expect(res.text).toContain('04 TO 06');
    expect(res.text).toContain('All storeys');
    expect(HdbService.prototype.getDistinctStoreyRangesByTownAndFlatType).toHaveBeenCalledWith(
      'TAMPINES',
      '4 ROOM',
    );
  });

  it('falls back to all storey ranges when town is missing', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctStoreyRanges')
      .mockResolvedValue(['01 TO 03', '04 TO 06']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?flatType=4+ROOM')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(HdbService.prototype.getDistinctStoreyRanges).toHaveBeenCalled();
  });

  it('falls back to all storey ranges when flatType is missing', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctStoreyRanges')
      .mockResolvedValue(['01 TO 03']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?town=TAMPINES')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(HdbService.prototype.getDistinctStoreyRanges).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="hdb-transactions.router" --verbose
```

Expected: FAIL — 404 on `/api/hdb/storey-ranges`

- [ ] **Step 3: Add the route**

In `src/domains/public/public.router.ts`, add after the `/api/hdb/transactions` route:

```typescript
publicRouter.get(
  '/api/hdb/storey-ranges',
  hdbRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const town = req.query.town as string | undefined;
      const flatType = req.query.flatType as string | undefined;

      const storeyRanges =
        town && flatType
          ? await hdbService.getDistinctStoreyRangesByTownAndFlatType(town, flatType)
          : await hdbService.getDistinctStoreyRanges();

      return res.render('partials/public/storey-range-options', { storeyRanges });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="hdb-transactions.router" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/public/public.router.ts src/domains/public/__tests__/hdb-transactions.router.test.ts
git commit -m "feat: add GET /api/hdb/storey-ranges endpoint with town+flatType filtering"
```

---

## Chunk 3: HTMX Wiring

### Task 5: Wire HTMX triggers in the form

**Files:**
- Modify: `src/views/pages/public/market-report.njk`

No new tests — HTMX wiring is markup only; covered by manual smoke test below.

**HTMX swap behaviour note:** No `hx-swap` attribute is needed on the triggering selects. When `hx-target` points to a different element, HTMX uses `innerHTML` on that target by default — which is exactly what we want. Also note: if the user changes town before selecting a flat type, `flatType` will be an empty string in the request. The endpoint correctly treats an empty string as falsy and falls back to returning all storey ranges.

- [ ] **Step 1: Add HTMX attributes to the Town select**

In `src/views/pages/public/market-report.njk`, find the `town` select and add the HTMX attributes:

```nunjucks
          <select id="town" name="town" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white"
                  hx-get="/api/hdb/storey-ranges"
                  hx-include="#market-report-form"
                  hx-target="#storey-range-select"
                  hx-trigger="change">
```

- [ ] **Step 2: Add HTMX attributes to the Flat Type select**

Find the `flatType` select and add the same attributes:

```nunjucks
          <select id="flatType" name="flatType" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white"
                  hx-get="/api/hdb/storey-ranges"
                  hx-include="#market-report-form"
                  hx-target="#storey-range-select"
                  hx-trigger="change">
```

- [ ] **Step 3: Smoke test manually**

```bash
npm run dev
```

1. Open `http://localhost:3000/market-report`
2. Select a Town (e.g. QUEENSTOWN) — Storey Range dropdown should refresh
3. Select a Flat Type (e.g. 4 ROOM) — Storey Range dropdown should refresh again with a more specific list
4. Verify "All storeys" always appears as the first option
5. Verify selecting a storey range, then changing town, resets the storey range to "All storeys"

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/public/market-report.njk
git commit -m "feat: wire HTMX cascade on town/flatType change to refresh storey ranges"
```

---

## Done

All three chunks complete. The storey range dropdown now shows only values that exist for the selected town + flat type combination.
