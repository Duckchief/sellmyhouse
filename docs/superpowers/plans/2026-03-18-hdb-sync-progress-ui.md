# HDB Sync Progress UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the instant "sync triggered" message with an animated progress bar and HTMX polling that detects completion, then shows a success/failure banner and refreshes the stats panel.

**Architecture:** The sync button is wrapped in a `#sync-area` div that gets fully replaced by each state (idle → progress bar → complete banner). HTMX polls `GET /admin/hdb/sync/poll?since=<timestamp>` every 3 seconds; when a new sync log entry appears the poll returns the complete fragment (which also OOB-swaps the stats panel). No WebSockets, no SSE, no new service methods.

**Tech Stack:** HTMX, Nunjucks, Tailwind CSS, Express

**Spec deviations (improvements over spec):**
- Spec says use `#sync-result` as swap target with `innerHTML`. Plan uses `#sync-area` with `hx-swap="outerHTML"` so the button itself is replaced — this prevents double-trigger without needing `hx-disabled-elt`.
- Spec says wrap `hdb-status.njk` partial in `#hdb-stats`. Plan wraps the `{% include %}` call in `hdb.njk` instead, keeping the partial reusable and ID-free.

---

## Chunk 1: Templates and Route Changes

### Task 1: Update hdb.njk — add `#hdb-stats` wrapper and `#sync-area` button

**Files:**
- Modify: `src/views/pages/admin/hdb.njk`
- No change to `src/views/partials/admin/hdb-status.njk`

Two changes in the same file done in one task to avoid ordering conflicts:
1. Wrap the stats include in `<div id="hdb-stats">` so the OOB swap has a target.
2. Move the sync button inside a `<div id="sync-area">` so the progress partial can fully replace it (eliminating double-trigger risk).

The `hdb-status.njk` partial stays as-is. The ID wrapper is added only at the point of use.

- [ ] **Step 1: Read hdb.njk**

  Read `src/views/pages/admin/hdb.njk` in full. Note:
  - The `{% include "partials/admin/hdb-status.njk" %}` line near the top of the card
  - The `<div class="mt-4">` block further down containing the sync button and `#sync-result` div

- [ ] **Step 2: Wrap the stats include**

  Replace:
  ```html
      {% include "partials/admin/hdb-status.njk" %}
  ```
  With:
  ```html
      <div id="hdb-stats">{% include "partials/admin/hdb-status.njk" %}</div>
  ```

- [ ] **Step 3: Replace the button block**

  Replace the entire `<div class="mt-4">` block:
  ```html
      <div class="mt-4">
        <button
          class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm"
          hx-post="/admin/hdb/sync"
          hx-target="#sync-result"
          hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
        >{{ "Trigger Manual Sync" | t }}</button>
        <div id="sync-result" class="mt-3"></div>
      </div>
  ```
  With:
  ```html
      <div class="mt-4">
        <div id="sync-area">
          <button
            class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm"
            hx-post="/admin/hdb/sync"
            hx-target="#sync-area"
            hx-swap="outerHTML"
            hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
          >{{ "Trigger Manual Sync" | t }}</button>
        </div>
      </div>
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/pages/admin/hdb.njk
  git commit -m "feat: add #hdb-stats wrapper and #sync-area button to hdb.njk"
  ```

---

### Task 2: Create progress bar partial

**Files:**
- Create: `src/views/partials/admin/hdb-sync-progress.njk`

This partial renders the syncing state. It replaces `#sync-area` and re-triggers itself every 3s via HTMX polling.

- [ ] **Step 1: Create the file**

  ```html
  {# partials/admin/hdb-sync-progress.njk #}
  {# Context: since (ISO timestamp string) #}
  <div id="sync-area"
    hx-get="/admin/hdb/sync/poll?since={{ since }}"
    hx-trigger="every 3s"
    hx-target="this"
    hx-swap="outerHTML">
    <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-indigo-700">{{ "Syncing HDB data…" | t }}</span>
        <span class="text-xs text-indigo-400">{{ "Checking for updates every 3s" | t }}</span>
      </div>
      <div class="bg-indigo-200 rounded-full h-2 overflow-hidden">
        <div class="h-full w-full hdb-sync-stripe"></div>
      </div>
    </div>
  </div>

  <style>
    .hdb-sync-stripe {
      background: repeating-linear-gradient(
        -45deg,
        #6366f1 0px, #6366f1 12px,
        #818cf8 12px, #818cf8 24px
      );
      background-size: 34px 34px;
      animation: hdb-stripe 0.8s linear infinite;
    }
    @keyframes hdb-stripe {
      from { background-position: 0 0; }
      to   { background-position: 34px 0; }
    }
  </style>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/views/partials/admin/hdb-sync-progress.njk
  git commit -m "feat: add hdb-sync-progress partial (animated indeterminate bar)"
  ```

---

### Task 3: Create sync-complete partial

**Files:**
- Create: `src/views/partials/admin/hdb-sync-complete.njk`

This partial renders the success or failure banner and OOB-swaps the stats panel. Received context: `status` (HdbDataStatus), `success` (boolean), `recordsAdded` (number), `errorMessage` (string|null).

