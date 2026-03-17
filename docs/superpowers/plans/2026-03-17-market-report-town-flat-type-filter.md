# Market Report: Town-Filtered Flat Type Dropdown + Slider Default Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects a Town on /market-report, repopulate the Flat Type dropdown with only types available in that town (resetting to "Select type"), and simultaneously reset Storey Range to "All storeys" via HTMX OOB swap; also fix the Date Range slider to default to 1 Year.

**Architecture:** New repo/service method `getDistinctFlatTypesByTown` feeds a new endpoint `GET /api/hdb/flat-types?town=X` that renders a partial with flat-type options plus an OOB `<select>` that resets the storey-range dropdown in the same response. The town select's HTMX attributes are updated to target this new endpoint.

**Tech Stack:** TypeScript, Express, Prisma, HTMX (OOB swaps), Nunjucks, Jest, Supertest

---

## Chunk 1: Data Layer — Repository and Service Methods

**Files:**
- Modify: `src/domains/hdb/repository.ts`
- Modify: `src/domains/hdb/service.ts`
- Modify: `src/domains/hdb/__tests__/repository.test.ts`
- Modify: `src/domains/hdb/__tests__/service.test.ts`

### Task 1: Repository method `getDistinctFlatTypesByTown`

- [ ] **Step 1: Write the failing unit test**

  Open `src/domains/hdb/__tests__/repository.test.ts`. Add the following test inside the `describe('HdbRepository', ...)` block, after the existing `getDistinctFlatTypes` test:

  ```typescript
  describe('getDistinctFlatTypesByTown', () => {
    it('returns distinct flat types filtered by town', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { flatType: '3 ROOM' },
        { flatType: '4 ROOM' },
      ]);

      const result = await repo.getDistinctFlatTypesByTown('BISHAN');

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith({
        distinct: ['flatType'],
        select: { flatType: true },
        orderBy: { flatType: 'asc' },
        where: { town: 'BISHAN' },
      });
      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });

    it('returns empty array when town has no transactions', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      const result = await repo.getDistinctFlatTypesByTown('UNKNOWN TOWN');

      expect(result).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npm test -- --testPathPattern="hdb/__tests__/repository" --no-coverage
  ```

  Expected: `FAIL` — `repo.getDistinctFlatTypesByTown is not a function`

- [ ] **Step 3: Implement the method in `src/domains/hdb/repository.ts`**

  Add after `getDistinctFlatTypes()` (after line 172):

  ```typescript
  async getDistinctFlatTypesByTown(town: string): Promise<string[]> {
    const results = await prisma.hdbTransaction.findMany({
      distinct: ['flatType'],
      select: { flatType: true },
      orderBy: { flatType: 'asc' },
      where: { town },
    });
    return results.map((r) => r.flatType);
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npm test -- --testPathPattern="hdb/__tests__/repository" --no-coverage
  ```

  Expected: `PASS`

- [ ] **Step 5: Commit**

  ```bash
  git add src/domains/hdb/repository.ts src/domains/hdb/__tests__/repository.test.ts
  git commit -m "feat: add getDistinctFlatTypesByTown to HdbRepository"
  ```

---

### Task 2: Service method `getDistinctFlatTypesByTown`

- [ ] **Step 1: Write the failing unit test**

  Open `src/domains/hdb/__tests__/service.test.ts`. Add after the existing `getDistinctFlatTypes` test block:

  ```typescript
  describe('getDistinctFlatTypesByTown', () => {
    it('delegates to repo with the given town', async () => {
      mockRepo.getDistinctFlatTypesByTown.mockResolvedValue(['3 ROOM', '4 ROOM']);

      const result = await service.getDistinctFlatTypesByTown('BISHAN');

      expect(mockRepo.getDistinctFlatTypesByTown).toHaveBeenCalledWith('BISHAN');
      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npm test -- --testPathPattern="hdb/__tests__/service" --no-coverage
  ```

  Expected: `FAIL` — `service.getDistinctFlatTypesByTown is not a function`

- [ ] **Step 3: Implement the method in `src/domains/hdb/service.ts`**

  Add after `getDistinctFlatTypes()` (after line 19):

  ```typescript
  async getDistinctFlatTypesByTown(town: string): Promise<string[]> {
    return this.repo.getDistinctFlatTypesByTown(town);
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npm test -- --testPathPattern="hdb/__tests__/service" --no-coverage
  ```

  Expected: `PASS`

