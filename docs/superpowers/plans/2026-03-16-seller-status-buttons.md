# Seller Status Buttons Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-facing status advancement and archive buttons to the seller detail page header, with a note-capturing modal for transitions that require one.

**Architecture:** Three-layer change — service accepts an optional `note` parameter and validates it per transition, the router adds a modal-render GET route (passing `noteRequired` to the template) and threads `note` through the existing PUT route, and three new Nunjucks partials handle the button display, modal UI, and HTMX re-render target. On success, HTMX swaps `#seller-header` outerHTML with a fresh render from the server.

**Tech Stack:** TypeScript, Express, Nunjucks, HTMX, Tailwind CSS, Jest

**Spec:** `docs/superpowers/specs/2026-03-16-seller-status-buttons-design.md`

---

## Note requirements (per spec + user confirmation)

| Transition | Note required? |
|---|---|
| lead → engaged | Yes — "Consultation note" |
| engaged → active | Yes — "Activation note" |
| active → completed | **No** |
| any → archived | Yes — "Reason for archiving" |

---

## Chunk 1: Service — note parameter + validation

### Files
- Modify: `src/domains/seller/seller.service.ts` (lines 303–342)
- Modify: `src/domains/seller/__tests__/seller.service.test.ts`

---

### Task 1: Write failing tests for note validation

- [ ] **Step 1: Add tests to seller.service.test.ts**

Open `src/domains/seller/__tests__/seller.service.test.ts`. In the existing `updateSellerStatus` describe block, add these tests after the existing ones:

```typescript
it('throws ValidationError when note is missing for lead→engaged transition', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);

  await expect(
    sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', undefined),
  ).rejects.toThrow(ValidationError);
});

it('throws ValidationError when note is missing for engaged→active transition', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'engaged' } as Seller);

  await expect(
    sellerService.updateSellerStatus('seller-1', 'active', 'agent-1', undefined),
  ).rejects.toThrow(ValidationError);
});

it('throws ValidationError when note is missing for any archive transition', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);

  await expect(
    sellerService.updateSellerStatus('seller-1', 'archived', 'agent-1', undefined),
  ).rejects.toThrow(ValidationError);
});

it('does NOT require note for active→completed transition', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'active' } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'completed',
  } as Seller);

  await expect(
    sellerService.updateSellerStatus('seller-1', 'completed', 'agent-1', undefined),
  ).resolves.not.toThrow();
});

it('includes note in audit log details when provided', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'lead' } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'engaged',
    consultationCompletedAt: new Date(),
  } as Seller);

  await sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', 'Seller is motivated');

  expect(mockedAuditService.log).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({ note: 'Seller is motivated' }),
    }),
  );
});

it('omits note from audit log when not provided', async () => {
  mockedSellerRepo.findById.mockResolvedValue({ id: 'seller-1', status: 'active' } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'completed',
  } as Seller);

  await sellerService.updateSellerStatus('seller-1', 'completed', 'agent-1', undefined);

  expect(mockedAuditService.log).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.not.objectContaining({ note: expect.anything() }),
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="seller.service.test" --no-coverage
```

Expected: FAIL — `updateSellerStatus` does not accept a 4th param yet.

---

### Task 2: Implement note param + validation in seller.service.ts

- [ ] **Step 1: Add `NOTE_REQUIRED_TRANSITIONS` and update `updateSellerStatus`**

In `src/domains/seller/seller.service.ts`, insert the constant before `updateSellerStatus` (before line 311) and replace the function:

```typescript
const NOTE_REQUIRED_TRANSITIONS = new Set([
  'lead→engaged',
  'engaged→active',
  'lead→archived',
  'engaged→archived',
  'active→archived',
  'completed→archived',
]);

export async function updateSellerStatus(
  sellerId: string,
  newStatus: string,
  agentId: string,
  note?: string,
): Promise<Seller> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const allowed = STATUS_TRANSITIONS[seller.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(`Cannot transition seller from '${seller.status}' to '${newStatus}'`);
  }

  const transitionKey = `${seller.status}→${newStatus}`;
  if (NOTE_REQUIRED_TRANSITIONS.has(transitionKey) && !note?.trim()) {
    throw new ValidationError('A note is required for this status transition');
  }

  const updateData: { status: SellerStatus; consultationCompletedAt?: Date } = {
    status: newStatus as SellerStatus,
  };
  if (newStatus === 'engaged') {
    updateData.consultationCompletedAt = new Date();
  }

  const updated = await sellerRepo.updateSellerStatus(sellerId, updateData);

  await auditService.log({
    agentId,
    action: 'seller.status_changed',
    entityType: 'seller',
    entityId: sellerId,
    details: { previousStatus: seller.status, newStatus, ...(note ? { note } : {}) },
  });

  return updated;
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="seller.service.test" --no-coverage
```

