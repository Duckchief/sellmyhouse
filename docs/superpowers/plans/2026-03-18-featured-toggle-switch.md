# Featured Toggle Switch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Feature/Unfeature text button in the testimonials table with a CSS pill toggle that updates in place via HTMX.

**Architecture:** The `/feature` route gains an HTMX branch (same pattern as approve/reject) that returns the refreshed list partial instead of redirecting. The template replaces the `<form>` submit button with a styled `<label>`+checkbox toggle; the checkbox is visual-only, the hidden input carries the toggled value, and `hx-trigger="change"` fires on toggle click.

**Tech Stack:** TypeScript, Express, Nunjucks, HTMX, Tailwind CSS, Jest

---

## File Map

| File | Change |
|---|---|
| `src/domains/admin/admin.router.ts` | Add HTMX branch to `POST /:id/feature` route |
| `src/domains/admin/__tests__/admin.router.test.ts` | Two new tests for HTMX feature route |
| `src/views/partials/admin/testimonial-list.njk` | Add `<style>` block; replace Feature/Unfeature button with pill toggle |

---

## Chunk 1: Route + Template

### Task 1: Add HTMX branch to the `/feature` route (TDD)

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (line ~1181)
- Modify: `src/domains/admin/__tests__/admin.router.test.ts` (after line 294)

**Context:** The existing `/feature` route (lines 1181–1193 of `admin.router.ts`) does an unconditional redirect. Add an HTMX branch identical to the approve/reject pattern (lines 1112–1145). The test file already has `contentService.featureTestimonial` and `contentService.listTestimonials` available via the jest.mock at the top — no new imports needed.

The existing tests for approve/reject HTMX (lines 252–294 of the test file) are the exact pattern to follow. The `makeApp()` helper stubs `res.render` to always return 200.

- [ ] **Step 1: Write the failing tests**

In `src/domains/admin/__tests__/admin.router.test.ts`, add after the last `});` of the `POST /admin/content/testimonials/:id/reject — HTMX` describe block (after line 294):

```typescript
describe('POST /admin/content/testimonials/:id/feature — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.featureTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/feature')
      .send('displayOnWebsite=true')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.featureTestimonial).toHaveBeenCalledWith('t-1', true);
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.featureTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/feature')
      .send('displayOnWebsite=false')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(302);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/david/Documents/AI/sellmyhomenow-v2
npx jest --testPathPatterns="admin.router.test" --no-coverage 2>&1 | tail -10
```

Expected: FAIL — feature HTMX test gets 302 instead of 200.

- [ ] **Step 3: Update the `/feature` route**

In `src/domains/admin/admin.router.ts`, replace the existing feature route (lines 1181–1193) with:

```typescript
adminRouter.post(
  '/admin/content/testimonials/:id/feature',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const display = req.body.displayOnWebsite === 'true';
      await contentService.featureTestimonial(req.params['id'] as string, display);
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest --testPathPatterns="admin.router.test" --no-coverage 2>&1 | tail -8
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.router.ts src/domains/admin/__tests__/admin.router.test.ts
git commit -m "feat: add HTMX branch to feature testimonial route"
```

---

### Task 2: Replace Feature/Unfeature button with pill toggle in testimonial-list.njk

**Files:**
- Modify: `src/views/partials/admin/testimonial-list.njk`

**Context:** The Featured `<td>` is at lines 49–58 of the current file. It contains a `<form method="POST" ...>` with a hidden input and a submit button. Replace the button with a CSS pill toggle. The hidden input stays — it carries the toggled value (`'false'` if currently featured, `'true'` if not). The checkbox is visual-only (no `name` attribute). Add HTMX attributes to the form so it fires on `change` and swaps `#testimonial-list`. Add a `<style>` block at the very top of the file (before line 1) with the toggle CSS.

The `<style>` block goes at the very top of the file — before the `{% set statusColors %}` block — because placing it inside `<tbody>` would be invalid HTML.

- [ ] **Step 1: Add the `<style>` block at the top of `testimonial-list.njk`**

Insert before line 1 (before `{% set statusColors %}`):

```njk
<style>
  .featured-toggle { display:inline-flex; align-items:center; cursor:pointer; }
  .featured-toggle input.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
  .featured-toggle__pill {
    position:relative; display:inline-block;
    width:36px; height:20px; border-radius:999px;
    background:#d1d5db; transition:background .2s;
  }
  .featured-toggle__pill::after {
    content:''; position:absolute;
    top:2px; left:2px;
    width:16px; height:16px; border-radius:50%;
    background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.2);
    transition:left .2s;
  }
  .featured-toggle input:checked ~ .featured-toggle__pill { background:#16a34a; }
  .featured-toggle input:checked ~ .featured-toggle__pill::after { left:18px; }
</style>
```

- [ ] **Step 2: Replace the Featured `<td>` content**

Replace this block (lines 49–58 in the current file, now shifted down by the `<style>` block):

```njk
      <td class="py-2 pr-4" onclick="event.stopPropagation()">
        {% if record.status == 'approved' %}
        <form method="POST" action="/admin/content/testimonials/{{ record.id }}/feature" class="inline">
          <input type="hidden" name="displayOnWebsite" value="{{ 'false' if record.displayOnWebsite else 'true' }}">
          <button type="submit" class="text-xs text-indigo-600 hover:underline">
            {{ "Unfeature" | t if record.displayOnWebsite else "Feature" | t }}
          </button>
        </form>
        {% endif %}
      </td>
```

With:

```njk
      <td class="py-2 pr-4" onclick="event.stopPropagation()">
        {% if record.status == 'approved' %}
        <form
          hx-post="/admin/content/testimonials/{{ record.id }}/feature"
          hx-target="#testimonial-list"
          hx-swap="innerHTML"
          hx-trigger="change">
          <input type="hidden" name="displayOnWebsite" value="{{ 'false' if record.displayOnWebsite else 'true' }}">
          <label class="featured-toggle" title="{{ 'Featured on website' | t }}">
            <input type="checkbox" class="sr-only" {% if record.displayOnWebsite %}checked{% endif %}>
            <span class="featured-toggle__pill"></span>
          </label>
        </form>
        {% endif %}
      </td>
```

- [ ] **Step 3: Run all unit tests to confirm no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -8
```

Expected: All pass (≥1122 tests).

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/admin/testimonial-list.njk
git commit -m "feat: replace Feature/Unfeature button with CSS pill toggle"
```

---

### Task 3: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -8
```

Expected: All pass (≥1124 tests — 2 new tests from Task 1).

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
