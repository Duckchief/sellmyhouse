# Testimonial Resend Token — Design

**Date:** 2026-03-22
**Status:** Approved

## Problem

When admin rejects a testimonial, the seller receives a notification but has no way to resubmit. The rejected record sits permanently in `rejected` state with no path forward. Admin also has no way to give the seller targeted feedback on what to change.

## Decisions

| Question | Decision |
|---|---|
| Combined or separate reject/resend? | Two separate steps — reject first, "Resend Link" button appears after |
| Feedback on resend? | Optional free-text field in the drawer before confirming |
| Pre-fill previous content? | Yes — seller sees prior submission pre-populated |
| Token expiry? | 30 days (same as original) |
| Data approach? | Reset in place — update existing record, no new record created |

## Data Layer

### `reissueTestimonialToken(id, feedback?)` — `content.service.ts`

1. Fetch testimonial — throw `NotFoundError` if missing, `ValidationError` if status is not `rejected`
2. Generate new `cuid` token, set `tokenExpiresAt` to now + 30 days
3. Update record: `status → pending_submission`, new token + expiry (existing `content`/`rating`/`clientName`/`clientTown` left untouched for pre-fill)
4. Write audit log: `action: 'testimonial_token_reissued'`, `entityType: 'testimonial'`, `entityId: id`
5. Send `testimonial_reissued` notification to seller (if `sellerId` present) with `submissionUrl` and optional `feedback`

### New repo function — `content.repository.ts`

`reissueTestimonialToken(id, token, tokenExpiresAt)` — updates `status`, `submissionToken`, `tokenExpiresAt` on the record.

### New notification template — `notification.templates.ts`

```
testimonial_reissued: {
  subject: 'Your Testimonial — Please Resubmit',
  body: 'We'd love to publish your testimonial. Please use the link below to resubmit:\n{{submissionUrl}}\n\n{{#if feedback}}Feedback from our team: {{feedback}}{{/if}}'
}
```

Add `'testimonial_reissued'` to `NotificationTemplateName` union and `WHATSAPP_TEMPLATE_STATUS` map.

## API & Routing

**Route:** `POST /admin/content/testimonials/:id/resend`

- Protected by `...adminAuth`
- Optional `feedback` in request body (plain text)
- Calls `contentService.reissueTestimonialToken(id, feedback)`
- HTMX: re-renders `#testimonial-list` (same pattern as approve/reject)
- Non-HTMX: redirects to `/admin/content/testimonials`

## Admin UI

**`testimonial-detail-drawer.njk`** — extend the `rejected` branch in the status action area:

- Small inline form with optional textarea ("Feedback for seller", placeholder: "Optional — let the seller know what to change")
- "Resend Submission Link" button:
  - `hx-post="/admin/content/testimonials/{{ record.id }}/resend"`
  - `hx-include` the feedback textarea
  - `hx-target="#testimonial-list"`, `hx-swap="innerHTML"`

No changes to the `pending_review` approve/reject buttons or the `approved` branch.

## Public Form Pre-fill

**`testimonial-form.njk`** — populate form field values from `{{ testimonial.content }}`, `{{ testimonial.rating }}`, `{{ testimonial.clientName }}`, `{{ testimonial.clientTown }}`. No route changes needed — `GET /testimonial/:token` already loads and passes the full record.

## Tests

### `content.service.test.ts`

1. Happy path — resets status, generates new token, sends `testimonial_reissued` notification with `submissionUrl` and `feedback`
2. No feedback — notification sent without feedback field when omitted
3. Guard: throws `ValidationError` when status is not `rejected`
4. Guard: throws `NotFoundError` when id does not exist
5. No notification when `sellerId` is null (manual testimonial)

### `content.repository.test.ts`

1. `reissueTestimonialToken` updates `status`, `submissionToken`, `tokenExpiresAt` on the correct record
