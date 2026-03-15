# HDB Sync Progress Bar — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an indeterminate animated progress bar with status text while HDB sync runs; redirect to the refreshed page when done.

**Architecture:** An in-memory `syncState` singleton tracks whether a sync is running. `POST /admin/hdb/sync` returns an HTMX progress bar partial that polls `GET /admin/hdb/sync/status` every 3s. When the sync finishes, the status endpoint sets an `HX-Redirect` header to reload the page.

**Tech Stack:** TypeScript, Express, HTMX, Nunjucks, Tailwind CSS

---

## Chunk 1: Backend — State, Service, Routes

### Task 1: Create `sync.state.ts` singleton

**Files:**
- Create: `src/domains/hdb/sync.state.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/domains/hdb/sync.state.ts
// In-memory sync state — resets to false on server restart.
// Safe for single-process Node.js. Do not use in multi-process deployments.
export const syncState = {
  running: false,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/hdb/sync.state.ts
git commit -m "feat: add in-memory syncState singleton for HDB sync progress"
```

---

### Task 2: Wire `syncState` into `triggerHdbSync` + add service tests

**Files:**
- Modify: `src/domains/admin/admin.service.ts` (lines ~443–457)
- Modify: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Write failing tests**

Open `src/domains/admin/__tests__/admin.service.test.ts`.

The file currently starts with `jest.mock(...)` calls (lines 6–16) followed by `import` statements. Jest hoists `jest.mock()` calls, so new mocks **must be placed in the existing mock block before any import statements** — not after the imports. Add these two lines inside the mock block, with the other `jest.mock()` calls at the top of the file:

```typescript
jest.mock('@/domains/hdb/sync.state', () => ({
  syncState: { running: false },
}));
jest.mock('@/domains/hdb/sync.service');
```

`HdbSyncService` in `src/domains/hdb/sync.service.ts` is an ES6 class with an instance method `sync()`, so `jest.MockedClass<typeof HdbSyncService>` and `.prototype.sync.mockImplementation(...)` work correctly.

Then add these two import lines alongside the other imports (after the mock block):

```typescript
import { syncState } from '@/domains/hdb/sync.state';
import { HdbSyncService } from '@/domains/hdb/sync.service';
```

Then add a new `describe` block at the bottom of the file:

```typescript
describe('triggerHdbSync', () => {
  const mockSyncService = HdbSyncService as jest.MockedClass<typeof HdbSyncService>;

  beforeEach(() => {
    jest.clearAllMocks();
    syncState.running = false;
  });

  it('sets syncState.running to true before firing sync', async () => {
    let runningDuringSync = false;
    mockSyncService.prototype.sync.mockImplementation(async () => {
      runningDuringSync = syncState.running;
      return {} as any;
    });
    mockAudit.log.mockResolvedValue(undefined as any);

    await adminService.triggerHdbSync('admin-1');

    // Flush the microtask queue so the fire-and-forget promise runs.
    // setImmediate fires after all pending Promise callbacks, so one tick
    // is enough for a single .finally() chain. If tests become flaky, add
    // a second `await new Promise((r) => setImmediate(r))` call.
    await new Promise((r) => setImmediate(r));

    expect(runningDuringSync).toBe(true);
  });

  it('clears syncState.running after sync completes', async () => {
    mockSyncService.prototype.sync.mockResolvedValue({} as any);
    mockAudit.log.mockResolvedValue(undefined as any);

    await adminService.triggerHdbSync('admin-1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r)); // flush .finally() chain

    expect(syncState.running).toBe(false);
  });

  it('clears syncState.running after sync fails', async () => {
    mockSyncService.prototype.sync.mockRejectedValue(new Error('API down'));
    mockAudit.log.mockResolvedValue(undefined as any);

    await adminService.triggerHdbSync('admin-1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r)); // flush .finally() chain

    expect(syncState.running).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="admin.service.test" 2>&1 | tail -20
```

Expected: FAIL — `syncState.running` remains `false` (state not set yet).

- [ ] **Step 3: Implement changes in `admin.service.ts`**

Add the import at the top of `src/domains/admin/admin.service.ts`, after existing HDB imports:

```typescript
import { syncState } from '@/domains/hdb/sync.state';
```

Replace the `triggerHdbSync` function body (lines ~443–457):

```typescript
export async function triggerHdbSync(adminId: string): Promise<void> {
  await auditService.log({
    agentId: adminId,
    action: 'hdb_sync.triggered_manually',
    entityType: 'hdbSync',
    entityId: 'manual',
    details: { triggeredBy: adminId },
  });

  syncState.running = true;
  const syncService = new HdbSyncService();
  syncService
    .sync()
    .catch(() => {
      // HdbSyncService logs its own errors — nothing to do here
    })
    .finally(() => {
      syncState.running = false;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="admin.service.test" 2>&1 | tail -20
```

Expected: PASS — all three new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat: set syncState.running during HDB sync lifecycle"
```

---

### Task 3: Add `GET /admin/hdb/sync/status` route

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Write the failing test**

Open `src/domains/admin/__tests__/admin.router.test.ts`. The file currently contains one `describe` block with a single `it`. Append a second `it` block inside the existing `describe` — do **not** replace the file:

```typescript
it('has a GET /admin/hdb/sync/status route', () => {
  const routes = adminRouter.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => ({
      path: layer.route.path,
      method: Object.keys(layer.route.methods)[0],
    }));
  expect(routes).toContainEqual({ path: '/admin/hdb/sync/status', method: 'get' });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="admin.router.test" 2>&1 | tail -20
```

Expected: FAIL — `routes` does not contain the status route.

- [ ] **Step 3: Add the route to `admin.router.ts`**

Add this import at the top of `src/domains/admin/admin.router.ts`, after existing imports:

```typescript
import { syncState } from '@/domains/hdb/sync.state';
```

Add the new route immediately after the `GET /admin/hdb` route (after line ~510).

> **Note on "done" state:** The design spec mentioned a `hdb-sync-done.njk` partial. This plan uses `HX-Redirect` instead — it's simpler and achieves the same goal: the admin sees updated stats and the latest sync history entry immediately after the page reloads. No separate done partial is needed.

```typescript
adminRouter.get(
  '/admin/hdb/sync/status',
  ...adminAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (syncState.running) {
        return res.render('partials/admin/hdb-progress');
      }
      // Sync is done — trigger full page reload so stats refresh
      res.setHeader('HX-Redirect', '/admin/hdb');
      return res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="admin.router.test" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full unit test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: add GET /admin/hdb/sync/status route for progress polling"
```

---

## Chunk 2: Frontend — Animation, Partials, Button

> **No `hdb-sync-done.njk` partial:** The spec described a separate done partial. This plan uses `HX-Redirect` instead (documented in Chunk 1, Task 3). When the sync finishes, the status endpoint sends `HX-Redirect: /admin/hdb`, causing HTMX to reload the full page. The admin sees updated stats and the new sync history entry immediately — no separate done partial is required.

### Task 4: Add shimmer animation to Tailwind config

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Add keyframe and animation to `tailwind.config.ts`**

**Do not replace the whole `theme.extend` block** — only add the two new keys. The existing `colors` block and any other keys must remain. Merge these into `theme.extend`:

```typescript
keyframes: {
  shimmer: {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(400%)' },
  },
},
animation: {
  shimmer: 'shimmer 1.5s ease-in-out infinite',
},
```

The result should look like:

```typescript
theme: {
  extend: {
    colors: {
      // existing colors unchanged
    },
    keyframes: {
      shimmer: {
        '0%': { transform: 'translateX(-100%)' },
        '100%': { transform: 'translateX(400%)' },
      },
    },
    animation: {
      shimmer: 'shimmer 1.5s ease-in-out infinite',
    },
  },
},
```

- [ ] **Step 2: Build Tailwind to verify no errors**

```bash
npm run build 2>&1 | grep -i "error\|warn" | head -20
```

Expected: no errors. `animate-shimmer` is now available.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat: add shimmer keyframe animation to Tailwind config"
```

---

### Task 5: Create `hdb-progress.njk` partial

**Files:**
- Create: `src/views/partials/admin/hdb-progress.njk`

- [ ] **Step 1: Create the partial**

```njk
{#
  partials/admin/hdb-progress.njk — indeterminate sync progress bar.
  This element re-registers its own HTMX polling via hx-trigger="every 3s"
  on every swap (outerHTML), keeping the poll alive while the sync runs.
  The mt-4 wrapper adds spacing below the button row.
#}
<div id="sync-result"
     hx-get="/admin/hdb/sync/status"
     hx-trigger="every 3s"
     hx-target="#sync-result"
     hx-swap="outerHTML">
  <div class="mt-4">
    <div class="relative w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div class="absolute h-2 w-1/3 bg-indigo-600 rounded-full animate-shimmer"></div>
    </div>
    <p class="text-sm text-gray-500 mt-2">{{ "Syncing HDB data, please wait..." | t }}</p>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/admin/hdb-progress.njk
git commit -m "feat: add HDB sync progress bar partial with HTMX polling"
```

---

### Task 6: Update `POST /admin/hdb/sync` to return progress partial

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (POST /admin/hdb/sync handler, ~lines 512–530)

- [ ] **Step 1: Modify the POST handler**

Find the `POST /admin/hdb/sync` route handler. Replace the entire handler body (the `try` block):

**Before:**
```typescript
try {
  const user = req.user as AuthenticatedUser;
  await adminService.triggerHdbSync(user.id);
  if (req.headers['hx-request']) {
    return res.render('partials/admin/team-action-result', {
      message: 'HDB sync triggered. Data will update shortly.',
      type: 'success',
    });
  }
  res.redirect('/admin/hdb');
} catch (err) {
  next(err);
}
```

**After:**
```typescript
try {
  // Guard: if already running, just show the progress bar — don't fire a second sync
  if (!syncState.running) {
    const user = req.user as AuthenticatedUser;
    await adminService.triggerHdbSync(user.id);
  }
  if (req.headers['hx-request']) {
    return res.render('partials/admin/hdb-progress');
  }
  res.redirect('/admin/hdb');
} catch (err) {
  next(err);
}
```

Note: `syncState` is already imported in this file from Task 3.

- [ ] **Step 2: Add router test for the POST handler guard**

Append to the `describe` block in `src/domains/admin/__tests__/admin.router.test.ts`:

```typescript
it('has a POST /admin/hdb/sync route', () => {
  const routes = adminRouter.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => ({
      path: layer.route.path,
      method: Object.keys(layer.route.methods)[0],
    }));
  expect(routes).toContainEqual({ path: '/admin/hdb/sync', method: 'post' });
});
```

Run the test to verify it passes (route already exists):

```bash
npm test -- --testPathPattern="admin.router.test" 2>&1 | tail -10
```

Expected: PASS — the existing POST route is found.

The guard logic (`if (!syncState.running)`) is covered by the service-level tests in Task 2: those tests verify that `triggerHdbSync` is called and sets/clears state. The router test confirms the route exists; the service test confirms the state contract.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Build the project**

```bash
npm run build 2>&1 | grep -i "error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: POST /admin/hdb/sync returns progress bar partial for HTMX requests"
```

---

## Chunk 3: Manual Verification

### Task 7: Smoke test in browser

- [ ] **Step 1: Start the dev server**

```bash
npm run docker:dev   # ensure DB is running
npm run dev
```

- [ ] **Step 2: Navigate to `/admin/hdb`**

Log in as admin, navigate to `http://localhost:3000/admin/hdb`.

- [ ] **Step 3: Click "Trigger Manual Sync"**

Expected:
- Button area is replaced immediately by the animated indeterminate progress bar
- Text "Syncing HDB data, please wait..." appears below the bar
- Bar slides left-to-right continuously

- [ ] **Step 4: Wait for sync to complete**

Expected:
- Page reloads automatically (HTMX `HX-Redirect`)
- Updated stats cards and sync history table are visible
- New sync log entry appears at the top of the history table

- [ ] **Step 5: Final commit (if any last tweaks needed)**

```bash
git add -p
git commit -m "fix: <description of any tweaks>"
```