Expected: All tests in the `updateSellerStatus` describe block pass.

- [ ] **Step 3: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/__tests__/seller.service.test.ts
git commit -m "feat: updateSellerStatus accepts note param with per-transition validation"
```

---

## Chunk 2: Router — modal route + note threading

### Files
- Modify: `src/domains/agent/agent.router.ts`
- Modify (or create): `src/domains/agent/__tests__/agent.router.test.ts`

> **Note on router tests:** Check if `src/domains/agent/__tests__/agent.router.test.ts` exists. If not, look at `src/domains/seller/__tests__/seller.router.test.ts` for the Supertest mock pattern used in this project.

---

### Task 3: Write failing router tests

- [ ] **Step 1: Add tests for GET /agent/sellers/:id/status-modal**

In the agent router test file, add a describe block:

```typescript
describe('GET /agent/sellers/:id/status-modal', () => {
  it('returns 200 with advance modal data for a lead seller', async () => {
    mockAgentService.getSellerDetail.mockResolvedValue({ id: 'seller-1', status: 'lead' });

    const res = await request(app)
      .get('/agent/sellers/seller-1/status-modal?action=advance')
      .set('Cookie', agentSessionCookie);

    expect(res.status).toBe(200);
  });

  it('returns 400 when action=advance and seller status is archived', async () => {
    mockAgentService.getSellerDetail.mockResolvedValue({ id: 'seller-1', status: 'archived' });

    const res = await request(app)
      .get('/agent/sellers/seller-1/status-modal?action=advance')
      .set('Cookie', agentSessionCookie);

    expect(res.status).toBe(400);
  });

  it('returns 200 for archive action on any non-archived seller', async () => {
    mockAgentService.getSellerDetail.mockResolvedValue({ id: 'seller-1', status: 'engaged' });

    const res = await request(app)
      .get('/agent/sellers/seller-1/status-modal?action=archive')
      .set('Cookie', agentSessionCookie);

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Add tests for PUT /agent/sellers/:id/status note threading**

In the same or adjacent describe block:

```typescript
describe('PUT /agent/sellers/:id/status — note threading', () => {
  it('passes note to sellerService.updateSellerStatus', async () => {
    mockSellerService.updateSellerStatus.mockResolvedValue({ id: 'seller-1', status: 'engaged' });

    await request(app)
      .put('/agent/sellers/seller-1/status')
      .set('Cookie', agentSessionCookie)
      .send({ status: 'engaged', note: 'Consultation done' });

    expect(mockSellerService.updateSellerStatus).toHaveBeenCalledWith(
      'seller-1',
      'engaged',
      expect.any(String),
      'Consultation done',
    );
  });

  it('returns 422 when service throws ValidationError for missing note', async () => {
    mockSellerService.updateSellerStatus.mockRejectedValue(
      new ValidationError('A note is required for this status transition'),
    );

    const res = await request(app)
      .put('/agent/sellers/seller-1/status')
      .set('Cookie', agentSessionCookie)
      .send({ status: 'engaged' });

    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="agent.router.test" --no-coverage
```

Expected: FAIL — routes don't exist yet / note not threaded.

---

### Task 4: Implement the routes

- [ ] **Step 1: Add GET /agent/sellers/:id/status-modal route**

In `src/domains/agent/agent.router.ts`, insert this block after the closing of the `GET /agent/sellers/:id` handler (after line ~144):

```typescript
// GET /agent/sellers/:id/status-modal — HTMX: render status change modal
agentRouter.get(
  '/agent/sellers/:id/status-modal',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const seller = await agentService.getSellerDetail(
        req.params['id'] as string,
        getAgentFilter(user),
      );

      const action = req.query['action'] as string;

      const NEXT_STATUS: Record<string, string> = {
        lead: 'engaged',
        engaged: 'active',
        active: 'completed',
      };

      // title, label, noteRequired per transition
      const ADVANCE_META: Record<string, { title: string; label: string; noteRequired: boolean }> =
        {
          engaged: { title: 'Mark as Engaged', label: 'Consultation note', noteRequired: true },
          active: { title: 'Mark as Active', label: 'Activation note', noteRequired: true },
          completed: { title: 'Mark as Completed', label: 'Completion note', noteRequired: false },
        };

      let nextStatus: string;
      let title: string;
      let label: string;
      let noteRequired: boolean;

      if (action === 'archive') {
        nextStatus = 'archived';
        title = 'Archive Seller';
        label = 'Reason for archiving';
        noteRequired = true;
      } else {
        nextStatus = NEXT_STATUS[seller.status];
        if (!nextStatus) {
          return res.status(400).send('No advance action available for this status');
        }
        const meta = ADVANCE_META[nextStatus];
        if (!meta) {
          return res.status(400).send('Unrecognised next status');
        }
        title = meta.title;
        label = meta.label;
        noteRequired = meta.noteRequired;
      }

      return res.render('partials/agent/seller-status-modal', {
        seller,
        nextStatus,
        title,
        label,
        noteRequired,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Update PUT /agent/sellers/:id/status to thread `note`**

Replace the existing PUT handler body (around line 287–314) with:

```typescript
// PUT /agent/sellers/:id/status — update seller status
agentRouter.put(
  '/agent/sellers/:id/status',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_STATUSES = ['lead', 'engaged', 'active', 'completed', 'archived'];
      const { status, note } = req.body as { status?: string; note?: string };

      if (!status || !VALID_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status value' } });
      }

      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await sellerService.updateSellerStatus(sellerId, status, user.id, note);

      if (req.headers['hx-request']) {
        const seller = await agentService.getSellerDetail(sellerId, getAgentFilter(user));
        return res.render('partials/agent/seller-header', { seller });
      }

      return res.status(200).json({ seller: { id: sellerId, status } });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 3: Run router tests to verify they pass**

```bash
npm test -- --testPathPattern="agent.router.test" --no-coverage
```

Expected: New tests pass.

- [ ] **Step 4: Run full unit suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: All previously passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat: add status-modal route and thread note through PUT /agent/sellers/:id/status"
```

---

## Chunk 3: Templates

### Files
- Create: `src/views/partials/agent/seller-header.njk`
- Create: `src/views/partials/agent/seller-status-buttons.njk`
- Create: `src/views/partials/agent/seller-status-modal.njk`
- Modify: `src/views/pages/agent/seller-detail.njk`

> **Note on `remove-element`:** The Cancel button uses `data-action="remove-element"` with `data-target="<id>"`. This is handled by the global event listener at `public/js/app.js:75–77` which calls `document.getElementById(el.dataset.target).remove()`. This pattern is already used by `partials/admin/assign-modal.njk` and others — no new JS needed.

---

### Task 5: Create seller-status-buttons.njk

- [ ] **Step 1: Create the file**

`src/views/partials/agent/seller-status-buttons.njk`:

```njk
{% if seller.status == 'lead' %}
  <button
    class="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
    hx-get="/agent/sellers/{{ seller.id }}/status-modal?action=advance"
    hx-target="#modal-container"
    hx-swap="innerHTML">
    {{ "Mark Engaged" | t }}
  </button>
{% elif seller.status == 'engaged' %}
  <button
    class="px-4 py-2 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700"
    hx-get="/agent/sellers/{{ seller.id }}/status-modal?action=advance"
    hx-target="#modal-container"
    hx-swap="innerHTML">
    {{ "Mark Active" | t }}
  </button>
{% elif seller.status == 'active' %}
  <button
    class="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
    hx-get="/agent/sellers/{{ seller.id }}/status-modal?action=advance"
    hx-target="#modal-container"
    hx-swap="innerHTML">
    {{ "Mark Completed" | t }}
  </button>
{% endif %}

{% if seller.status != 'archived' %}
  <button
    class="px-4 py-2 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
    hx-get="/agent/sellers/{{ seller.id }}/status-modal?action=archive"
    hx-target="#modal-container"
    hx-swap="innerHTML">
    {{ "Archive" | t }}
  </button>
{% endif %}
```

---

### Task 6: Create seller-status-modal.njk

The modal uses `hx-swap="outerHTML"` on `#seller-header`. On success HTMX replaces that element entirely, which removes `#modal-container` (and the modal inside it) from the DOM automatically — no separate JS removal needed.

- [ ] **Step 1: Create the file**

`src/views/partials/agent/seller-status-modal.njk`:

```njk
<div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" id="status-modal">
  <div class="bg-white rounded-lg shadow-xl p-6 w-96">
    <h3 class="text-lg font-semibold mb-4">{{ title | t }}</h3>

    <div id="modal-error" class="hidden mb-3 p-3 bg-red-50 text-red-700 text-sm rounded"></div>

    <form
      hx-put="/agent/sellers/{{ seller.id }}/status"
      hx-target="#seller-header"
      hx-swap="outerHTML"
      hx-on::response-error="
        const el = document.getElementById('modal-error');
        el.textContent = 'An error occurred. Please try again.';
        el.classList.remove('hidden');
      "
    >
      <input type="hidden" name="status" value="{{ nextStatus }}">

      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">{{ label | t }}</label>
        <textarea
          name="note"
          {% if noteRequired %}required{% endif %}
          rows="3"
          class="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="{{ 'Add a note...' | t }}"></textarea>
      </div>

      <div class="flex gap-3 justify-end">
        <button
          type="button"
          data-action="remove-element"
          data-target="status-modal"
          class="px-4 py-2 text-sm border rounded hover:bg-gray-50">
          {{ "Cancel" | t }}
        </button>
        <button
          type="submit"
          class="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
          {{ "Confirm" | t }}
        </button>
      </div>
    </form>
  </div>
</div>
```

---

### Task 7: Create seller-header.njk partial

This partial is the HTMX re-render target. It also replaces the inline header block that currently lives in `seller-detail.njk`.

- [ ] **Step 1: Create the file**

`src/views/partials/agent/seller-header.njk`:

```njk
<div id="seller-header" class="flex items-center justify-between mb-6">
  <div>
    <h1 class="text-2xl font-bold">{{ seller.name }}</h1>
    <p class="text-gray-500">{{ seller.phone }} · {{ seller.email or "No email" }}</p>
  </div>
  <div class="flex items-center gap-3">
    <span class="px-3 py-1 text-sm rounded-full
      {% if seller.status == 'lead' %}bg-blue-100 text-blue-800
      {% elif seller.status == 'engaged' %}bg-yellow-100 text-yellow-800
      {% elif seller.status == 'active' %}bg-green-100 text-green-800
      {% elif seller.status == 'completed' %}bg-gray-100 text-gray-800
      {% elif seller.status == 'archived' %}bg-red-100 text-red-800
      {% endif %}">{{ seller.status | t }}</span>
    {% include "partials/agent/seller-status-buttons.njk" %}
  </div>
  <div id="modal-container"></div>
</div>
```

---

### Task 8: Update seller-detail.njk

- [ ] **Step 1: Replace the inline header with the new partial**

In `src/views/pages/agent/seller-detail.njk`, replace the entire file content with:

```njk
{% extends "layouts/agent.njk" %}

{% block content %}
<div class="mb-4">
  <a href="/agent/sellers" class="text-sm text-blue-600 hover:underline">← {{ "Back to Sellers" | t }}</a>
</div>

{% include "partials/agent/seller-header.njk" %}

<!-- Tabs -->
<div class="border-b mb-6">
  <nav class="flex gap-6 -mb-px" id="seller-tabs">
    <button class="tab-btn pb-3 border-b-2 border-blue-600 text-blue-600 text-sm font-medium" data-tab="overview">{{ "Overview" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="timeline" hx-get="/agent/sellers/{{ seller.id }}/timeline" hx-target="#tab-content" hx-swap="innerHTML">{{ "Timeline" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="compliance" hx-get="/agent/sellers/{{ seller.id }}/compliance" hx-target="#tab-content" hx-swap="innerHTML">{{ "Compliance" | t }}</button>
    <button class="tab-btn pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm font-medium" data-tab="notifications" hx-get="/agent/sellers/{{ seller.id }}/notifications" hx-target="#tab-content" hx-swap="innerHTML">{{ "Notifications" | t }}</button>
  </nav>
</div>

<div id="tab-content">
  {% include "partials/agent/seller-overview.njk" %}
</div>
{% endblock %}
```

- [ ] **Step 2: Build Tailwind to pick up new classes**

```bash
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 3: Run tests to verify no regressions from template changes**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/agent/seller-detail.njk \
        src/views/partials/agent/seller-header.njk \
        src/views/partials/agent/seller-status-buttons.njk \
        src/views/partials/agent/seller-status-modal.njk
git commit -m "feat: add seller status buttons and modal partials to seller detail page"
```

---

## Chunk 4: Smoke test + push

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: All tests pass.

- [ ] **Step 2: Manually verify in dev**

```bash
npm run docker:dev
npm run dev
```

Navigate to `/agent/sellers/:id` for a seller with each status. Verify:

| Status | Expected |
|---|---|
| `lead` | "Mark Engaged" + "Archive" buttons visible |
| `engaged` | "Mark Active" + "Archive" buttons visible |
| `active` | "Mark Completed" + "Archive" buttons visible |
| `completed` | "Archive" button only |
| `archived` | No buttons |

For each modal:
- "Mark Engaged" → textarea has `required`, labelled "Consultation note"
- "Mark Active" → textarea has `required`, labelled "Activation note"
- "Mark Completed" → textarea is optional, labelled "Completion note"
- "Archive" → textarea has `required`, labelled "Reason for archiving"

After a successful status change: status badge updates in-place, correct buttons for new status shown, no page reload.

- [ ] **Step 3: Push**

```bash
git push
```
