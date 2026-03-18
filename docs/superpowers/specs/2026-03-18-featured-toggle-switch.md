# Spec: Featured Toggle Switch

**Date:** 2026-03-18
**Feature:** Replace the Feature/Unfeature text button in the testimonials table with a CSS pill toggle switch

## Overview

The Featured column in `/admin/content/testimonials` currently shows a "Feature" or "Unfeature" text link for approved testimonials. Replace it with a pill-style toggle switch (iOS-style, no label). Clicking the toggle fires an HTMX POST to the existing `/feature` route and refreshes the testimonial list in place — no full-page reload.

## UI

### Toggle appearance

- Green pill, thumb on the right: `displayOnWebsite = true` (featured)
- Gray pill, thumb on the left: `displayOnWebsite = false` (not featured)
- Only visible for `approved` testimonials; other statuses leave the cell empty
- `title="Featured on website"` on the `<label>` for accessibility

### Markup — Featured `<td>` in `testimonial-list.njk`

Replace the existing `<form method="POST" ...>` block inside the Featured `<td>` with:

```njk
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
```

The checkbox has no `name` — it is visual only. The hidden input carries the toggled value (the opposite of the current state) so a single POST correctly flips the flag.

### CSS

Add a `<style>` block at the top of `testimonial-list.njk`, before the `<table>`:

```html
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

## Backend

### `admin.router.ts` — `/feature` route

Add an HTMX branch identical to the approve/reject pattern:

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

The non-HTMX redirect path is unchanged (progressive enhancement).

## Affected Files

| File | Change |
|---|---|
| `src/views/partials/admin/testimonial-list.njk` | Add `<style>` block; replace Feature/Unfeature button with pill toggle |
| `src/domains/admin/admin.router.ts` | Add HTMX branch to `/feature` route |
| `src/domains/admin/__tests__/admin.router.test.ts` | Add test for HTMX `/feature` route returning 200 with list partial |

## Testing

- Unit: no new service/repo logic — existing `featureTestimonial` tests unchanged
- Integration: `POST /admin/content/testimonials/:id/feature` with `HX-Request: true` → 200 with list partial
- Integration: `POST /admin/content/testimonials/:id/feature` without `HX-Request` → 302 redirect (existing behaviour preserved)
