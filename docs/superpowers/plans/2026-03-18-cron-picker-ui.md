# Cron Picker UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw cron text input for `market_content_schedule` in `/admin/settings` with a friendly day-of-week toggle + time picker that generates the cron expression automatically.

**Architecture:** Add `inputType: 'text' | 'cron'` to `SettingWithMeta`; the service assigns `'cron'` to `market_content_schedule`; `settings.njk` branches on `inputType` to render a new `cron-picker.njk` partial; a small JS module handles toggle state, cron generation, and the human-readable summary. Storage is unchanged — the cron string is still saved to `SystemSetting.value`.

**Tech Stack:** TypeScript, Nunjucks, vanilla JS (no new dependencies)

---

## Chunk 1: Types, Service, Validator

**Files:**
- Modify: `src/domains/admin/admin.types.ts:50-55`
- Modify: `src/domains/admin/admin.service.ts:416-461`
- Modify: `src/domains/admin/admin.validator.ts:36`
- Test: `src/domains/admin/__tests__/admin.service.test.ts`

> **Note:** `inputType` is added to `SettingWithMeta` in `admin.types.ts` (not `settings.types.ts`) because it is a UI-layer concern specific to the admin settings page, not a core settings domain type.

### Task 1: Add `inputType` to `SettingWithMeta`

- [ ] **Step 1: Modify `admin.types.ts`**

  In `src/domains/admin/admin.types.ts`, add `inputType` to `SettingWithMeta`:

  ```typescript
  export interface SettingWithMeta {
    key: string;
    value: string;
    description: string;
    updatedAt: Date;
    inputType: 'text' | 'cron';
  }
  ```

- [ ] **Step 2: Run build to surface any type errors**

  ```bash
  npm run build 2>&1 | head -40
  ```

  Expected: compile errors in `admin.service.ts` where `SettingWithMeta` is constructed without `inputType` — this is expected and guides the next step.

### Task 2: Wire `inputType` in `getSettingsGrouped`

- [ ] **Step 1: Write the failing test**

  In `src/domains/admin/__tests__/admin.service.test.ts`, add a new `describe('getSettingsGrouped', ...)` block (after the existing `updateSetting` describe):

  ```typescript
  describe('getSettingsGrouped', () => {
    it('assigns inputType cron to market_content_schedule and text to others', async () => {
      mockSettingsService.findAll.mockResolvedValueOnce([
        { id: '1', key: 'market_content_schedule', value: '0 8 * * 1', description: 'desc', updatedByAgentId: null, updatedAt: new Date(), createdAt: new Date() },
        { id: '2', key: 'maintenance_mode', value: 'false', description: 'desc', updatedByAgentId: null, updatedAt: new Date(), createdAt: new Date() },
      ]);

      const groups = await adminService.getSettingsGrouped();
      const platform = groups.find((g) => g.label === 'Platform')!;
      const schedSetting = platform.settings.find((s) => s.key === 'market_content_schedule')!;
      const modeSetting = platform.settings.find((s) => s.key === 'maintenance_mode')!;

      expect(schedSetting.inputType).toBe('cron');
      expect(modeSetting.inputType).toBe('text');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm test -- --testPathPattern=__tests__/admin.service --verbose 2>&1 | tail -20
  ```

  Expected: FAIL — `inputType` property missing on object.

- [ ] **Step 3: Update `getSettingsGrouped` in `admin.service.ts`**

  Add a `CRON_KEYS` set and assign `inputType` in the mapping. Replace the `group` helper inside `getSettingsGrouped`:

  ```typescript
  const CRON_KEYS = new Set(['market_content_schedule']);

  const group = (label: string, keys: string[]): SettingGroup => ({
    label,
    settings: keys
      .map((k) => {
        const s = map.get(k);
        return s
          ? ({
              key: k,
              value: s.value,
              description: s.description,
              updatedAt: s.updatedAt,
              inputType: CRON_KEYS.has(k) ? 'cron' : 'text',
            } satisfies SettingWithMeta)
          : null;
      })
      .filter((s): s is SettingWithMeta => s !== null),
  });
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npm test -- --testPathPattern=__tests__/admin.service --verbose 2>&1 | tail -20
  ```

  Expected: PASS.

