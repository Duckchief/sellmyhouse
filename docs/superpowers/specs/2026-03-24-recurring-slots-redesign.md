# Recurring Slots Redesign — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Goal

Replace the current Recurring Slots tab form with a simpler day-row layout where the seller configures each day of the week independently, with up to 3 timeslots per day, submitted as a single request that creates 1 month of slots from today.

---

## Context

The current Recurring Slots tab requires the seller to select a date range, pick a single day of the week, enter window start/end times, slot duration, and type — then repeat for each day they want to configure. This is tedious and error-prone.

The new design shows all 7 days at once as rows, pre-filled with sensible defaults, so a seller can configure an entire week's schedule in one view and submit it in one action.

---

## UI Design

### Layout

A table with 7 fixed rows (Monday through Sunday). Each row represents one day of the week.

**Columns:** Toggle · Day · Start Time · End Time · Type

**No date range pickers** — removed entirely. The server always generates slots from today to today + 1 month.

**No slot duration column** — removed. Duration is server-side only:
- Normal Viewing → 10 minutes (fixed)
- Open House → full window (single slot spanning start–end)

### Defaults

All 7 days are **enabled by default** when the tab is first loaded.

| Day | Default Start | Default End | Default Type |
|-----|--------------|------------|--------------|
| Mon | 6:00 PM | 8:00 PM | Normal Viewing |
| Tue | 6:00 PM | 8:00 PM | Normal Viewing |
| Wed | 6:00 PM | 8:00 PM | Normal Viewing |
| Thu | 6:00 PM | 8:00 PM | Normal Viewing |
| Fri | 6:00 PM | 8:00 PM | Normal Viewing |
| Sat | 1:00 PM | 5:00 PM | Normal Viewing |
| Sun | 1:00 PM | 5:00 PM | Normal Viewing |

### Toggle Behaviour

Each row has an **Apple-style toggle switch** (blue = on, grey = off).

- Toggling off: row inputs become greyed out and non-interactive; row is excluded from submission
- Toggling on: row inputs become active with their default values pre-filled

### Multiple Timeslots per Day

Each enabled day can have **1 to 3 timeslots**.

- A **+** button (blue circle) appears on the last timeslot row of each day (when fewer than 3 timeslots exist)
- A **×** button (grey circle) appears on each timeslot row that can be removed (i.e. all except the first)
- Additional timeslot rows inherit the day's default start/end/type as starting values

### Submit Button

Label: **"Create Recurring Slots"**
Sub-label beneath: *"Creates slots for 1 month from today"*

Submits all enabled days and their timeslots in a single HTTP request.

---

## Backend Design

### New Endpoint

```
POST /seller/viewings/slots/recurring
```

Replaces the existing `POST /seller/viewings/slots` with `bulk=true` for this use case. The old bulk endpoint remains for backward compatibility.

### Request Body

```json
{
  "propertyId": "uuid",
  "days": [
    {
      "dayOfWeek": 1,
      "timeslots": [
        { "startTime": "18:00", "endTime": "20:00", "slotType": "single" }
      ]
    },
    {
      "dayOfWeek": 6,
      "timeslots": [
        { "startTime": "13:00", "endTime": "17:00", "slotType": "single" },
        { "startTime": "10:00", "endTime": "12:00", "slotType": "group" }
      ]
    }
  ]
}
```

- `dayOfWeek`: 0 (Sunday) – 6 (Saturday)
- `timeslots`: 1–3 entries per day
- `startTime` / `endTime`: HH:MM 24-hour format, within 10:00–20:00 bounds
- `slotType`: `"single"` | `"group"`

### Server-Side Derivations

| Field | Value |
|-------|-------|
| `startDate` | Today (server clock) |
| `endDate` | Today + 1 month |
| `slotDurationMinutes` | 10 for `single`; `(endTime − startTime)` for `group` |
| `maxViewers` | 1 for `single`; `ceil(duration / 30) * 30 / 60 * 20` for `group` |

### Validation Rules

- `days`: array, 1–7 entries, no duplicate `dayOfWeek` values
- `timeslots` per day: 1–3 entries
- Each timeslot: `startTime < endTime`, both within 10:00–20:00
- No overlapping timeslots within the same day
- `slotType` must be `"single"` or `"group"`

### Database Transaction

All slot inserts are executed in a **single `prisma.$transaction`**. If any insert fails, the entire batch is rolled back.

### Response

```json
{ "success": true, "count": 42 }
```

HTMX response renders the existing `partials/seller/slots-created` partial with the count.

---

## Expiry Nudge Banner

Shown on the seller viewings page when:
- There are no upcoming slots, **or**
- The latest upcoming slot's date is within 7 days of today

**Banner copy:**
> "Your viewing slots expire in X days. [Create more →]"

The link activates the Recurring Slots tab.

**Implementation:** Derived from the existing `getSellerDashboard` slots data — no additional database query required. Check `slots[slots.length - 1].startTime` against today + 7 days.

---

## Files Affected

| File | Change |
|------|--------|
| `src/views/partials/seller/viewings-dashboard.njk` | Replace recurring slots form with day-row layout |
| `src/views/pages/seller/viewings.njk` | Add expiry nudge banner |
| `src/domains/viewing/viewing.router.ts` | Add `POST /seller/viewings/slots/recurring` route |
| `src/domains/viewing/viewing.validator.ts` | Add `validateCreateRecurringSlots` validator |
| `src/domains/viewing/viewing.service.ts` | Add `createRecurringSlots` service method |
| `src/domains/viewing/viewing.types.ts` | Add `CreateRecurringSlotsInput` type |
| `public/js/app.js` | Add toggle + add/remove timeslot row JS |

---

## Out of Scope

- Editing existing recurring slot schedules (seller deletes and recreates)
- Per-day custom slot duration (fixed at 10 min for Normal Viewing)
- Auto-renewal of slots past the 1-month window
