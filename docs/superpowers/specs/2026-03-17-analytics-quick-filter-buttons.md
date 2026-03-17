# Spec: Analytics Dashboard Quick Filter Buttons

**Date:** 2026-03-17
**Status:** Approved

## Overview

Add five quick-access preset filter buttons — This Week, This Month, 3 Months, 6 Months, YTD — above the existing datepicker on the Admin Analytics Dashboard. Clicking a button immediately applies the filter (fires the HTMX request) without requiring the user to click the separate "Filter" button.

## Design Decisions

- **Style:** Outlined text buttons (no fill). Active button: accent colour border (`#c8553d`, 2px) + bold text. Inactive: light grey border + muted text.
- **Placement:** A dedicated row above the datepicker row, separated by a thin divider.
- **Behaviour:** Click immediately calculates dates client-side, updates the date inputs, and triggers the HTMX request.
- **Active state persistence:** A `preset` query param is passed to the server and returned in `filter`. The template uses `filter.preset` to apply active styling. Active state survives the HTMX swap.
- **Manual datepicker interaction:** Using the manual date fields and clicking Filter sends no `preset` param → no button highlighted.

## Presets

| Label      | `preset` value | `dateFrom`                  | `dateTo` |
|------------|----------------|-----------------------------|----------|
| This Week  | `this-week`    | Monday of current week      | Today    |
| This Month | `this-month`   | 1st of current month        | Today    |
| 3 Months   | `3-months`     | 3 calendar months ago       | Today    |
| 6 Months   | `6-months`     | 6 calendar months ago       | Today    |
| YTD        | `ytd`          | Jan 1 of current year       | Today    |

## Implementation Scope

### `src/views/partials/admin/analytics.njk`
- Add quick filter button row above the existing datepicker `<div>`.
- Add `<input type="hidden" id="preset" name="preset" value="{{ filter.preset or '' }}">` inside the form area so it is picked up by `hx-include`.
- Update `hx-include` on the Filter button to also include `#preset`.
- Add `id="filterBtn"` to the Filter button so JS can trigger it programmatically.
- Add inline `<script nonce="{{ cspNonce }}">` with `setPreset(name)` helper.
- Each quick filter button: `type="button"` with `onclick="setPreset('this-week')"` (etc.).
- Active styling driven by `filter.preset`: Nunjucks conditional class on each button.

### `src/domains/admin/admin.router.ts`
- Add `preset: req.query['preset'] as string | undefined` to the analytics filter object.

### No other files need changes.

## JS Helper

```js
function setPreset(name) {
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr = fmt(today);

  let from;
  if (name === 'this-week') {
    const d = new Date(today);
    const day = d.getDay() || 7; // Mon=1 … Sun=7
    d.setDate(d.getDate() - day + 1);
    from = fmt(d);
  } else if (name === 'this-month') {
    from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
  } else if (name === '3-months') {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 3);
    from = fmt(d);
  } else if (name === '6-months') {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 6);
    from = fmt(d);
  } else if (name === 'ytd') {
    from = fmt(new Date(today.getFullYear(), 0, 1));
  }

  document.getElementById('dateFrom').value = from;
  document.getElementById('dateTo').value = todayStr;
  document.getElementById('preset').value = name;
  htmx.trigger(document.getElementById('filterBtn'), 'click');
}
```

## Out of Scope
- Persisting the last-used preset across page loads (session/cookie storage)
- Adding presets to other date filters (audit log, notifications)
