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
- Normal Viewing (`slotType: "single"`) → 10 minutes per sub-slot (window is divided into 10-minute slots)
- Open House (`slotType: "group"`) → full window (exactly 1 slot spanning start–end time)

**Type option values:** The `<select>` for Type uses `value="single"` for "Normal Viewing" and `value="group"` for "Open House". These values are submitted directly in the JSON payload.

### Defaults

All 7 days are **enabled by default** when the tab is first loaded.

| Day | Default Start | Default End | Default Type |
|-----|--------------|------------|--------------|
| Mon | 6:00 PM (18:00) | 8:00 PM (20:00) | Normal Viewing |
| Tue | 6:00 PM (18:00) | 8:00 PM (20:00) | Normal Viewing |
| Wed | 6:00 PM (18:00) | 8:00 PM (20:00) | Normal Viewing |
| Thu | 6:00 PM (18:00) | 8:00 PM (20:00) | Normal Viewing |
| Fri | 6:00 PM (18:00) | 8:00 PM (20:00) | Normal Viewing |
| Sat | 1:00 PM (13:00) | 5:00 PM (17:00) | Normal Viewing |
| Sun | 1:00 PM (13:00) | 5:00 PM (17:00) | Normal Viewing |

Time bounds are 10:00–20:00 **inclusive** (i.e. 20:00 is a valid end time).

### Toggle Behaviour

Each row has an **Apple-style toggle switch** (blue = on, grey = off).

- Toggling off: row inputs become greyed out and non-interactive; row is excluded from submission
- Toggling on: row inputs become active with their static day defaults pre-filled (from the table above)

### Multiple Timeslots per Day

Each enabled day can have **1 to 3 timeslots**.

- A **+** button (blue circle) appears on the last timeslot row of each day (when fewer than 3 timeslots exist)
- A **×** button (grey circle) appears on each timeslot row that can be removed (i.e. all except the first)
- Additional timeslot rows are pre-filled with the **static day defaults** from the table above (not the current values of the first row)

### Form Submission

`propertyId` is included as a **hidden field** populated from the page's property context (same pattern as the existing single-slot form).

The frontend **serialises enabled rows to JSON** and posts with `Content-Type: application/json`. Disabled rows are filtered out in JS before serialisation. The payload shape matches the API contract below.

### Submit Button

Label: **"Create Recurring Slots"**
Sub-label beneath: *"Creates slots for 1 month from today"*

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
- `startTime` / `endTime`: HH:MM 24-hour format, 10:00–20:00 inclusive
- `slotType`: `"single"` | `"group"`

### Server-Side Derivations

| Field | Value |
|-------|-------|
| `startDate` | Today in SGT (`Asia/Singapore` timezone) |
| `endDate` | Today + 1 month in SGT |
| `slotDurationMinutes` | 10 for `single`; `(endTime − startTime)` in minutes for `group` |
| `durationMinutes` (DB field) | Same as `slotDurationMinutes` above |
| `maxViewers` | 1 for `single`; reuse `calcOpenHouseMaxViewers(startTime, endTime)` from `viewing.validator.ts` for `group` — **must be exported** (currently module-private; add `export` keyword as a prerequisite) |

**Timezone note:** "Today" must be determined in SGT (UTC+8). Use `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })` to get `YYYY-MM-DD` in SGT, then construct a date from that string.

### Slot Generation Algorithm

For each day in the `days` array, iterate over every date from `startDate` to `endDate` whose weekday matches `dayOfWeek`. For each matching date, process each timeslot config:

- **`single` type:** Divide the window into 10-minute sub-slots (step from `startTime` to `endTime` in 10-minute increments), creating one DB row per sub-slot. Example: 18:00–20:00 → 12 slots.
- **`group` type:** Create exactly **1 slot** spanning the full window (`startTime` to `endTime`). Do not subdivide.

### Validation Rules

- `days`: array, 1–7 entries, no duplicate `dayOfWeek` values
- `timeslots` per day: 1–3 entries
- Each timeslot: `startTime < endTime`, both within 10:00–20:00 inclusive
- No overlapping timeslots within the submitted payload for the same day (`startTime` of each must be ≥ `endTime` of the previous)
- `slotType` must be `"single"` or `"group"`

