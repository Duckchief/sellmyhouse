# Open House Duration Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the recurring slots form Type is set to "Open House", auto-correct the slot duration to 60 min and hard-block submission if the duration is < 30 min.

**Architecture:** Pure client-side. Template changes add a form `id` and a new info modal. All behaviour lives in `public/js/app.js` as direct (non-delegated) event listeners scoped to `#recurring-slots-form`, plus one new case in the existing global `data-action` click handler.

**Tech Stack:** Vanilla JS, Nunjucks, Tailwind CSS

---

## Files

| File | Change |
|------|--------|
| `src/views/partials/seller/viewings-dashboard.njk` | Add `id="recurring-slots-form"` to the recurring slots `<form>` (line 140) |
| `src/views/pages/seller/viewings.njk` | Add `#open-house-duration-modal` markup after the existing `#cancel-slot-modal` |
| `public/js/app.js` | (1) Add `close-open-house-duration-modal` to global click handler; (2) add auto-correct `change` listener; (3) add submit guard |

---

### Task 1: Add form id to recurring slots form

**Files:**
- Modify: `src/views/partials/seller/viewings-dashboard.njk:140`

- [ ] **Step 1: Add the id attribute**

Find the recurring slots `<form>` at line 140 (it has `hx-post="/seller/viewings/slots"` and `data-reset-on-success`). Add `id="recurring-slots-form"`:

```njk
    <form
      id="recurring-slots-form"
      hx-post="/seller/viewings/slots"
      hx-target="#bulk-result"
      hx-swap="innerHTML"
      data-reset-on-success
      class="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
```

- [ ] **Step 2: Verify the form id renders**

Start the dev server (`npm run dev`) and open `/seller/viewings`. Switch to the Recurring Slots tab. In browser DevTools run:

```js
document.getElementById('recurring-slots-form')
```

Expected: the `<form>` element is returned (not `null`).

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/seller/viewings-dashboard.njk
git commit -m "feat(viewing): add id to recurring-slots-form"
```

---

### Task 2: Add the Open House duration modal

**Files:**
- Modify: `src/views/pages/seller/viewings.njk` — after `#cancel-slot-modal` (line 35)

- [ ] **Step 1: Add modal markup**

Open `src/views/pages/seller/viewings.njk`. After the closing `</div>` of `#cancel-slot-modal` (line 35), add:

```njk
{# Open House duration guard modal (hidden by default) #}
<div id="open-house-duration-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden">
  <div class="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
    <p class="text-sm text-gray-700 mb-6">{{ "To make the most of an Open House the minimum slot duration is 30 minutes" | t }}</p>
    <div class="flex justify-end">
      <button type="button"
              data-action="close-open-house-duration-modal"
              class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
        {{ "OK" | t }}
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Verify modal exists in DOM**

In browser DevTools:

```js
document.getElementById('open-house-duration-modal')
```

Expected: the `<div>` element is returned and has class `hidden`.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/seller/viewings.njk
git commit -m "feat(viewing): add open-house-duration-modal markup"
```

---

### Task 3: Wire up the modal dismiss in the global click handler

**Files:**
- Modify: `public/js/app.js` — inside the global `data-action` click handler, after the `close-cancel-slot-modal` block (lines 220–224)

- [ ] **Step 1: Add the dismiss case**

Find the `close-cancel-slot-modal` block (around line 221). Add immediately after it:

```js
    // Close open-house duration modal
    if (action === 'close-open-house-duration-modal') {
      var modal = document.getElementById('open-house-duration-modal');
      if (modal) modal.classList.add('hidden');
    }
```

- [ ] **Step 2: Manually verify dismiss works**

In browser DevTools, show the modal manually:

```js
document.getElementById('open-house-duration-modal').classList.remove('hidden')
```

Then click the "OK" button. Expected: modal disappears (class `hidden` re-added).

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat(viewing): wire close handler for open-house-duration-modal"
```

---

### Task 4: Add auto-correct on type change

**Files:**
- Modify: `public/js/app.js` — after the `#recurring-slots-form` init block (around line 919)

