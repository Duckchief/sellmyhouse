# Open House Duration Guard — Design Spec

**Date:** 2026-03-24
**Scope:** Recurring Slots form (`/seller/viewings`, Recurring Slots tab)

## Problem

When a seller creates recurring Open House slots, a slot duration under 30 minutes is impractical. The UI should steer them toward a sensible default and hard-block accidental short durations.

## Behaviour

### Auto-correct on type change

When the `slotType` select changes:
- `single` → `group`: set `slotDurationMinutes` to `60`
- `group` → `single`: set `slotDurationMinutes` to `10`

No other side effects. The seller can freely edit the duration after the auto-correct.

### Submit guard

On the recurring slots form `submit` event:
- If `slotType === 'group'` and `slotDurationMinutes < 30`: call `event.preventDefault()` and show `#open-house-duration-modal`
- Otherwise: allow submit to proceed normally

## Modal

**ID:** `open-house-duration-modal`

**Pattern:** matches the existing `#cancel-slot-modal` — `fixed inset-0` backdrop with a centred white card.

**Message:** "To make the most of an Open House the minimum slot duration is 30 Minutes"

**Button:** Single "OK" button that dismisses the modal. No confirm/cancel pair.

## Files Changed

| File | Change |
|------|--------|
| `src/views/pages/seller/viewings.njk` | Add `#open-house-duration-modal` markup |
| `public/js/app.js` | Add `change` listener for auto-correct; add `submit` listener for guard |

## Out of Scope

- Single Slot tab (no explicit duration field — uses start/end time inputs)
- Server-side enforcement (this is a UX guardrail, not a business-critical constraint)
- Max viewers field (no changes)