### Task 3: Tighten validator for `market_content_schedule`

The current validator accepts any cron-like string. Since the UI now generates a specific format (`{min} {hour} * * {dow}`), tighten it to reject malformed values.

- [ ] **Step 1: Write the failing test**

  In `src/domains/admin/__tests__/admin.service.test.ts`, add to the `updateSetting` describe block:

  ```typescript
  it('rejects invalid cron expression for market_content_schedule', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(
      adminService.updateSetting('market_content_schedule', 'not-a-cron', 'admin-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts valid multi-day cron expression for market_content_schedule', async () => {
    mockSettingsService.findByKey.mockResolvedValueOnce(null);
    mockSettingsService.upsert.mockResolvedValueOnce({} as any);
    // mockAudit.log is already defaulted to resolved in beforeEach

    await expect(
      adminService.updateSetting('market_content_schedule', '30 9 * * 1,3', 'admin-1'),
    ).resolves.toBeUndefined();
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npm test -- --testPathPattern=__tests__/admin.service --verbose 2>&1 | tail -20
  ```

  Expected: the valid-cron test FAILS because the existing loose regex `/^[\d*,\-/\s]+$/` does not match `30 9 * * 1,3` (the `*` literals and spaces match but the existing regex is actually permissive enough that it may pass). Run to confirm the current behaviour — the rejection test (`'not-a-cron'`) should already PASS since letters are not in `[\d*,\-/\s]`. The valid-cron test tells you the current regex accepts or rejects `30 9 * * 1,3` before your change.