- [ ] **Step 1: Add the change listener**

Find the `// ── Viewing Calendar ──` block (around line 915). Add after the bulk calendar init block (after line 929):

```js
  // ── Open House duration auto-correct ──────────────────
  var recurringForm = document.getElementById('recurring-slots-form');
  if (recurringForm) {
    var slotTypeSelect = recurringForm.querySelector('[name="slotType"]');
    var durationInput = recurringForm.querySelector('[name="slotDurationMinutes"]');
    if (slotTypeSelect && durationInput) {
      slotTypeSelect.addEventListener('change', function () {
        if (slotTypeSelect.value === 'group') {
          durationInput.value = '60';
        } else {
          durationInput.value = '10';
        }
      });
    }
  }
```

- [ ] **Step 2: Manually verify auto-correct**

On the Recurring Slots tab:
1. Change Type to "Open House" → duration field should change to `60`
2. Change Type back to "Single viewer" → duration field should change to `10`
3. Change to "Open House", manually edit duration to `45`, change back to "Single viewer" → should reset to `10`

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat(viewing): auto-correct slot duration on open house type change"
```

---

### Task 5: Add submit guard

**Files:**
- Modify: `public/js/app.js` — inside the `if (recurringForm)` block from Task 4

- [ ] **Step 1: Add the submit listener**

Inside the `if (recurringForm)` block added in Task 4, after the `slotTypeSelect.addEventListener` block, add:

```js
      recurringForm.addEventListener('submit', function (e) {
        var type = recurringForm.querySelector('[name="slotType"]').value;
        var duration = parseInt(recurringForm.querySelector('[name="slotDurationMinutes"]').value, 10);
        if (type === 'group' && duration < 30) {
          e.preventDefault();
          var guardModal = document.getElementById('open-house-duration-modal');
          if (guardModal) guardModal.classList.remove('hidden');
        }
      });
```

The full `if (recurringForm)` block now looks like:

```js
  // ── Open House duration auto-correct ──────────────────
  var recurringForm = document.getElementById('recurring-slots-form');
  if (recurringForm) {
    var slotTypeSelect = recurringForm.querySelector('[name="slotType"]');
    var durationInput = recurringForm.querySelector('[name="slotDurationMinutes"]');
    if (slotTypeSelect && durationInput) {
      slotTypeSelect.addEventListener('change', function () {
        if (slotTypeSelect.value === 'group') {
          durationInput.value = '60';
        } else {
          durationInput.value = '10';
        }
      });
    }

    recurringForm.addEventListener('submit', function (e) {
      var type = recurringForm.querySelector('[name="slotType"]').value;
      var duration = parseInt(recurringForm.querySelector('[name="slotDurationMinutes"]').value, 10);
      if (type === 'group' && duration < 30) {
        e.preventDefault();
        var guardModal = document.getElementById('open-house-duration-modal');
        if (guardModal) guardModal.classList.remove('hidden');
      }
    });
  }
```

- [ ] **Step 2: Verify hard block**

On the Recurring Slots tab:
1. Select calendars for start/end dates
2. Change Type to "Open House" (duration auto-corrects to 60)
3. Manually change duration to `20`
4. Click "Create Recurring Slots"
5. Expected: modal appears with message "To make the most of an Open House the minimum slot duration is 30 minutes"; form is NOT submitted (no HTMX request fires, `#bulk-result` stays empty)
6. Click OK to dismiss
7. Set duration to `30`, click submit
8. Expected: form submits normally

- [ ] **Step 3: Verify single-viewer slots are unaffected**

1. Select Type "Single viewer"
2. Set duration to `5`
3. Click "Create Recurring Slots"
4. Expected: modal does NOT appear; form submits (and server validates normally)

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat(viewing): hard-block open house slot creation if duration < 30 min"
```
