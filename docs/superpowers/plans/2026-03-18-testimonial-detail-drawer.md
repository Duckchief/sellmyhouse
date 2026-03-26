# Testimonial Detail Drawer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a testimonial row opens a read-only detail view in the existing slide-in drawer, with Approve/Reject buttons shown only for `pending_review` entries.

**Architecture:** A new `GET /admin/content/testimonials/:id` route fetches the testimonial and renders a new `testimonial-detail-drawer.njk` partial into the existing `#testimonial-drawer-content` div. The existing HTMX drawer JS already handles opening (detects content loaded into `#testimonial-drawer-content`) and closing after approve/reject (detects successful POST from inside `#testimonial-drawer-panel` targeting `#testimonial-list`). The approve/reject routes gain an HTMX branch that returns the refreshed list partial instead of redirecting.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Tailwind CSS, Jest

---

## File Map

| File | Change |
|---|---|
| `src/domains/content/content.service.ts` | Add `getTestimonialById` named export |
| `src/domains/content/content.service.test.ts` | Add unit tests for `getTestimonialById` |
| `src/domains/admin/admin.router.ts` | Add `GET /:id`; update approve + reject HTMX responses |
| `src/domains/admin/__tests__/admin.router.test.ts` | Integration tests for new/updated routes |
| `src/views/partials/admin/testimonial-detail-drawer.njk` | New — read-only detail partial |
| `src/views/partials/admin/testimonial-list.njk` | Add `hx-get` + `cursor-pointer` to clickable rows |

---

## Chunk 1: Service, Routes, Views

### Task 1: Add `getTestimonialById` to content service (TDD)

**Files:**
- Modify: `src/domains/content/content.service.ts`
- Modify: `src/domains/content/content.service.test.ts`

**Context:** `contentRepo.findTestimonialById(id)` already exists in `content.repository.ts` as `prisma.testimonial.findUnique({ where: { id } })`. The service just needs a thin wrapper that throws `NotFoundError` if the record is null. Follow the same pattern as `getTestimonialByToken` directly above it.

- [ ] **Step 1: Write failing tests**

In `src/domains/content/content.service.test.ts`, find the `// ─── rejectTestimonial` section and add before it:

```typescript
// ─── getTestimonialById ───────────────────────────────────────────────────────

describe('getTestimonialById', () => {
  it('returns the testimonial when found', async () => {
    const mock = { id: 't-1', clientName: 'Mary L.', status: 'approved' } as Testimonial;
    mockedRepo.findTestimonialById.mockResolvedValue(mock);

    const result = await contentService.getTestimonialById('t-1');

    expect(mockedRepo.findTestimonialById).toHaveBeenCalledWith('t-1');
    expect(result).toEqual(mock);
  });

  it('throws NotFoundError when not found', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(null);

    await expect(contentService.getTestimonialById('missing')).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2
npx jest --testPathPatterns="content.service.test" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `contentService.getTestimonialById is not a function`.

- [ ] **Step 3: Implement the service method**

In `src/domains/content/content.service.ts`, add after `getTestimonialBySeller` (around line 340):

```typescript
export async function getTestimonialById(id: string) {
  const testimonial = await contentRepo.findTestimonialById(id);
  if (!testimonial) throw new NotFoundError('Testimonial', id);
  return testimonial;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest --testPathPatterns="content.service.test" --no-coverage 2>&1 | tail -8
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/content/content.service.ts src/domains/content/content.service.test.ts
git commit -m "feat: add getTestimonialById service method"
```

---

### Task 2: Add GET /:id route and update approve/reject in admin.router.ts

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

**Context:** The existing approve/reject routes (lines ~1094–1120) do an unconditional redirect. We add an HTMX branch that returns the refreshed list partial instead. The new GET route must be registered **before** `POST /:id/approve` to avoid Express treating `approve` as a dynamic `:id` segment. The `makeApp()` test helper stubs `res.render` to always return 200.

The GET route should **not** include `pending_submission` guard logic — the template never wires those rows with `hx-get`, so the route just serves whatever status it finds.

- [ ] **Step 1: Write failing integration tests**

In `src/domains/admin/__tests__/admin.router.test.ts`, add after the existing POST testimonials describe block:

```typescript
describe('GET /admin/content/testimonials/:id', () => {
  it('returns 200 with drawer partial for a known testimonial', async () => {
    jest.mocked(contentService.getTestimonialById).mockResolvedValue({
      id: 't-1',
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Great service!',
      source: null,
      isManual: false,
      status: 'approved',
      displayOnWebsite: true,
    } as any);

    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/t-1');
    expect(res.status).toBe(200);
    expect(contentService.getTestimonialById).toHaveBeenCalledWith('t-1');
  });

  it('returns 404 for an unknown testimonial', async () => {
    const { NotFoundError } = await import('@/domains/shared/errors');
    jest.mocked(contentService.getTestimonialById).mockRejectedValue(
      new NotFoundError('Testimonial', 'bad-id'),
    );

    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/bad-id');
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/content/testimonials/:id/approve — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.approveTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/approve')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.approveTestimonial).toHaveBeenCalledWith('t-1', 'admin-1');
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.approveTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/testimonials/t-1/approve');
    expect(res.status).toBe(302);
  });
});

describe('POST /admin/content/testimonials/:id/reject — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.rejectTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/reject')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.rejectTestimonial).toHaveBeenCalledWith('t-1', 'admin-1');
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.rejectTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/testimonials/t-1/reject');
    expect(res.status).toBe(302);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPatterns="admin.router.test" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — 404 for the GET route, wrong status for HTMX approve/reject.