### Slot Generation Limit (`MAX_ACTIVE_SLOTS`)

Mirror the two-phase pattern from `createBulkSlots`:

1. **Early exit:** if the property's current active slot count is already ≥ `MAX_ACTIVE_SLOTS`, throw `ValidationError` immediately.
2. **Generate:** build the full list of slots to insert in memory.
3. **Post-check:** if `current + toInsert.length > MAX_ACTIVE_SLOTS`, throw `ValidationError` with a clear message before inserting. `toInsert` is the list **after** overlap-skipped slots have been removed — do not count skipped slots against the limit.

### `MAX_SLOTS_PER_DAY` Guard

The recurring endpoint is **exempt from `MAX_SLOTS_PER_DAY`**, consistent with the existing `createBulkSlots` behaviour. Only `createSlot` (single-slot endpoint) enforces this limit.

### Overlap Check Against Existing Slots

**Intra-payload overlaps** (timeslots within the same day) are caught by the validator rule: each timeslot's `startTime` must be ≥ the `endTime` of the previous timeslot. These are rejected before generation begins.

**DB-level overlaps** (against already-existing slots): before inserting, check each generated slot against existing active slots on the same property and date. Overlap condition: `existingStartTime < newEndTime && existingEndTime > newStartTime`. **Skip** (do not insert) any overlapping slot rather than aborting the whole batch. The returned `count` reflects only slots actually inserted.

### Database Transaction

All slot inserts are executed in a **single `prisma.$transaction`**. If any insert fails, the entire batch is rolled back.

### Response

```json
{ "success": true, "count": 42 }
```

- **HTMX request** (`hx-request` header present): render the existing `src/views/partials/seller/slots-created.njk` partial with `{ count }`.
- **Non-HTMX request**: return `res.json({ success: true, count })` — consistent with all other endpoints in the router.

---

## Expiry Nudge Banner

Shown on the seller viewings page when:
- There are no upcoming slots (`lastSlotDate` is `null`), **or**
- The seller's latest upcoming slot date is within 7 days of today

**Banner copy:**
- When `lastSlotDate` is a date within 7 days: *"Your viewing slots expire in X days. [Create more →]"*
- When `lastSlotDate` is `null` (no upcoming slots): *"You have no upcoming viewing slots. [Create slots →]"*

The link activates the Recurring Slots tab.

**Implementation:** Add `findLastUpcomingSlot(propertyId): Promise<Date | null>` to `viewing.repository.ts` — a single `findFirst` with `orderBy: { startTime: 'desc' }` and `where: { status: { not: 'cancelled' }, startTime: { gte: now } }`. Pass the result to the viewings page as `lastSlotDate`. Cannot be derived from the paginated dashboard result (which is limited to 20 slots, ascending order).

---

## Files Affected

| File | Change |
|------|--------|
| `src/views/partials/seller/viewings-dashboard.njk` | Replace recurring slots form with day-row layout |
| `src/views/pages/seller/viewings.njk` | Add expiry nudge banner |
| `src/domains/viewing/viewing.router.ts` | Add `POST /seller/viewings/slots/recurring` route |
| `src/domains/viewing/viewing.validator.ts` | Add `validateCreateRecurringSlots` validator |
| `src/domains/viewing/viewing.service.ts` | Add `createRecurringSlots` service method |
| `src/domains/viewing/viewing.repository.ts` | Add `findLastUpcomingSlot(propertyId)` query |
| `src/domains/viewing/viewing.types.ts` | Add `CreateRecurringSlotsInput` type |
| `public/js/app.js` | Add toggle, add/remove timeslot row JS, JSON serialisation on submit |
| `src/views/partials/seller/slots-created.njk` | Existing — no change needed |

---

## Out of Scope

- Editing existing recurring slot schedules (seller deletes and recreates)
- Per-day custom slot duration (fixed at 10 min for Normal Viewing)
- Auto-renewal of slots past the 1-month window
