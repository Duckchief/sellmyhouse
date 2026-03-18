# Market Content Status Filter Buttons — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a row of status filter buttons to `/admin/content/market` matching the existing testimonials pattern.

**Architecture:** Add an optional `status` param through repository → service → router. The router passes `activeStatus` and `hasPendingReview` to the list partial, which renders filter buttons using HTMX to swap `#market-content-list`.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS

---

## Chunk 1: Backend filter support + router wiring

### Task 1: Repository — accept optional status filter

**Files:**
- Modify: `src/domains/content/content.repository.ts:66-71`

- [ ] **Step 1: Update `findAllMarketContent` signature and query**

  Replace:
  ```typescript
  export async function findAllMarketContent() {
    return prisma.marketContent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
  ```
  With:
  ```typescript
  export async function findAllMarketContent(status?: string) {
    return prisma.marketContent.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npm run build`
  Expected: No errors.

---

### Task 2: Service — forward status param

**Files:**
- Modify: `src/domains/content/content.service.ts` (the `listMarketContent` function, currently at line ~253)

- [ ] **Step 1: Update `listMarketContent` signature**

  Replace:
  ```typescript
  export async function listMarketContent() {
    return contentRepo.findAllMarketContent();
  }
  ```
  With:
  ```typescript
  export async function listMarketContent(status?: string) {
    return contentRepo.findAllMarketContent(status);
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npm run build`
  Expected: No errors.

---

### Task 3: Service unit test — `listMarketContent` with status filter

**Files:**
- Modify: `src/domains/content/content.service.test.ts`

Note: The test file uses `jest.mock('./content.repository')` and `const mockedRepo = jest.mocked(contentRepo)`. Add the new describe block anywhere after the `beforeEach`.

- [ ] **Step 1: Write the failing tests**

  Add this describe block to `content.service.test.ts`:
  ```typescript
  describe('listMarketContent', () => {
    it('calls repo with no filter when no status provided', async () => {
      mockedRepo.findAllMarketContent.mockResolvedValue([]);
      await contentService.listMarketContent();
      expect(mockedRepo.findAllMarketContent).toHaveBeenCalledWith(undefined);
    });

    it('calls repo with status filter when status provided', async () => {
      mockedRepo.findAllMarketContent.mockResolvedValue([]);
      await contentService.listMarketContent('pending_review');
      expect(mockedRepo.findAllMarketContent).toHaveBeenCalledWith('pending_review');
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npm test -- --testPathPattern=content.service.test`
  Expected: FAIL — `listMarketContent` not called with expected args.

- [ ] **Step 3: Verify tests now pass (after Task 2 is complete)**

  Run: `npm test -- --testPathPattern=content.service.test`
  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add src/domains/content/content.repository.ts \
          src/domains/content/content.service.ts \
          src/domains/content/content.service.test.ts
  git commit -m "feat: add optional status filter to listMarketContent"
  ```

---

### Task 4: Router — read `?status`, compute `hasPendingReview`, pass to template

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (GET `/admin/content/market` handler, ~lines 1010–1035)

- [ ] **Step 1: Update the GET handler**

  Replace the existing GET `/admin/content/market` handler body:
  ```typescript
  adminRouter.get(
    '/admin/content/market',
    ...adminAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const records = await contentService.listMarketContent();
        const notice =
          req.query['notice'] === 'no_data' ? 'Insufficient HDB data for the current period.' : null;
        if (req.headers['hx-request']) {
          return res.render('partials/admin/market-content-list', { records });
        }
        const user = req.user as AuthenticatedUser;
        const hasAvatar = await getHasAvatar(user.id);
        return res.render('pages/admin/market-content', {
          pageTitle: 'Market Content',
          user,
          hasAvatar,
          records,
          error: notice,
          currentPath: '/admin/content/market',
        });
      } catch (err) {
        return next(err);
      }
    },
  );
  ```
  With:
  ```typescript
  adminRouter.get(
    '/admin/content/market',
    ...adminAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const activeStatus = (req.query['status'] as string) || '';
        const records = await contentService.listMarketContent(activeStatus || undefined);
        const allRecords = activeStatus ? await contentService.listMarketContent() : records;
        const hasPendingReview = allRecords.some((r) => r.status === 'pending_review');
        const notice =
          req.query['notice'] === 'no_data' ? 'Insufficient HDB data for the current period.' : null;
        if (req.headers['hx-request']) {
          return res.render('partials/admin/market-content-list', {
            records,
            activeStatus,
            hasPendingReview,
          });
        }
        const user = req.user as AuthenticatedUser;
        const hasAvatar = await getHasAvatar(user.id);
        return res.render('pages/admin/market-content', {
          pageTitle: 'Market Content',
          user,
          hasAvatar,
          records,
          activeStatus,
          hasPendingReview,
          error: notice,
          currentPath: '/admin/content/market',
        });
      } catch (err) {
        return next(err);
      }
    },
  );
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npm run build`
  Expected: No errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/domains/admin/admin.router.ts
  git commit -m "feat: pass activeStatus and hasPendingReview to market content template"
  ```