- [ ] **Step 3: Add GET /admin/content/testimonials/:id route**

In `src/domains/admin/admin.router.ts`, find the `POST /admin/content/testimonials/:id/approve` route (line ~1094). Insert the new GET route **immediately before it**:

```typescript
// Detail drawer partial — loads testimonial into the slide-in drawer
adminRouter.get(
  '/admin/content/testimonials/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getTestimonialById(req.params['id'] as string);
      if (!req.headers['hx-request']) {
        return res.redirect('/admin/content/testimonials');
      }
      return res.render('partials/admin/testimonial-detail-drawer', { record });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Update POST /admin/content/testimonials/:id/approve**

Replace the existing approve route body with:

```typescript
adminRouter.post(
  '/admin/content/testimonials/:id/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.approveTestimonial(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 5: Update POST /admin/content/testimonials/:id/reject**

Replace the existing reject route body with:

```typescript
adminRouter.post(
  '/admin/content/testimonials/:id/reject',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.rejectTestimonial(req.params['id'] as string, user.id);
      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
npx jest --testPathPatterns="admin.router.test" --no-coverage 2>&1 | tail -8
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: add GET testimonial detail route; HTMX responses for approve/reject"
```

---

### Task 3: Create testimonial-detail-drawer.njk partial

**Files:**
- Create: `src/views/partials/admin/testimonial-detail-drawer.njk`

**Context:** A single partial renders all three visible states (approved, pending_review, rejected) using Nunjucks conditionals. Uses the same CSS conventions as `testimonial-add-drawer.njk` (`input-field`, `btn-primary`, `| t` filter on all user-facing strings). Status badge colours match `testimonial-list.njk`. For the rating display, render filled/empty stars from `record.rating` using a Nunjucks loop — no JS, no radio inputs.

- [ ] **Step 1: Create the partial**

```njk
{#
  testimonial-detail-drawer.njk
  Read-only detail view of a single testimonial.
  Used by: GET /admin/content/testimonials/:id (loaded into #testimonial-drawer-content)
  pending_review: shows Approve + Reject buttons (hx-post → refreshes #testimonial-list, drawer closes via existing JS)
  approved / rejected: read-only, no action buttons
#}

{% set statusColors = {
  pending_submission: "bg-gray-100 text-gray-700",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700"
} %}

<div class="p-6 flex flex-col gap-4 min-h-full">

  {# Header #}
  <div class="flex items-center justify-between mb-2">
    <div>
      <h2 class="text-lg font-semibold text-gray-900">{{ record.clientName }}</h2>
      <span class="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium {{ statusColors[record.status] }}">
        {{ record.status | replace('_', ' ') | t }}
      </span>
    </div>
    <button
      type="button"
      data-action="close-testimonial-drawer"
      aria-label="{{ 'Close' | t }}"
      class="text-gray-400 hover:text-gray-600 p-1 rounded flex-shrink-0">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>

  {# Town + source #}
  <div class="flex items-center gap-2 text-sm text-gray-500">
    <span>{{ record.clientTown }}</span>
    <span class="text-gray-300">·</span>
    {% if record.isManual %}
      <span class="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">{{ "Manual" | t }}</span>
      {% if record.source %}<span class="text-xs text-gray-400">{{ record.source }}</span>{% endif %}
    {% else %}
      <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{{ "Seller" | t }}</span>
    {% endif %}
  </div>

  {# Rating — read-only stars #}
  <div>
    <p class="text-xs font-medium text-gray-500 uppercase mb-1">{{ "Rating" | t }}</p>
    <div class="flex gap-0.5 text-2xl leading-none">
      {% for i in range(1, 6) %}
        {% if i <= record.rating %}
          <span class="text-amber-400">★</span>
        {% else %}
          <span class="text-gray-200">★</span>
        {% endif %}
      {% endfor %}
    </div>
  </div>

  {# Testimonial text #}
  <div>
    <p class="text-xs font-medium text-gray-500 uppercase mb-1">{{ "Testimonial" | t }}</p>
    <p class="text-sm text-gray-800 leading-relaxed">{{ record.content }}</p>
  </div>

  {# Featured status — approved only #}
  {% if record.status == 'approved' %}
  <div class="flex items-center justify-between py-2 border-t border-gray-100">
    <span class="text-sm text-gray-500">{{ "Featured on website" | t }}</span>
    {% if record.displayOnWebsite %}
      <span class="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{{ "Yes" | t }}</span>
    {% else %}
      <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">{{ "No" | t }}</span>
    {% endif %}
  </div>
  {% endif %}

  {# Action buttons — pending_review only #}
  {% if record.status == 'pending_review' %}
  <div class="flex gap-2 pt-2 mt-auto">
    <button
      hx-post="/admin/content/testimonials/{{ record.id }}/approve"
      hx-target="#testimonial-list"
      hx-swap="innerHTML"
      class="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-4 rounded transition-colors">
      {{ "✓ Approve" | t }}
    </button>
    <button
      hx-post="/admin/content/testimonials/{{ record.id }}/reject"
      hx-target="#testimonial-list"
      hx-swap="innerHTML"
      class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded transition-colors">
      {{ "✕ Reject" | t }}
    </button>
  </div>
  {% else %}
  <p class="text-xs text-gray-400 text-center pt-2 mt-auto">
    {% if record.status == 'approved' %}
      {{ "Approved — manage featured status from the list." | t }}
    {% elif record.status == 'rejected' %}
      {{ "This testimonial was rejected." | t }}
    {% endif %}
  </p>
  {% endif %}

</div>
```

- [ ] **Step 2: Run all unit tests to confirm no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -8
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/testimonial-detail-drawer.njk
git commit -m "feat: add testimonial-detail-drawer partial"
```

---

### Task 4: Wire up clickable rows in testimonial-list.njk

**Files:**
- Modify: `src/views/partials/admin/testimonial-list.njk`

**Context:** Each `<tr>` currently has `class="border-b last:border-0 hover:bg-gray-50"`. Rows where `record.status != 'pending_submission'` gain HTMX attributes to load the detail drawer. `pending_submission` rows remain inert but get `cursor-default` so their non-clickable nature is visually clear.

**Important:** The `hx-get` attribute goes on the `<tr>`, not individual `<td>` cells. Existing inline forms for Approve/Reject/Feature in the last two cells use `method="POST"` and must not be disrupted — they should still work independently. To prevent a row click from also triggering when an action button inside it is clicked, add `hx-boost="false"` to the inner forms (HTMX will stop propagation on boosted elements).

Actually — the existing inline forms use plain `method="POST"` (not HTMX), so click propagation to the `<tr>`'s `hx-get` is a real risk. The safest fix: stop propagation on the action cell. Add `onclick="event.stopPropagation()"` to the last `<td>` (actions column) so clicks on Approve/Reject/Feature buttons don't bubble up to trigger the row's `hx-get`.

- [ ] **Step 1: Update testimonial-list.njk**

Replace the `<tr>` tag inside the `{% for record in records %}` loop:

```njk
{% for record in records %}
{% if record.status != 'pending_submission' %}
<tr class="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
    hx-get="/admin/content/testimonials/{{ record.id }}"
    hx-target="#testimonial-drawer-content"
    hx-swap="innerHTML"
    data-action="open-testimonial-drawer">
{% else %}
<tr class="border-b last:border-0 hover:bg-gray-50 cursor-default">
{% endif %}
```

And update **both** the Featured `<td>` and the actions `<td>` to stop click propagation (both contain interactive forms that must not trigger the row's `hx-get`):

```njk
      <td class="py-2 pr-4" onclick="event.stopPropagation()">
```

(This is the Featured cell — line ~42 in the current file.)

```njk
      <td class="py-2 text-right flex gap-2 justify-end" onclick="event.stopPropagation()">
```

(This is the actions cell — line ~52 in the current file.)

Close the `<tr>` unconditionally with `</tr>` — no change needed there.

- [ ] **Step 2: Run all unit tests**

```bash
npx jest --no-coverage 2>&1 | tail -8
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/testimonial-list.njk
git commit -m "feat: make testimonial rows clickable to open detail drawer"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -8
```

Expected: All pass (≥1113 tests).

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Clean build.