- [ ] **Step 3: Update validator in `admin.validator.ts`**

  Replace:
  ```typescript
  market_content_schedule: (v) => /^[\d*,\-/\s]+$/.test(v),
  ```
  With:
  ```typescript
  market_content_schedule: (v) => /^\d{1,2} \d{1,2} \* \* [\d,]+$/.test(v),
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  npm test -- --testPathPattern=__tests__/admin.service --verbose 2>&1 | tail -20
  ```

  Expected: PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

  ```bash
  npm test 2>&1 | tail -20
  ```

  Expected: all tests passing.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domains/admin/admin.types.ts src/domains/admin/admin.service.ts src/domains/admin/admin.validator.ts src/domains/admin/__tests__/admin.service.test.ts
  git commit -m "feat: add inputType to SettingWithMeta; assign cron type to market_content_schedule"
  ```

---

## Chunk 2: Template + Partial

**Files:**
- Modify: `src/views/pages/admin/settings.njk`
- Create: `src/views/partials/admin/cron-picker.njk`

### Task 4: Create cron picker partial

- [ ] **Step 1: Create `src/views/partials/admin/cron-picker.njk`**

  This partial is included inside the existing settings row `<form>`. It receives the `setting` variable from the parent template.

  ```nunjucks
  {#
    Cron picker partial — renders day toggles + time dropdowns.
    Included inside the settings row <form> for settings with inputType='cron'.
    Expects: setting.value (current cron string), setting.key
  #}
  <div class="cron-picker flex flex-col gap-2" data-key="{{ setting.key }}" data-value="{{ setting.value }}">

    {# Day toggles #}
    <div class="flex gap-1" role="group" aria-label="{{ 'Days of week' | t }}">
      {% set days = [
        { label: 'Mon', dow: 1 },
        { label: 'Tue', dow: 2 },
        { label: 'Wed', dow: 3 },
        { label: 'Thu', dow: 4 },
        { label: 'Fri', dow: 5 },
        { label: 'Sat', dow: 6 },
        { label: 'Sun', dow: 0 }
      ] %}
      {% for day in days %}
      <button
        type="button"
        class="cron-day-btn px-2 py-1 rounded text-xs font-medium border border-gray-200 bg-gray-100 text-gray-500 hover:bg-indigo-50"
        data-dow="{{ day.dow }}"
        aria-pressed="false"
      >{{ day.label | t }}</button>
      {% endfor %}
    </div>

    {# Time + Save row #}
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-500">{{ 'at' | t }}</span>
      <select name="_hour" class="cron-hour border border-gray-300 rounded px-1 py-1 text-sm bg-white">
        {% for h in range(0, 24) %}
        <option value="{{ '0' if h < 10 else '' }}{{ h }}">{{ '0' if h < 10 else '' }}{{ h }}</option>
        {% endfor %}
      </select>
      <span class="text-sm text-gray-400">:</span>
      <select name="_minute" class="cron-minute border border-gray-300 rounded px-1 py-1 text-sm bg-white">
        {% for m in [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] %}
        <option value="{{ '0' if m < 10 else '' }}{{ m }}">{{ '0' if m < 10 else '' }}{{ m }}</option>
        {% endfor %}
      </select>
      <span class="text-xs text-gray-400">SGT</span>
      <input type="hidden" name="value" class="cron-value" value="{{ setting.value }}" />
      <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ 'Save' | t }}</button>
    </div>

    {# Human-readable summary #}
    <div class="cron-summary text-xs text-emerald-600"></div>

  </div>
  ```

- [ ] **Step 2: Verify the partial file exists**

  ```bash
  ls src/views/partials/admin/cron-picker.njk
  ```

  Expected: file listed with no error.

### Task 5: Branch on `inputType` in `settings.njk`

- [ ] **Step 1: Modify the settings row form in `settings.njk`**

  Replace the existing form content:
  ```nunjucks
  <form class="flex items-center gap-2" hx-post="/admin/settings/{{ setting.key }}" hx-target="#result-{{ setting.key }}">
    <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
    <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
  </form>
  ```

  With:
  ```nunjucks
  <form
    class="{{ 'flex flex-col items-start gap-2' if setting.inputType == 'cron' else 'flex items-center gap-2' }}"
    hx-post="/admin/settings/{{ setting.key }}"
    hx-target="#result-{{ setting.key }}"
  >
    {% if setting.inputType == 'cron' %}
      {% include "partials/admin/cron-picker.njk" %}
    {% else %}
      <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
      <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
    {% endif %}
  </form>
  ```

  > **Nunjucks note:** Use `==` (double equals) for equality checks in Nunjucks — `===` is not supported and will always evaluate to `false`.
  > **Layout note:** The cron picker is multi-row (`flex-col`) so the form switches to `flex-col items-start` when rendering it; all other rows keep the original `flex items-center` layout.

- [ ] **Step 2: Run build to check for template/compile errors**

  ```bash
  npm run build 2>&1 | tail -20
  ```

  Expected: no errors.

- [ ] **Step 3: Run test suite to verify no regressions**

  ```bash
  npm test 2>&1 | tail -20
  ```

  Expected: all tests passing.

- [ ] **Step 4: Commit**

  ```bash
  git add src/views/pages/admin/settings.njk src/views/partials/admin/cron-picker.njk
  git commit -m "feat: add cron-picker partial and branch settings.njk on inputType"
  ```

---

## Chunk 3: JavaScript

**Files:**
- Modify: `public/js/app.js`

### Task 6: Add cron picker JS to `app.js`

The JS parses the existing stored cron value to pre-populate the picker, handles day toggles and time changes, generates the cron string, and updates the human-readable summary.

DOW mapping: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6 (standard cron).

Day label lookup for summary: `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`.

- [ ] **Step 1: Add `cronPicker` namespace to `public/js/app.js`**

  Append the following block inside the existing IIFE in `public/js/app.js`, after the last existing section and before the closing `})();`:

  ```javascript
  // ── Cron Picker ────────────────────────────────────────────────
  (function () {
    var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function parseCron(expr) {
      var defaults = { minute: 0, hour: 8, days: [1] };
      if (!expr) return defaults;
      var parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) return defaults;
      var minute = parseInt(parts[0], 10);
      var hour = parseInt(parts[1], 10);
      if (isNaN(minute) || isNaN(hour)) return defaults;
      var dowPart = parts[4];
      var days = dowPart
        .split(',')
        .map(function (d) { return parseInt(d, 10); })
        .filter(function (d) { return !isNaN(d) && d >= 0 && d <= 6; });
      if (days.length === 0) days = [1];
      return { minute: minute, hour: hour, days: days };
    }

    function generateCron(days, hour, minute) {
      var sorted = days.slice().sort(function (a, b) { return a - b; });
      return minute + ' ' + hour + ' * * ' + sorted.join(',');
    }

    function updateSummary(container) {
      var activeBtns = container.querySelectorAll('.cron-day-btn[aria-pressed="true"]');
      var days = [];
      activeBtns.forEach(function (btn) {
        days.push(parseInt(btn.dataset.dow, 10));
      });
      if (days.length === 0) days = [1]; // fallback

      var hourEl = container.querySelector('.cron-hour');
      var minuteEl = container.querySelector('.cron-minute');
      var hour = parseInt(hourEl.value, 10);
      var minute = parseInt(minuteEl.value, 10);

      var cron = generateCron(days, hour, minute);
      container.querySelector('.cron-value').value = cron;

      var dayNames = days
        .slice()
        .sort(function (a, b) { return a - b; })
        .map(function (d) { return DAY_LABELS[d]; })
        .join(', ');
      var hh = String(hour).padStart(2, '0');
      var mm = String(minute).padStart(2, '0');
      container.querySelector('.cron-summary').innerHTML =
        '&#10003; Runs every <strong>' + dayNames + '</strong> at <strong>' + hh + ':' + mm + '</strong> SGT' +
        ' &nbsp;&middot;&nbsp; <span style="font-family:monospace;color:#9ca3af;">' + cron + '</span>';
    }

    function initCronPicker(container) {
      var existing = container.dataset.value || '';
      var parsed = parseCron(existing);

      // Set hour dropdown
      var hourEl = container.querySelector('.cron-hour');
      hourEl.value = String(parsed.hour).padStart(2, '0');

      // Set minute dropdown — snap to nearest 5-min increment
      var minuteEl = container.querySelector('.cron-minute');
      var snapped = Math.round(parsed.minute / 5) * 5;
      if (snapped >= 60) snapped = 55;
      minuteEl.value = String(snapped).padStart(2, '0');

      // Activate matching day buttons
      container.querySelectorAll('.cron-day-btn').forEach(function (btn) {
        var dow = parseInt(btn.dataset.dow, 10);
        if (parsed.days.indexOf(dow) !== -1) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.remove('bg-gray-100', 'text-gray-500');
          btn.classList.add('bg-indigo-100', 'text-indigo-700', 'font-semibold');
        }
      });

      // Day toggle handler
      container.querySelectorAll('.cron-day-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pressed = btn.getAttribute('aria-pressed') === 'true';
          btn.setAttribute('aria-pressed', String(!pressed));
          if (!pressed) {
            btn.classList.remove('bg-gray-100', 'text-gray-500');
            btn.classList.add('bg-indigo-100', 'text-indigo-700', 'font-semibold');
          } else {
            btn.classList.remove('bg-indigo-100', 'text-indigo-700', 'font-semibold');
            btn.classList.add('bg-gray-100', 'text-gray-500');
          }
          updateSummary(container);
        });
      });

      // Time change handlers
      hourEl.addEventListener('change', function () { updateSummary(container); });
      minuteEl.addEventListener('change', function () { updateSummary(container); });

      // Initial summary
      updateSummary(container);
    }

    document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('.cron-picker').forEach(initCronPicker);
    });
  })();
  ```

- [ ] **Step 2: Verify the build compiles cleanly**

  ```bash
  npm run build 2>&1 | tail -20
  ```

  Expected: no errors.

- [ ] **Step 3: Smoke test in browser**

  Start the dev server:
  ```bash
  npm run dev
  ```

  Navigate to `http://localhost:3000/admin/settings` (log in as admin). Verify:
  - The `market_content_schedule` row shows day buttons (Mon highlighted), hour `08`, minute `00`.
  - Clicking a second day button highlights it and updates the summary + hidden value.
  - Changing the time updates the summary.
  - Clicking Save posts successfully and shows a success indicator.
  - All other settings rows still show plain text inputs.

- [ ] **Step 4: Run full test suite**

  ```bash
  npm test && npm run test:integration
  ```

  Expected: all tests passing.

- [ ] **Step 5: Commit**

  ```bash
  git add public/js/app.js
  git commit -m "feat: add cron picker JS — day toggles, time dropdowns, auto-generates cron expression"
  ```

---

## Done

All three chunks complete. The `market_content_schedule` setting now renders as a day+time picker in `/admin/settings`. The cron string is still stored in `SystemSetting.value` unchanged.
