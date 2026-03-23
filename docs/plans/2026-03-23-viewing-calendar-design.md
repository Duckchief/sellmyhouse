# Viewing Calendar — Single Slot Tab Redesign

**Date:** 2026-03-23
**Status:** Approved

## Summary

Replace the native `<input type="date">` in the single slot tab of `/seller/viewings` with a monthly calendar (60% width) and a right sidebar (40% width) containing existing slot summaries and the add-slot form.

## Layout

```
┌─────────────────────────────────┬──────────────────────┐
│         Monthly Calendar        │   Right Sidebar      │
│            (60%)                │      (40%)           │
│                                 │                      │
│  ◀  March 2026  ▶  [Today]     │  (before selection:  │
│  Su Mo Tu We Th Fr Sa          │   "Select a date")   │
│      1  2  3  4  5  6          │                      │
│   7  8  9 10 11 12 13          │  (after selection:   │
│  14 15 16 ●17 18 19 20         │   existing slots     │
│  21 22 23 24 25 26 27          │   summary + form)    │
│  28 29 30 31                   │                      │
│                                 │                      │
│  ● = available  ● = full        │                      │
└─────────────────────────────────┴──────────────────────┘
```

- Desktop: `flex` with `w-[60%]` calendar, `w-[40%]` sidebar, border-right separator on calendar
- Mobile (below `sm`): stack vertically, calendar full width on top, sidebar below

## Calendar Component (Vanilla JS)

A `ViewingCalendar` class (~120-150 lines) renders the month grid. No external dependencies.

### Slot Metadata

Passed from server as JSON blob:

```json
{
  "2026-03-17": { "available": 2, "full": 1 },
  "2026-03-20": { "available": 0, "full": 3 }
}
```

### Date Cell Indicators

- **Green dot** — date has available slots
- **Red dot** — all slots fully booked
- **Both dots** — mix of available and full
- **No dot** — no slots scheduled

### Navigation

- Left/right arrows cycle months
- "Today" button jumps to current month, highlights today
- Past dates dimmed but clickable

### Date Selection

- Clicked date gets blue highlight ring
- Triggers `hx-get="/seller/viewings/slots/date-sidebar?date=YYYY-MM-DD&propertyId=xxx"` targeting the sidebar container
- For months beyond initial 30-day window, month navigation fires `hx-get="/seller/viewings/slots/month-meta?month=YYYY-MM&propertyId=uuid"` returning JSON for dot indicators

## Right Sidebar

### State 1 — No date selected (default)

Centered muted placeholder: "Select a date on the calendar to add a viewing slot."

### State 2 — Date selected, has existing slots

- Date heading (e.g., "Tue, 17 Mar 2026")
- Existing slots as compact rows: time range, type, status dot (green = available, red = full)
- "Add New Slot" section with:
  - Start time (stacked above End time)
  - End time
  - Type dropdown
  - Max viewers (group only)
  - "Add Slot" button
- Start/End pre-filled with next available time gap (computed server-side)

### State 3 — Date selected, no existing slots

Same as State 2 without existing slots section. Pre-fills default 10:00–11:00.

## Server-Side Changes

### New Routes

**`GET /seller/viewings/slots/date-sidebar`**
- Params: `date` (YYYY-MM-DD), `propertyId` (uuid)
- Auth: seller
- Fetches existing slots for date + property
- Computes next available gap (walks sorted slots, finds first gap ≥ 30 min; defaults to 10:00–11:00 if empty)
- Returns rendered partial `partials/seller/viewing-date-sidebar.njk`

**`GET /seller/viewings/slots/month-meta`**
- Params: `month` (YYYY-MM), `propertyId` (uuid)
- Auth: seller
- Returns JSON: `{ "2026-04-05": { "available": 1, "full": 0 }, ... }`

### Slot Metadata on Initial Load

The existing dashboard route already loads `slots` (next 30 days). Extend to also pass `slotsByDate` summary — a reduce over the existing array. No new DB query.

### Existing Form Submission

`POST /seller/viewings/slots` unchanged. Date comes from hidden input set by JS instead of native date picker.

## Files

### New

- `public/js/viewing-calendar.js` — ViewingCalendar class
- `src/views/partials/seller/viewing-date-sidebar.njk` — sidebar partial

### Modified

- `src/views/partials/seller/viewings-dashboard.njk` — replace single slot form with calendar + sidebar layout
- `src/domains/viewing/viewing.router.ts` — add `date-sidebar` and `month-meta` routes
- `src/domains/viewing/viewing.service.ts` — add `getSlotsForDate`, `getMonthSlotMeta`
- `src/domains/viewing/viewing.repository.ts` — date-specific and month-range queries
- `public/js/app.js` — initialize ViewingCalendar on page load
- `src/views/layouts/seller.njk` — include `viewing-calendar.js` script

## Approach

Client-side JS calendar for instant month switching + HTMX for sidebar data fetches. Keeps the HTMX-first pattern of the app while giving snappy calendar interactions.
