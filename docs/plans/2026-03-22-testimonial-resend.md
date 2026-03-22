# Testimonial Resend Token Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admin to resend a testimonial submission link to a seller after rejecting their testimonial, with optional feedback about what to change.

**Architecture:** Reset-in-place — the existing rejected testimonial record is updated with a new token and status, preserving the content for pre-fill. A new notification template delivers the link + optional feedback to the seller. The admin drawer gets a resend form visible only on rejected records.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest

---

## Task 1: Add `testimonial_reissued` notification template and type

**Files:**
- Modify: `src/domains/notification/notification.types.ts`
- Modify: `src/domains/notification/notification.templates.ts`

No tests needed — these are data declarations.

**Step 1: Add to the `NotificationTemplateName` union**

In `notification.types.ts`, add `'testimonial_reissued'` after `'testimonial_rejected'` in the union:

```typescript
  | 'testimonial_rejected'
  | 'testimonial_reissued'
  | 'password_reset'
```

**Step 2: Add the email template**

In `notification.templates.ts`, add after the `testimonial_rejected` entry:

```typescript
  testimonial_reissued: {
    subject: 'Your Testimonial — Please Resubmit',
    body: "We'd love to publish your testimonial. Please use the link below to resubmit:\n{{submissionUrl}}\n\n{{feedback}}",
  },
```

Note: `{{feedback}}` will be an empty string when omitted — the service will handle that.

**Step 3: Add to `WHATSAPP_TEMPLATE_STATUS`**

In `notification.templates.ts`, add after `testimonial_rejected`:

```typescript
  testimonial_reissued: 'pending',
```

**Step 4: Commit**

```bash
git add src/domains/notification/notification.types.ts src/domains/notification/notification.templates.ts
git commit -m "feat(content): add testimonial_reissued notification template"
```

---

## Task 2: Repository function — `reissueTestimonialToken`

**Files:**
- Modify: `src/domains/content/content.repository.ts`
- Modify: `src/domains/content/content.repository.test.ts`

**Step 1: Write the failing test**

The existing repo test file mocks only `prisma.testimonial.create`. Add `update` to the mock and add a new describe block at the end of `content.repository.test.ts`:

First, update the mock at the top of the file to include `update`:

```typescript
jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    testimonial: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));
```

Then add the test:

```typescript
describe('reissueTestimonialToken', () => {
  it('updates status, submissionToken, and tokenExpiresAt on the correct record', async () => {
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    prisma.testimonial.update.mockResolvedValue({
      id: 't-1',
      status: 'pending_submission',
      submissionToken: 'new-token',
      tokenExpiresAt: expiry,
    });

    await contentRepo.reissueTestimonialToken('t-1', 'new-token', expiry);

    expect(prisma.testimonial.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: {
        status: 'pending_submission',
        submissionToken: 'new-token',
        tokenExpiresAt: expiry,
      },
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/domains/content/content.repository.test.ts --no-coverage
```

Expected: FAIL with `contentRepo.reissueTestimonialToken is not a function`

**Step 3: Implement the repo function**

Add after `updateTestimonialStatus` in `content.repository.ts`:

```typescript
export async function reissueTestimonialToken(
  id: string,
  token: string,
  tokenExpiresAt: Date,
) {
  return prisma.testimonial.update({
    where: { id },
    data: {
      status: 'pending_submission',
      submissionToken: token,
      tokenExpiresAt,
    },
  });
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/domains/content/content.repository.test.ts --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/content/content.repository.ts src/domains/content/content.repository.test.ts
git commit -m "feat(content): add reissueTestimonialToken repo function"
```

---

## Task 3: Service function — `reissueTestimonialToken`

**Files:**
- Modify: `src/domains/content/content.service.ts`
- Modify: `src/domains/content/content.service.test.ts`

**Step 1: Write the failing tests**

Add a new describe block at the end of `content.service.test.ts` (after the `rejectTestimonial` block). The existing mocks for `mockedRepo`, `mockedAudit`, and `mockedNotification` are already in scope at module level.