- [ ] **Step 5: Commit**

  ```bash
  git add src/domains/hdb/service.ts src/domains/hdb/__tests__/service.test.ts
  git commit -m "feat: add getDistinctFlatTypesByTown to HdbService"
  ```

---

## Chunk 2: Endpoint, Template, and Router Changes

**Files:**
- Create: `src/views/partials/public/flat-type-options.njk`
- Modify: `src/domains/public/public.router.ts`
- Modify: `src/views/pages/public/market-report.njk`
- Modify: `src/domains/public/__tests__/hdb-transactions.router.test.ts`

### Task 3: New partial template `flat-type-options.njk`

- [ ] **Step 1: Create `src/views/partials/public/flat-type-options.njk`**

  ```nunjucks
  <option value="">{{ "Select type" | t }}</option>
  {% for ft in flatTypes %}
  <option value="{{ ft }}">{{ ft }}</option>
  {% endfor %}

  <select id="storey-range-select" hx-swap-oob="innerHTML">
    <option value="">{{ "All storeys" | t }}</option>
  </select>
  ```

  **Notes:**
  - The primary content (the `<option>` elements before the `<select>`) is what HTMX swaps into `#flatType` via `innerHTML`.
  - The `<select id="storey-range-select" hx-swap-oob="innerHTML">` element is an out-of-band swap — HTMX detects it and replaces the innerHTML of `#storey-range-select` in the DOM with the single "All storeys" option. The tag must match the target element's tag (`<select>`, not `<div>`).
  - If `flatTypes` is empty (no data for the given town), the dropdown renders only the "Select type" placeholder — no error state needed.

- [ ] **Step 2: No automated test for the template itself** — it is verified via the router test in Task 4. No step needed here.

- [ ] **Step 3: Commit**

  ```bash
  git add src/views/partials/public/flat-type-options.njk
  git commit -m "feat: add flat-type-options.njk partial with OOB storey-range reset"
  ```

---

### Task 4: New endpoint `GET /api/hdb/flat-types` and router tests

- [ ] **Step 1: Write the failing router tests**

  Open `src/domains/public/__tests__/hdb-transactions.router.test.ts`. Add a new `describe` block at the end of the file:

  ```typescript
  describe('GET /api/hdb/flat-types', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns flat types for a given town', async () => {
      jest
        .spyOn(HdbService.prototype, 'getDistinctFlatTypesByTown')
        .mockResolvedValue(['3 ROOM', '4 ROOM', '5 ROOM']);
      const app = buildApp();

      const res = await request(app).get('/api/hdb/flat-types?town=BISHAN');

      expect(res.status).toBe(200);
      expect(res.text).toContain('3 ROOM');
      expect(res.text).toContain('4 ROOM');
      expect(res.text).toContain('5 ROOM');
      // OOB reset element must be present
      expect(res.text).toContain('id="storey-range-select"');
      expect(res.text).toContain('hx-swap-oob="innerHTML"');
    });

    it('falls back to all flat types when town param is missing', async () => {
      jest
        .spyOn(HdbService.prototype, 'getDistinctFlatTypes')
        .mockResolvedValue(['3 ROOM', '4 ROOM']);
      const app = buildApp();

      const res = await request(app).get('/api/hdb/flat-types');

      expect(res.status).toBe(200);
      expect(res.text).toContain('3 ROOM');
    });

    it('returns empty options (only placeholder) when town has no data', async () => {
      jest
        .spyOn(HdbService.prototype, 'getDistinctFlatTypesByTown')
        .mockResolvedValue([]);
      const app = buildApp();

      const res = await request(app).get('/api/hdb/flat-types?town=UNKNOWN');

      expect(res.status).toBe(200);
      expect(res.text).toContain('Select type');
      // No flat type option values beyond the placeholder
      expect(res.text).not.toMatch(/<option value="[^"]+">[\w ]+<\/option>/);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npm test -- --testPathPattern="public/__tests__/hdb-transactions" --no-coverage
  ```

  Expected: `FAIL` — 404 for the new endpoint (route not registered yet)

- [ ] **Step 3: Add the endpoint to `src/domains/public/public.router.ts`**

  Add after the `GET /api/hdb/storey-ranges` block (after line 117), before `GET /privacy`:

  ```typescript
  publicRouter.get(
    '/api/hdb/flat-types',
    hdbRateLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const town = req.query.town as string | undefined;

        const flatTypes = town
          ? await hdbService.getDistinctFlatTypesByTown(town)
          : await hdbService.getDistinctFlatTypes();

        return res.render('partials/public/flat-type-options', { flatTypes });
      } catch (err) {
        next(err);
      }
    },
  );
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npm test -- --testPathPattern="public/__tests__/hdb-transactions" --no-coverage
  ```

  Expected: `PASS`