- [ ] **Step 1: Create the file**

  ```html
  {# partials/admin/hdb-sync-complete.njk #}
  {# Context: status, success, recordsAdded, errorMessage #}

  {# Main content — replaces #sync-area #}
  <div id="sync-area">
    {% if success %}
    <div class="bg-green-50 border border-green-300 rounded-lg p-4 flex items-start gap-3">
      <span class="text-green-500 text-xl leading-none mt-0.5">&#10003;</span>
      <div class="flex-1">
        <div class="text-sm font-semibold text-green-800">{{ "Sync complete" | t }}</div>
        <div class="text-xs text-green-700 mt-0.5">
          {{ recordsAdded }} {{ "new records added · Stats updated above" | t }}
        </div>
      </div>
      <button
        class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm shrink-0"
        hx-post="/admin/hdb/sync"
        hx-target="#sync-area"
        hx-swap="outerHTML"
        hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
      >{{ "Trigger Manual Sync" | t }}</button>
    </div>
    {% else %}
    <div class="bg-red-50 border border-red-300 rounded-lg p-4 flex items-start gap-3">
      <span class="text-red-500 text-xl leading-none mt-0.5">&#10005;</span>
      <div class="flex-1">
        <div class="text-sm font-semibold text-red-800">{{ "Sync failed" | t }}</div>
        {% if errorMessage %}
        <div class="text-xs text-red-700 mt-0.5">{{ errorMessage }}</div>
        {% endif %}
      </div>
      <button
        class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm shrink-0"
        hx-post="/admin/hdb/sync"
        hx-target="#sync-area"
        hx-swap="outerHTML"
        hx-confirm="{{ 'Trigger a manual HDB data sync? This may take several minutes.' | t }}"
      >{{ "Trigger Manual Sync" | t }}</button>
    </div>
    {% endif %}
  </div>

  {# OOB swap — refreshes #hdb-stats independently #}
  <div id="hdb-stats" hx-swap-oob="true">{% include "partials/admin/hdb-status.njk" %}</div>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/views/partials/admin/hdb-sync-complete.njk
  git commit -m "feat: add hdb-sync-complete partial (success/failure banner + OOB stats)"
  ```

---

### Task 4: Write failing router tests

**Files:**
- Modify: `src/domains/admin/__tests__/admin.router.test.ts`

Add a `describe` block for the two HDB sync endpoints. Write the tests first; they will fail because the routes aren't updated yet.

- [ ] **Step 1: Read the test file header** to confirm mock setup (jest.mock for adminService, makeApp helper). Note that `mockAdminService` is already typed as `jest.Mocked<typeof adminService>`.

- [ ] **Step 2: Add the test block**

  Append to `admin.router.test.ts`:
  ```typescript
  describe('POST /admin/hdb/sync — progress fragment', () => {
    beforeEach(() => {
      mockAdminService.triggerHdbSync.mockResolvedValue(undefined);
      mockAdminService.getHdbStatus.mockResolvedValue({
        totalRecords: 1000,
        dateRange: { earliest: '2017-01', latest: '2026-03' },
        lastSync: {
          id: 'sync-1',
          syncedAt: new Date('2026-03-18T10:00:00Z'),
          recordsAdded: 3,
          recordsTotal: 1000,
          source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
          status: 'success',
          error: null,
          createdAt: new Date('2026-03-18T10:00:00Z'),
        },
        recentSyncs: [],
      });
    });

    it('returns 200 and renders progress partial on HTMX request', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/admin/hdb/sync')
        .set('hx-request', 'true');
      expect(res.status).toBe(200);
      expect(mockAdminService.triggerHdbSync).toHaveBeenCalledWith('admin-1');
    });

    it('redirects to /admin/hdb on non-HTMX request', async () => {
      const app = makeApp();
      const res = await request(app).post('/admin/hdb/sync');
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/admin/hdb');
    });
  });

  describe('GET /admin/hdb/sync/poll — polling endpoint', () => {
    const sinceBefore = new Date('2026-03-18T09:00:00Z').toISOString();
    const sinceAfter  = new Date('2026-03-18T11:00:00Z').toISOString();

    beforeEach(() => {
      mockAdminService.getHdbStatus.mockResolvedValue({
        totalRecords: 1003,
        dateRange: { earliest: '2017-01', latest: '2026-03' },
        lastSync: {
          id: 'sync-1',
          syncedAt: new Date('2026-03-18T10:00:00Z'),
          recordsAdded: 3,
          recordsTotal: 1003,
          source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
          status: 'success',
          error: null,
          createdAt: new Date('2026-03-18T10:00:00Z'),
        },
        recentSyncs: [],
      });
    });

    it('returns 200 with complete fragment when lastSync is newer than since', async () => {
      const app = makeApp();
      const res = await request(app)
        .get(`/admin/hdb/sync/poll?since=${sinceBefore}`)
        .set('hx-request', 'true');
      expect(res.status).toBe(200);
      expect(mockAdminService.getHdbStatus).toHaveBeenCalled();
    });

    it('returns 200 with progress fragment when lastSync is older than since', async () => {
      const app = makeApp();
      const res = await request(app)
        .get(`/admin/hdb/sync/poll?since=${sinceAfter}`)
        .set('hx-request', 'true');
      expect(res.status).toBe(200);
      expect(mockAdminService.getHdbStatus).toHaveBeenCalled();
    });

    it('returns 200 with progress fragment when no lastSync exists', async () => {
      mockAdminService.getHdbStatus.mockResolvedValue({
        totalRecords: 0,
        dateRange: null,
        lastSync: null,
        recentSyncs: [],
      });
      const app = makeApp();
      const res = await request(app)
        .get(`/admin/hdb/sync/poll?since=${sinceBefore}`)
        .set('hx-request', 'true');
      expect(res.status).toBe(200);
    });

    it('returns 400 when since param is missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .get('/admin/hdb/sync/poll')
        .set('hx-request', 'true');
      expect(res.status).toBe(400);
    });

    it('returns 400 when since param is not a valid date', async () => {
      const app = makeApp();
      const res = await request(app)
        .get('/admin/hdb/sync/poll?since=garbage')
        .set('hx-request', 'true');
      expect(res.status).toBe(400);
    });
  });
  ```

