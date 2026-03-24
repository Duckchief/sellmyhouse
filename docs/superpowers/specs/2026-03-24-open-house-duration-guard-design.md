# Open House Duration Guard — Design Spec

**Date:** 2026-03-24
**Scope:** Recurring Slots form (`/seller/viewings`, Recurring Slots tab)

## Problem

When a seller creates recurring Open House slots, a slot duration under 30 minutes is impractical. The UI should steer them toward a sensible default and hard-block accidental short durations.

## Behaviour

### Auto-correct on type change

A direct `change` event listener is attached to the `slotType` select inside `#recurring-slots-form` (via `form.querySelector('[name="slotType"]')`):
- `single` → `group`: set `slotDurationMinutes` input value to `60`
- `group` → `single`: set `slotDurationMinutes` input value to `10`

The duration input is read via `form.querySelector('[name="slotDurationMinutes"]')`. No `data-action` attributes are required on template elements for this handler.

### Submit guard

A direct `submit` event listener is attached to `document.getElementById('recurring-slots-form')`.

At submit time it reads:
- `form.querySelector('[name="slotType"]').value`
- `parseInt(form.querySelector('[name="slotDurationMinutes"]').value, 10)`

If `slotType === 'group'` and `slotDurationMinutes < 30`: call `event.preventDefault()` and show `#open-house-duration-modal`. Otherwise allow submit to proceed normally.

The guard reads field values at submit time; any manual edits made after auto-correct are respected.

## Modal

**ID:** `open-house-duration-modal`

**Pattern:** matches the existing `#cancel-slot-modal` — `fixed inset-0 bg-black bg-opacity-50` backdrop with a centred white card, toggled via `classList.add/remove('hidden')`.

**Message:** "To make the most of an Open House the minimum slot duration is 30 minutes"

**Button:** Single "OK" button with `data-action="close-open-house-duration-modal"`. The existing global click handler in `app.js` gains a new case:

```js
if (action === 'close-open-house-duration-modal') {
  var modal = document.getElementById('open-house-duration-modal');
  if (modal) modal.classList.add('hidden');
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/views/pages/seller/viewings.njk` | Add `#open-house-duration-modal` markup |
| `src/views/partials/seller/viewings-dashboard.njk` | Add `id="recurring-slots-form"` to the `<form>` element (line 140) |
| `public/js/app.js` | Add direct `change` listener for auto-correct; add direct `submit` listener for guard; add `close-open-house-duration-modal` case to global click handler |

## Out of Scope

- Single Slot tab (no explicit duration field — uses start/end time inputs)
- Server-side enforcement (this is a UX guardrail, not a business-critical constraint)
- Max viewers field (no changes)