- [ ] **Step 5: Commit**

  ```bash
  git add src/domains/public/public.router.ts src/domains/public/__tests__/hdb-transactions.router.test.ts
  git commit -m "feat: add GET /api/hdb/flat-types endpoint for town-filtered flat type dropdown"
  ```

---

### Task 5: Update `market-report.njk` — town select HTMX attributes and slider default

- [ ] **Step 1: Update the town select in `src/views/pages/public/market-report.njk` (line 16)**

  Replace the HTMX attributes on the town `<select>` element. Change from:

  ```html
  <select id="town" name="town" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white" hx-get="/api/hdb/storey-ranges" hx-include="#market-report-form" hx-target="#storey-range-select" hx-trigger="change">
  ```

  To:

  ```html
  <select id="town" name="town" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white" hx-get="/api/hdb/flat-types" hx-target="#flatType" hx-swap="innerHTML" hx-trigger="change">
  ```

  **Why these changes:**
  - `hx-get` now points to the new flat-types endpoint
  - `hx-target="#flatType"` targets the flat-type select for the primary swap
  - `hx-swap="innerHTML"` replaces the select's option children (valid HTMX usage)
  - `hx-include` is removed — HTMX automatically sends the triggering element's own `name`/`value` (`town=<value>`) without needing `hx-include`
  - The storey-range reset is handled by the OOB element in the response

  **Important:** The flat-type select (line 25) is **not changed** — it retains `hx-get="/api/hdb/storey-ranges" hx-include="#market-report-form" hx-trigger="change"`. The `hx-include` on the flat-type select must stay so that storey-range lookups receive both `town` and `flatType`.

- [ ] **Step 2: Fix the slider default in `market-report.njk` (lines 46, 48, 51)**

  Change the months label span (line 46):
  ```html
  <!-- from -->
  <span id="months-label" class="text-sm font-semibold text-[#c8553d]">2 Years</span>
  <!-- to -->
  <span id="months-label" class="text-sm font-semibold text-[#c8553d]">1 Year</span>
  ```

  Change the range input's value attribute (line 48, currently `value="3"`):
  ```html
  <!-- from -->
  <input type="range" id="months-slider" min="0" max="6" step="1" value="3"
  <!-- to -->
  <input type="range" id="months-slider" min="0" max="6" step="1" value="1"
  ```

  Change the hidden months-value (line 51, currently `value="24"`):
  ```html
  <!-- from -->
  <input type="hidden" id="months-value" name="months" value="24">
  <!-- to -->
  <input type="hidden" id="months-value" name="months" value="12">
  ```

  **Slider step-to-months mapping (from `public/js/app.js`):**

  | Step | Label | Months |
  |------|-------|--------|
  | 0 | 6 Months | 6 |
  | **1** | **1 Year** | **12** ← new default |
  | 2 | 2 Years | 24 |
  | 3 | 5 Years | 60 |
  | 4 | 10 Years | 120 |
  | 5 | 20 Years | 240 |
  | 6 | All Time | 0 |

  Setting `value="1"` on the range input places the slider at step 1. The hidden input `value="12"` ensures the correct months value is submitted on page load before the user interacts with the slider. The label "1 Year" matches.

- [ ] **Step 3: Verify the full test suite still passes**

  ```bash
  npm test --no-coverage
  ```

  Expected: all tests pass (no regressions)

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/pages/public/market-report.njk
  git commit -m "feat: wire town select to flat-types endpoint; fix slider default to 1 Year"
  ```

---

## Final Verification

- [ ] **Start the dev server and manually verify:**

  ```bash
  npm run dev
  ```

  1. Navigate to `http://localhost:3000/market-report`
  2. Confirm slider shows "1 Year" by default and slider thumb is at step 1 (second notch from left)
  3. Select a Town (e.g. "BISHAN") — Flat Type dropdown should update to only show types available in Bishan; Storey Range should reset to "All storeys"
  4. Select a Flat Type — Storey Range should update with ranges for that town+flat type combination
  5. Click Search with a valid Town + Flat Type — results should render correctly
  6. Select a different Town — Flat Type resets again, Storey Range resets to "All storeys"