```typescript
// ─── reissueTestimonialToken ──────────────────────────────────────────────────

describe('reissueTestimonialToken', () => {
  const baseTestimonial = {
    id: 't-1',
    sellerId: 'seller-1',
    status: 'rejected',
    content: 'Great service!',
    rating: 5,
    clientName: 'Mary L.',
    clientTown: 'Bishan',
  } as unknown as Testimonial;

  beforeEach(() => {
    mockedNotification.send = jest.fn().mockResolvedValue(undefined);
  });

  it('throws NotFoundError when testimonial does not exist', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(null);
    await expect(
      contentService.reissueTestimonialToken('bad-id', 'agent-1'),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when testimonial is not rejected', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue({
      ...baseTestimonial,
      status: 'pending_review',
    } as unknown as Testimonial);
    await expect(
      contentService.reissueTestimonialToken('t-1', 'agent-1'),
    ).rejects.toThrow(ValidationError);
  });

  it('resets status and issues a new token', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(baseTestimonial);
    mockedRepo.reissueTestimonialToken.mockResolvedValue({
      ...baseTestimonial,
      status: 'pending_submission',
    } as unknown as Testimonial);

    await contentService.reissueTestimonialToken('t-1', 'agent-1');

    expect(mockedRepo.reissueTestimonialToken).toHaveBeenCalledWith(
      't-1',
      expect.any(String), // new token
      expect.any(Date),   // new expiry
    );
  });

  it('writes an audit log entry', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(baseTestimonial);
    mockedRepo.reissueTestimonialToken.mockResolvedValue({
      ...baseTestimonial,
      status: 'pending_submission',
    } as unknown as Testimonial);

    await contentService.reissueTestimonialToken('t-1', 'agent-1');

    expect(mockedAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'testimonial_token_reissued',
        entityType: 'testimonial',
        entityId: 't-1',
      }),
    );
  });

  it('sends testimonial_reissued notification with submissionUrl and feedback', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(baseTestimonial);
    mockedRepo.reissueTestimonialToken.mockResolvedValue({
      ...baseTestimonial,
      submissionToken: 'new-tok',
      status: 'pending_submission',
    } as unknown as Testimonial);

    await contentService.reissueTestimonialToken('t-1', 'agent-1', 'Please shorten it.');
    await Promise.resolve();

    expect(mockedNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'seller',
        recipientId: 'seller-1',
        templateName: 'testimonial_reissued',
        templateData: expect.objectContaining({
          submissionUrl: expect.stringContaining('new-tok'),
          feedback: 'Please shorten it.',
        }),
      }),
      'agent-1',
    );
  });

  it('sends empty feedback string when none provided', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue(baseTestimonial);
    mockedRepo.reissueTestimonialToken.mockResolvedValue({
      ...baseTestimonial,
      submissionToken: 'new-tok',
      status: 'pending_submission',
    } as unknown as Testimonial);

    await contentService.reissueTestimonialToken('t-1', 'agent-1');
    await Promise.resolve();

    expect(mockedNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateData: expect.objectContaining({ feedback: '' }),
      }),
      'agent-1',
    );
  });

  it('does not send notification when sellerId is null (manual testimonial)', async () => {
    mockedRepo.findTestimonialById.mockResolvedValue({
      ...baseTestimonial,
      sellerId: null,
    } as unknown as Testimonial);
    mockedRepo.reissueTestimonialToken.mockResolvedValue({
      ...baseTestimonial,
      sellerId: null,
      status: 'pending_submission',
    } as unknown as Testimonial);

    await contentService.reissueTestimonialToken('t-1', 'agent-1');
    await Promise.resolve();

    expect(mockedNotification.send).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/content/content.service.test.ts --no-coverage -t "reissueTestimonialToken"
```

Expected: FAIL with `contentService.reissueTestimonialToken is not a function`

**Step 3: Implement the service function**

Add after `rejectTestimonial` in `content.service.ts`:

```typescript
export async function reissueTestimonialToken(
  id: string,
  agentId: string,
  feedback?: string,
) {
  const testimonial = await contentRepo.findTestimonialById(id);
  if (!testimonial) throw new NotFoundError('Testimonial', id);
  if (testimonial.status !== 'rejected')
    throw new ValidationError('Only rejected testimonials can have their token reissued');

  const token = createId();
  const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const updated = await contentRepo.reissueTestimonialToken(id, token, tokenExpiresAt);

  await auditService.log({
    action: 'testimonial_token_reissued',
    entityType: 'testimonial',
    entityId: id,
    agentId,
  });

  if (updated.sellerId) {
    void notificationService.send(
      {
        recipientType: 'seller',
        recipientId: updated.sellerId,
        templateName: 'testimonial_reissued',
        templateData: {
          submissionUrl: `${process.env['APP_URL'] ?? ''}/testimonial/${token}`,
          feedback: feedback ?? '',
        },
      },
      agentId,
    );
  }

  return updated;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/content/content.service.test.ts --no-coverage -t "reissueTestimonialToken"
```

Expected: PASS (7 tests)

**Step 5: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: all existing tests still pass

**Step 6: Commit**

```bash
git add src/domains/content/content.service.ts src/domains/content/content.service.test.ts
git commit -m "feat(content): add reissueTestimonialToken service function"
```

---

## Task 4: Admin route — `POST /admin/content/testimonials/:id/resend`

**Files:**
- Modify: `src/domains/admin/admin.router.ts`
- Modify: `src/domains/admin/__tests__/admin.router.test.ts`

**Step 1: Write the failing test**

Find the testimonial section in `admin.router.test.ts`. Add a new describe block after the reject tests:

```typescript
describe('POST /admin/content/testimonials/:id/resend', () => {
  it('calls reissueTestimonialToken and re-renders testimonial list on HTMX request', async () => {
    mockedContentService.reissueTestimonialToken.mockResolvedValue({} as any);
    mockedContentService.listTestimonials.mockResolvedValue([]);
    mockedContentService.hasPendingReviewTestimonials.mockResolvedValue(false);

    const res = await request(app)
      .post('/admin/content/testimonials/t-1/resend')
      .set('HX-Request', 'true')
      .send({ feedback: 'Please shorten it.' });

    expect(res.status).toBe(200);
    expect(mockedContentService.reissueTestimonialToken).toHaveBeenCalledWith(
      't-1',
      expect.any(String), // agentId
      'Please shorten it.',
    );
  });

  it('redirects on non-HTMX request', async () => {
    mockedContentService.reissueTestimonialToken.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/admin/content/testimonials/t-1/resend')
      .send({});

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/content/testimonials');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/domains/admin/__tests__/admin.router.test.ts --no-coverage -t "resend"
```