- [ ] **Step 3: Run tests to confirm they fail**

  ```bash
  npx jest --config jest.config.ts admin.router.test
  ```
  Expected: the two new `describe` blocks fail with 404 (route doesn't exist yet) or render errors.

---

### Task 5: Update POST /admin/hdb/sync route

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (lines ~638–656)

Return the progress partial with a `since` timestamp instead of the generic message.

- [ ] **Step 1: Locate the POST /admin/hdb/sync handler**

  It's around line 638. The HTMX branch currently renders `partials/admin/team-action-result`.

- [ ] **Step 2: Replace the HTMX response**

  Change:
  ```typescript
      if (req.headers['hx-request']) {
        return res.render('partials/admin/team-action-result', {
          message: 'HDB sync triggered. Data will update shortly.',
          type: 'success',
        });
      }
  ```
  To:
  ```typescript
      if (req.headers['hx-request']) {
        return res.render('partials/admin/hdb-sync-progress', {
          since: new Date().toISOString(),
        });
      }
  ```

- [ ] **Step 3: Run the POST tests**

  ```bash
  npx jest --config jest.config.ts admin.router.test
  ```
  Expected: the `POST /admin/hdb/sync — progress fragment` tests now pass. The poll tests still fail (route doesn't exist).

- [ ] **Step 4: Commit**

  ```bash
  git add src/domains/admin/admin.router.ts
  git commit -m "feat: POST /admin/hdb/sync returns progress bar fragment"
  ```

---

### Task 6: Add GET /admin/hdb/sync/poll route

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (after the POST /admin/hdb/sync block, before the POST /admin/hdb/upload block)

- [ ] **Step 1: Insert the poll route**

  After the closing `);` of the POST `/admin/hdb/sync` handler (around line 656), and before the POST `/admin/hdb/upload` handler, insert:

  ```typescript
  adminRouter.get(
    '/admin/hdb/sync/poll',
    ...adminAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { since } = req.query as { since?: string };
        if (!since) {
          return res.status(400).send('Missing since param');
        }
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return res.status(400).send('Invalid since param');
        }
        const status = await adminService.getHdbStatus();

        const syncComplete =
          status.lastSync !== null && new Date(status.lastSync.syncedAt) > sinceDate;

        if (syncComplete) {
          return res.render('partials/admin/hdb-sync-complete', {
            status,
            success: status.lastSync!.status === 'success',
            recordsAdded: status.lastSync!.recordsAdded,
            errorMessage: status.lastSync!.error ?? null,
          });
        }

        return res.render('partials/admin/hdb-sync-progress', { since });
      } catch (err) {
        next(err);
      }
    },
  );
  ```

- [ ] **Step 2: Run all tests**

  ```bash
  npx jest --config jest.config.ts admin.router.test
  ```
  Expected: all tests in the new describe blocks pass.

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test
  ```
  Expected: all existing tests continue to pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/domains/admin/admin.router.ts
  git commit -m "feat: add GET /admin/hdb/sync/poll endpoint for sync completion detection"
  ```

---

### Task 7: Smoke test

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```

- [ ] **Step 2: Navigate to `/admin/hdb`**

  Confirm the "Trigger Manual Sync" button is visible.

- [ ] **Step 3: Click the button and confirm the dialog**

  Confirm:
  - The button disappears and the striped progress bar animates in its place
  - The label "Syncing HDB data… / Checking for updates every 3s" is visible

- [ ] **Step 4: Wait for sync to complete (up to ~2 minutes)**

  Confirm:
  - The progress bar is replaced by a green "Sync complete — N new records added" banner
  - The stats panel at the top updates to show the new total and last sync time
  - The "Trigger Manual Sync" button returns inside the banner

- [ ] **Step 5: Verify error state (optional)**

  Temporarily break the sync service (e.g., set an invalid API URL in `.env`) and re-trigger. Confirm the red "Sync failed" banner appears.