---

## Chunk 2: Frontend — filter button row in the partial

### Task 5: Add filter buttons to `market-content-list.njk`

**Files:**
- Modify: `src/views/partials/admin/market-content-list.njk`

The current file starts with a `{% set statusColors %}` block. Add the filter buttons and the throb animation style before it.

- [ ] **Step 1: Add style + filter button row to the top of the partial**

  Prepend to `src/views/partials/admin/market-content-list.njk` (before the existing `{% set statusColors %}` line):
  ```nunjucks
  <style>
    @keyframes throb-review {
      0%, 100% { transform: scale(1);   background-color: #fefce8; border-color: #fde047; color: #a16207; }
      50%       { transform: scale(1.1); background-color: #fde047; border-color: #ca8a04; color: #78350f; }
    }
    .throb-review { animation: throb-review 1.4s ease-in-out infinite; }
  </style>

  {# Status filter buttons #}
  {% set filters = [
    { value: '',              label: 'All',             activeClass: 'border-2 border-indigo-600 text-indigo-600 bg-indigo-50 font-semibold',    inactiveClass: 'border border-indigo-200 text-indigo-400 hover:border-indigo-400 hover:text-indigo-600' },
    { value: 'ai_generated',  label: 'AI Generated',    activeClass: 'border-2 border-gray-500 text-gray-700 bg-gray-100 font-semibold',         inactiveClass: 'border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600' },
    { value: 'pending_review',label: 'Pending Review',  activeClass: 'border-2 border-yellow-500 text-yellow-800 bg-yellow-50 font-semibold',    inactiveClass: 'border border-yellow-300 text-yellow-500 hover:border-yellow-400 hover:text-yellow-700', throb: true },
    { value: 'approved',      label: 'Approved',        activeClass: 'border-2 border-green-600 text-green-800 bg-green-50 font-semibold',       inactiveClass: 'border border-green-300 text-green-500 hover:border-green-500 hover:text-green-700' },
    { value: 'rejected',      label: 'Rejected',        activeClass: 'border-2 border-red-500 text-red-700 bg-red-50 font-semibold',             inactiveClass: 'border border-red-200 text-red-400 hover:border-red-400 hover:text-red-600' },
    { value: 'published',     label: 'Published',       activeClass: 'border-2 border-blue-600 text-blue-800 bg-blue-50 font-semibold',          inactiveClass: 'border border-blue-200 text-blue-400 hover:border-blue-400 hover:text-blue-600' }
  ] %}
  <div class="flex flex-wrap gap-2 mb-4">
    {% for f in filters %}
    <button
      type="button"
      hx-get="/admin/content/market{% if f.value %}?status={{ f.value }}{% endif %}"
      hx-target="#market-content-list"
      hx-swap="innerHTML"
      class="px-3 py-1 text-sm rounded transition-colors
        {% if activeStatus == f.value or (not activeStatus and not f.value) %}
          {{ f.activeClass }}
        {% else %}
          {{ f.inactiveClass }}
        {% endif %}
        {% if f.throb and hasPendingReview %} throb-review{% endif %}">
      {{ f.label | t }}
    </button>
    {% endfor %}
  </div>
  ```

- [ ] **Step 2: Start the dev server and verify visually**

  Run: `npm run dev`
  - Open `http://localhost:3000/admin/content/market` (log in as admin first)
  - Confirm the 6 filter buttons appear above the table
  - Click each button — confirm the table updates via HTMX and the active button highlights
  - If any `pending_review` records exist, confirm the Pending Review button throbs

- [ ] **Step 3: Run full unit test suite**

  Run: `npm test`
  Expected: All tests pass (no regressions).

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/partials/admin/market-content-list.njk
  git commit -m "feat: add status filter buttons to market content list"
  ```