Expected: FAIL with 404 (route doesn't exist)

**Step 3: Add the route**

In `admin.router.ts`, add the resend route after the reject route (around line 1510). Follow the exact same pattern as the reject route:

```typescript
adminRouter.post(
  '/admin/content/testimonials/:id/resend',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const feedback = typeof req.body.feedback === 'string' && req.body.feedback.trim()
        ? req.body.feedback.trim()
        : undefined;
      await contentService.reissueTestimonialToken(req.params['id'] as string, user.id, feedback);
      if (req.headers['hx-request']) {
        const [records, hasPendingReview] = await Promise.all([
          contentService.listTestimonials(),
          contentService.hasPendingReviewTestimonials(),
        ]);
        return res.render('partials/admin/testimonial-list', { records, hasPendingReview });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/admin/__tests__/admin.router.test.ts --no-coverage -t "resend"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat(admin): add POST /admin/content/testimonials/:id/resend route"
```

---

## Task 5: Admin UI — resend form in detail drawer

**Files:**
- Modify: `src/views/partials/admin/testimonial-detail-drawer.njk`

No automated test — visual change. Verify manually in browser.

**Step 1: Update the drawer**

In `testimonial-detail-drawer.njk`, find the `{% else %}` block at line ~99 (the read-only status text shown for approved/rejected). Replace the entire `{% else %}` block with distinct branches:

```nunjucks
  {% elif record.status == 'approved' %}
  <p class="text-xs text-gray-400 text-center pt-2 mt-auto">
    {{ "Approved — manage featured status from the list." | t }}
  </p>
  {% elif record.status == 'rejected' %}
  <div class="pt-2 mt-auto space-y-3">
    <p class="text-xs text-gray-500">{{ "This testimonial was rejected. You can resend a new submission link to the seller." | t }}</p>
    <form
      hx-post="/admin/content/testimonials/{{ record.id }}/resend"
      hx-target="#testimonial-list"
      hx-swap="innerHTML"
      class="space-y-2">
      <textarea
        name="feedback"
        rows="3"
        placeholder="{{ 'Optional — let the seller know what to change' | t }}"
        class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"></textarea>
      <button
        type="submit"
        class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2 px-4 rounded transition-colors">
        {{ "Resend Submission Link" | t }}
      </button>
    </form>
  </div>
  {% endif %}
```

The full updated action area (replacing from `{% else %}` at line 99 through `{% endif %}` at line 107) should look like:

```nunjucks
  {% elif record.status == 'approved' %}
  <p class="text-xs text-gray-400 text-center pt-2 mt-auto">
    {{ "Approved — manage featured status from the list." | t }}
  </p>
  {% elif record.status == 'rejected' %}
  <div class="pt-2 mt-auto space-y-3">
    <p class="text-xs text-gray-500">{{ "This testimonial was rejected. You can resend a new submission link to the seller." | t }}</p>
    <form
      hx-post="/admin/content/testimonials/{{ record.id }}/resend"
      hx-target="#testimonial-list"
      hx-swap="innerHTML"
      class="space-y-2">
      <textarea
        name="feedback"
        rows="3"
        placeholder="{{ 'Optional — let the seller know what to change' | t }}"
        class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"></textarea>
      <button
        type="submit"
        class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2 px-4 rounded transition-colors">
        {{ "Resend Submission Link" | t }}
      </button>
    </form>
  </div>
  {% endif %}
```

Note: The original template uses `{% if ... %} ... {% else %} ... {% endif %}` for the action area. The existing structure has the `pending_review` approve/reject block as the `if` branch and the read-only text in `{% else %}`. Replace the entire `{% else %}` block with the two `{% elif %}` branches above and drop the old else. The `{% if record.status == 'pending_review' %}` opening line at ~line 82 stays untouched.

**Step 2: Commit**

```bash
git add src/views/partials/admin/testimonial-detail-drawer.njk
git commit -m "feat(admin): add resend submission link form to rejected testimonial drawer"
```

---

## Task 6: Pre-fill testimonial form with previous content

**Files:**
- Modify: `src/views/pages/public/testimonial-form.njk`

**Step 1: Identify the gaps**

The form currently pre-fills `clientName` and `clientTown` from `testimonial.*` but:
- `content` textarea (line 42) only uses `{{ values.content if values }}` — missing `testimonial.content` fallback
- `rating` select (line 35) only checks `values.rating` — missing `testimonial.rating` fallback

**Step 2: Fix the content textarea**

Change line 42 from:
```nunjucks
          class="...">{{ values.content if values }}</textarea>
```
to:
```nunjucks
          class="...">{{ values.content if values else testimonial.content }}</textarea>
```

**Step 3: Fix the rating select**

Change line 35 from:
```nunjucks
          <option value="{{ i }}" {% if values and values.rating == i %}selected{% endif %}>
```
to:
```nunjucks
          <option value="{{ i }}" {% if (values and values.rating == i) or (not values and testimonial.rating == i) %}selected{% endif %}>
```

**Step 4: Commit**

```bash
git add src/views/pages/public/testimonial-form.njk
git commit -m "fix(public): pre-fill testimonial form content and rating from existing record"
```

---

## Task 7: Full test run and verification

**Step 1: Run all unit tests**

```bash
npm test -- --no-coverage
```

Expected: all tests pass

**Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: all tests pass

**Step 3: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(content): testimonial resend fixups"
```
