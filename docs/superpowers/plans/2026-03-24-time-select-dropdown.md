# Time Select Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four native `<input type="time">` fields in the viewing slot forms with `<select>` dropdowns showing 21 human-readable time options (10:00 AM – 8:00 PM in 30-minute increments).

**Architecture:** Pure template + JS change. Two tasks: (1) swap the inputs and remove error divs in `viewings-dashboard.njk`; (2) delete the now-dead bounds-validation block from `app.js`. No server changes — option values are the same `HH:MM` 24-hour strings the server already expects.

**Tech Stack:** Nunjucks templates, Tailwind CSS, vanilla JS

---

## Files

| File | Change |
|------|--------|
| `src/views/partials/seller/viewings-dashboard.njk` | Replace 4 `<input type="time">` with `<select>`; remove 2 `.viewing-time-error` divs |
| `public/js/app.js` | Remove viewing time bounds validation block (lines 962–987) |

---

### Task 1: Replace time inputs with select dropdowns

**Files:**
- Modify: `src/views/partials/seller/viewings-dashboard.njk`

The reusable set of 21 `<option>` elements (used in all four selects):

```njk
  <option value="">{{ "Select time" | t }}</option>
  <option value="10:00">10:00 AM</option>
  <option value="10:30">10:30 AM</option>
  <option value="11:00">11:00 AM</option>
  <option value="11:30">11:30 AM</option>
  <option value="12:00">12:00 PM</option>
  <option value="12:30">12:30 PM</option>
  <option value="13:00">1:00 PM</option>
  <option value="13:30">1:30 PM</option>
  <option value="14:00">2:00 PM</option>
  <option value="14:30">2:30 PM</option>
  <option value="15:00">3:00 PM</option>
  <option value="15:30">3:30 PM</option>
  <option value="16:00">4:00 PM</option>
  <option value="16:30">4:30 PM</option>
  <option value="17:00">5:00 PM</option>
  <option value="17:30">5:30 PM</option>
  <option value="18:00">6:00 PM</option>
  <option value="18:30">6:30 PM</option>
  <option value="19:00">7:00 PM</option>
  <option value="19:30">7:30 PM</option>
  <option value="20:00">8:00 PM</option>
```

Note: A blank placeholder option (`value=""`) is included first so the select starts empty and `required` correctly blocks submission until the user chooses.

- [ ] **Step 1: Replace Single Slot — Start time (line 83)**

Find:
```njk
              <input type="time" id="add-slot-start" name="startTime" min="10:00" max="20:00" required
                     class="viewing-time-input w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
```

Replace with:
```njk
              <select id="add-slot-start" name="startTime" required
                      class="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{{ "Select time" | t }}</option>
                <option value="10:00">10:00 AM</option>
                <option value="10:30">10:30 AM</option>
                <option value="11:00">11:00 AM</option>
                <option value="11:30">11:30 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="12:30">12:30 PM</option>
                <option value="13:00">1:00 PM</option>
                <option value="13:30">1:30 PM</option>
                <option value="14:00">2:00 PM</option>
                <option value="14:30">2:30 PM</option>
                <option value="15:00">3:00 PM</option>
                <option value="15:30">3:30 PM</option>
                <option value="16:00">4:00 PM</option>
                <option value="16:30">4:30 PM</option>
                <option value="17:00">5:00 PM</option>
                <option value="17:30">5:30 PM</option>
                <option value="18:00">6:00 PM</option>
                <option value="18:30">6:30 PM</option>
                <option value="19:00">7:00 PM</option>
                <option value="19:30">7:30 PM</option>
                <option value="20:00">8:00 PM</option>
              </select>
```

- [ ] **Step 2: Replace Single Slot — End time (line 88)**

Find:
```njk
              <input type="time" id="add-slot-end" name="endTime" min="10:00" max="20:00" required
                     class="viewing-time-input w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
```

Replace with:
```njk
              <select id="add-slot-end" name="endTime" required
                      class="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{{ "Select time" | t }}</option>
                <option value="10:00">10:00 AM</option>
                <option value="10:30">10:30 AM</option>
                <option value="11:00">11:00 AM</option>
                <option value="11:30">11:30 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="12:30">12:30 PM</option>
                <option value="13:00">1:00 PM</option>
                <option value="13:30">1:30 PM</option>
                <option value="14:00">2:00 PM</option>
                <option value="14:30">2:30 PM</option>
                <option value="15:00">3:00 PM</option>
                <option value="15:30">3:30 PM</option>
                <option value="16:00">4:00 PM</option>
                <option value="16:30">4:30 PM</option>
                <option value="17:00">5:00 PM</option>
                <option value="17:30">5:30 PM</option>
                <option value="18:00">6:00 PM</option>
                <option value="18:30">6:30 PM</option>
                <option value="19:00">7:00 PM</option>
                <option value="19:30">7:30 PM</option>
                <option value="20:00">8:00 PM</option>
              </select>
```

- [ ] **Step 3: Remove Single Slot — viewing-time-error div (line 92)**

Find and delete this entire line:
```njk
          <div class="viewing-time-error hidden text-xs text-red-600 -mt-1">{{ "Viewing times must be between 10:00 AM and 8:00 PM." | t }}</div>
```

- [ ] **Step 4: Replace Recurring Slots — Window Start (around line 183)**

Find:
```njk
        <input type="time" name="startTime" min="10:00" max="20:00" required
               class="viewing-time-input w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
```

