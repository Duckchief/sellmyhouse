# Cron Picker UI for Admin Settings

**Date:** 2026-03-18
**Feature:** Replace raw cron text input with a day+time picker for non-technical admins

## Problem

The `market_content_schedule` SystemSetting is currently a plain text input showing `0 8 * * 1`. Non-technical admins have no way to understand or safely modify cron syntax.

## Design

### Storage

No schema change. The cron string (e.g. `0 8 * * 1`) continues to be stored as-is in `SystemSetting.value`. The picker is purely a UI layer.

### inputType field

Add `inputType: 'text' | 'cron'` to the settings type definition in `src/domains/shared/settings.types.ts`. The admin service/controller passes `inputType` alongside each setting when building the grouped settings list. Only `market_content_schedule` is assigned `inputType: 'cron'` initially; all other settings default to `'text'`.

### Template

`src/views/pages/admin/settings.njk` checks `setting.inputType`:
- `'text'` (default): render existing plain `<input type="text">` + Save button
- `'cron'`: render `partials/admin/cron-picker.njk`

### Cron Picker Partial (`partials/admin/cron-picker.njk`)

Renders inside the existing settings row form. Contains:

1. **Day toggles** — seven buttons (Mon–Sun), multi-select. Selected state: indigo background + bold text. Unselected: gray.
2. **Time dropdowns** — hour (00–23) and minute (00, 05, 10, …, 55) selects, labelled "at HH : MM SGT".
3. **Hidden input** `<input type="hidden" name="value">` — updated by JS with the generated cron expression before form submit.
4. **Save button** — standard indigo button, same as other settings rows.
5. **Human-readable summary** — shown below the controls in muted green: "Runs every Mon, Wed at 08:00 SGT · `0 8 * * 1,3`". The raw cron expression is displayed dimmed (monospace) for transparency.

### JavaScript (`public/js/app.js`)

Add a `CronPicker` class (or plain functions under a `cronPicker` namespace):

- **`initCronPicker(container)`** — called on DOMContentLoaded for each `.cron-picker` container. Parses the existing hidden input value to pre-populate day buttons and time dropdowns.
- **`parseCron(expr)`** — parses `min hour * * dow` into `{ minute, hour, days[] }`. Handles comma-separated DOW (`1,3`). Returns defaults `{ minute: 0, hour: 8, days: [1] }` on parse failure.
- **`generateCron(days, hour, minute)`** — returns `{minute} {hour} * * {dow}` string. DOW sorted ascending, comma-joined.
- **`updateSummary(container)`** — regenerates the cron string, updates the hidden input, and rewrites the human-readable summary line.
- Day button clicks and time dropdown `change` events call `updateSummary`.

### Validation (backend)

In `src/domains/admin/admin.validator.ts`, add a cron-format check for settings with `inputType: 'cron'`. Accepted pattern: `/^\d{1,2} \d{1,2} \* \* [\d,]+$/`. Return a `ValidationError` with a human-readable message on failure.

## Scope

- Only `market_content_schedule` gets `inputType: 'cron'` now.
- The `inputType` field is available for future use on other settings.
- Minute dropdown uses 5-minute increments (00, 05, 10, …, 55) to keep the list manageable; the parser accepts any valid minute value from existing stored data.

## Files Changed

- `src/domains/shared/settings.types.ts` — add `inputType` to settings type
- `src/domains/admin/admin.service.ts` — assign `inputType: 'cron'` to `market_content_schedule`
- `src/views/pages/admin/settings.njk` — branch on `setting.inputType`
- `src/views/partials/admin/cron-picker.njk` — new partial
- `public/js/app.js` — cron picker JS
- `src/domains/admin/admin.validator.ts` — cron format validation
