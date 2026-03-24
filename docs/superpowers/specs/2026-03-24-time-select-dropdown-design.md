# Time Select Dropdown — Design Spec

**Date:** 2026-03-24
**Scope:** Window Start/End fields in the Recurring Slots form; Start/End fields in the Single Slot form (`/seller/viewings`)

## Problem

The native `<input type="time">` widget is clunky — it forces users through a spinner or requires manual `HH:MM` entry. Both time fields in both slot forms should be replaced with a plain `<select>` showing human-readable options in 30-minute increments.

## Options

22 options covering 10:00 AM to 8:00 PM in 30-minute increments:

| Value (submitted) | Label (displayed) |
|-------------------|-------------------|
| `10:00` | `10:00 AM` |
| `10:30` | `10:30 AM` |
| `11:00` | `11:00 AM` |
| `11:30` | `11:30 AM` |
| `12:00` | `12:00 PM` |
| `12:30` | `12:30 PM` |
| `13:00` | `1:00 PM` |
| `13:30` | `1:30 PM` |
| `14:00` | `2:00 PM` |
| `14:30` | `2:30 PM` |
| `15:00` | `3:00 PM` |
| `15:30` | `3:30 PM` |
| `16:00` | `4:00 PM` |
| `16:30` | `4:30 PM` |
| `17:00` | `5:00 PM` |
| `17:30` | `5:30 PM` |
| `18:00` | `6:00 PM` |
| `18:30` | `6:30 PM` |
| `19:00` | `7:00 PM` |
| `19:30` | `7:30 PM` |
| `20:00` | `8:00 PM` |

Option values are 24-hour `HH:MM` strings — identical to what `<input type="time">` submitted — so no server-side changes are needed.

## Template Changes — `src/views/partials/seller/viewings-dashboard.njk`

### Single Slot form (`#add-slot-form`, lines 83–90)

Replace:
```njk
<input type="time" id="add-slot-start" name="startTime" min="10:00" max="20:00" required
       class="viewing-time-input w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
```
With:
```njk
<select id="add-slot-start" name="startTime" required
        class="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
  <!-- 22 options: 10:00 AM → 8:00 PM in 30-min increments -->
</select>
```

Replace the End input similarly (`id="add-slot-end"`, `name="endTime"`).

Remove the `.viewing-time-error` div (line 92) from this form.

### Recurring Slots form (`#recurring-slots-form`, lines 183–190)

Replace both `<input type="time">` fields (`name="startTime"` Window Start, `name="endTime"` Window End) with `<select>` elements using the same 22 options.

Remove the `.viewing-time-error` div (line 191) from this form.

### No default selected option

No option is pre-selected (`selected` attribute) — the selects start blank, forcing the user to choose. The `required` attribute ensures the form cannot submit without a selection.

## JS Changes — `public/js/app.js`

Remove the entire `// ── Viewing time bounds validation (10:00–20:00) ────────` block (lines 962–987). This block fires on `change` of `.viewing-time-input` elements, which no longer exist. All validation logic it contained (border-red highlighting, error div toggling) becomes unnecessary.

## No Changes Required

- **`public/js/viewing-calendar.js`** — The `selectDate` method pre-fills `startInput.value = '10:00'` and `endInput.value = '11:00'` by ID. Assigning `.value` on a `<select>` selects the matching option, so `10:00` and `11:00` both exist in the option list and will work without modification.
- **Server-side validators** — Option values are the same `HH:MM` format the server already expects.
- **`app.js` Open House submit guard** — Reads `slotDurationMinutes`, not the time fields. Unaffected.

## Files Changed

| File | Change |
|------|--------|
| `src/views/partials/seller/viewings-dashboard.njk` | Replace 4 `<input type="time">` with `<select>`; remove 2 `.viewing-time-error` divs |
| `public/js/app.js` | Remove viewing time bounds validation block |