Replace with (note: larger padding `px-3 py-2` matches the recurring form's existing field sizing; no `id` needed):
```njk
        <select name="startTime" required
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{{ "Select time" | t }}</option>
          <option value="10:00">10:00 AM</option>
          <option value="10:30">10:30 AM</option>
          <option value="11:00">11:00 AM</option>
          <option value="11:30">11:30 AM</option>
          <option value="12:00">12:00 PM</option>
          <option value="12:30">12:30 PM</option>
          <option value="13:00">1:00 PM</option>
          <option value="13:30">1:30 PM</option>
          <option value="14:00">2:00 PM</option>
          <option value="14:30">2:30 PM</option>
          <option value="15:00">3:00 PM</option>
          <option value="15:30">3:30 PM</option>
          <option value="16:00">4:00 PM</option>
          <option value="16:30">4:30 PM</option>
          <option value="17:00">5:00 PM</option>
          <option value="17:30">5:30 PM</option>
          <option value="18:00">6:00 PM</option>
          <option value="18:30">6:30 PM</option>
          <option value="19:00">7:00 PM</option>
          <option value="19:30">7:30 PM</option>
          <option value="20:00">8:00 PM</option>
        </select>
```

- [ ] **Step 5: Replace Recurring Slots — Window End (around line 188)**

Find:
```njk
        <input type="time" name="endTime" min="10:00" max="20:00" required
               class="viewing-time-input w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
```

Replace with:
```njk
        <select name="endTime" required
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{{ "Select time" | t }}</option>
          <option value="10:00">10:00 AM</option>
          <option value="10:30">10:30 AM</option>
          <option value="11:00">11:00 AM</option>
          <option value="11:30">11:30 AM</option>
          <option value="12:00">12:00 PM</option>
          <option value="12:30">12:30 PM</option>
          <option value="13:00">1:00 PM</option>
          <option value="13:30">1:30 PM</option>
          <option value="14:00">2:00 PM</option>
          <option value="14:30">2:30 PM</option>
          <option value="15:00">3:00 PM</option>
          <option value="15:30">3:30 PM</option>
          <option value="16:00">4:00 PM</option>
          <option value="16:30">4:30 PM</option>
          <option value="17:00">5:00 PM</option>
          <option value="17:30">5:30 PM</option>
          <option value="18:00">6:00 PM</option>
          <option value="18:30">6:30 PM</option>
          <option value="19:00">7:00 PM</option>
          <option value="19:30">7:30 PM</option>
          <option value="20:00">8:00 PM</option>
        </select>
```

- [ ] **Step 6: Remove Recurring Slots — viewing-time-error div (around line 191)**

Find and delete this entire line:
```njk
      <div class="viewing-time-error hidden text-xs text-red-600 sm:col-span-2 -mt-2">{{ "Viewing times must be between 10:00 AM and 8:00 PM." | t }}</div>
```

- [ ] **Step 7: Verify the template**

After all edits, grep the file to confirm no `viewing-time-input` or `viewing-time-error` class remains:

```bash
grep -n "viewing-time-input\|viewing-time-error\|type=\"time\"" src/views/partials/seller/viewings-dashboard.njk
```

Expected: no output (zero matches).

Also confirm the four selects exist:
```bash
grep -n "add-slot-start\|add-slot-end\|name=\"startTime\"\|name=\"endTime\"" src/views/partials/seller/viewings-dashboard.njk
```

Expected: 4 lines, all containing `<select`.

- [ ] **Step 8: Commit**

```bash
git add src/views/partials/seller/viewings-dashboard.njk
git commit -m "feat(viewing): replace time inputs with select dropdowns (10AM–8PM, 30min increments)"
```

---

### Task 2: Remove dead bounds-validation JS

**Files:**
- Modify: `public/js/app.js` — remove the `// ── Viewing time bounds validation` block

- [ ] **Step 1: Locate the block**

Read `public/js/app.js` around line 962 to confirm the block to delete:

```js
  // ── Viewing time bounds validation (10:00–20:00) ────────
  document.body.addEventListener('change', function (e) {
    if (!e.target.classList.contains('viewing-time-input')) return;
    ...
  });
```

- [ ] **Step 2: Delete the block**

Remove the entire block from the `// ── Viewing time bounds validation` comment through the closing `});` of that event listener. Do not touch adjacent code.

- [ ] **Step 3: Verify no remaining references**

```bash
grep -n "viewing-time-input\|viewing-time-error" public/js/app.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "chore(viewing): remove time bounds validation (replaced by select dropdowns)"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Single Slot tab**

Navigate to `/seller/viewings`. Click a future date on the calendar. Confirm:
- Start and End fields are now `<select>` dropdowns showing `Select time` as the default
- Dropdown options run from `10:00 AM` to `8:00 PM` in 30-minute steps
- Selecting a date auto-fills Start to `10:00 AM` and End to `11:00 AM` (via `viewing-calendar.js` pre-fill — both values exist as options)
- Submitting without selecting times shows browser required-field validation

- [ ] **Step 3: Verify Recurring Slots tab**

Switch to Recurring Slots. Confirm Window Start and Window End are `<select>` dropdowns with the same 21 options.

- [ ] **Step 4: Verify form submission still works**

In Single Slot: select a date, choose valid start/end times, submit. Confirm slot is created.
In Recurring Slots: select a date range and day, choose window start/end, submit. Confirm slots are created.
