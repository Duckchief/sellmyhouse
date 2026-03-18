# Testimonial Town Combobox Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text Town input in the Add Testimonial admin drawer with a searchable combobox constrained to the 26 official HDB towns.

**Architecture:** Pass `HDB_TOWNS` from the router to the Nunjucks partial. Replace the `<input type="text">` with a combobox: a visible search input + hidden input for form value + server-rendered dropdown list filtered by inline vanilla JS.

**Tech Stack:** TypeScript (Express router), Nunjucks templates, vanilla JS (inline in partial), Tailwind CSS.

---

## Chunk 1: Router — pass towns to drawer partial

**Files:**
- Modify: `src/domains/admin/admin.router.ts` (lines ~1–18 for import, ~1134–1144 for GET, ~1190–1194 for POST 422)

### Task 1: Add HDB_TOWNS import and pass towns to drawer renders

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Add HDB_TOWNS import**

  In `src/domains/admin/admin.router.ts`, add to the existing imports (after line 17):

  ```typescript
  import { HDB_TOWNS } from '@/domains/property/property.types';
  ```

- [ ] **Step 2: Pass towns to GET /admin/content/testimonials/new**

  Find the GET handler at line ~1138:
  ```typescript
  return res.render('partials/admin/testimonial-add-drawer');
  ```
  Replace with:
  ```typescript
  return res.render('partials/admin/testimonial-add-drawer', { towns: HDB_TOWNS });
  ```

- [ ] **Step 3: Pass towns to the 422 re-render in POST handler**

  Find the 422 re-render at line ~1191:
  ```typescript
  return res.status(422).render('partials/admin/testimonial-add-drawer', {
    errors: errors.array(),
    values: req.body,
  });
  ```
  Replace with:
  ```typescript
  return res.status(422).render('partials/admin/testimonial-add-drawer', {
    errors: errors.array(),
    values: req.body,
    towns: HDB_TOWNS,
  });
  ```

- [ ] **Step 4: Verify existing router test still passes**

  Run: `npm test -- --testPathPattern="admin.router.test"`
  Expected: All existing testimonial tests pass. (No new test needed — the GET /new route test simply checks a 200 response; passing extra template vars doesn't break it.)

- [ ] **Step 5: Commit**

  ```bash
  git add src/domains/admin/admin.router.ts
  git commit -m "feat: pass HDB_TOWNS to testimonial add drawer partial"
  ```

---

## Chunk 2: Template — combobox markup and inline JS

**Files:**
- Modify: `src/views/partials/admin/testimonial-add-drawer.njk`

### Task 2: Replace Town text input with combobox

**Files:**
- Modify: `src/views/partials/admin/testimonial-add-drawer.njk`

- [ ] **Step 1: Replace the Town field block**

  Find and remove the existing Town input block (lines ~52–65):
  ```njk
  <div>
    <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-clientTown">
      {{ "Town" | t }}
    </label>
    <input
      type="text"
      id="drawer-clientTown"
      name="clientTown"
      value="{{ values.clientTown if values else '' }}"
      maxlength="100"
      required
      class="input-field w-full"
      placeholder="{{ 'e.g. Bishan' | t }}">
  </div>
  ```

  Replace it with the following combobox block:
  ```njk
  <div>
    <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-clientTown-search">
      {{ "Town" | t }}
    </label>
    <div class="relative" id="town-combobox">
      {# Visible search input #}
      <input
        type="text"
        id="drawer-clientTown-search"
        autocomplete="off"
        placeholder="{{ 'Search town…' | t }}"
        value="{{ values.clientTown if values else '' }}"
        class="input-field w-full pl-8 pr-8"
        oninput="townComboFilter(this.value)"
        onfocus="townComboShow()"
        onblur="setTimeout(townComboHide, 150)"
        aria-autocomplete="list"
        aria-controls="town-combobox-list"
        aria-expanded="false">
      {# Search icon #}
      <svg class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
      </svg>
      {# Chevron icon #}
      <svg id="town-combobox-chevron" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>
      {# Hidden input — submitted with the form. No `required` here (browsers ignore it on
         hidden inputs). Client-side enforcement is handled by the submit guard in the script. #}
      <input
        type="hidden"
        id="drawer-clientTown"
        name="clientTown"
        value="{{ values.clientTown if values else '' }}">
      {# Dropdown list #}
      <div
        id="town-combobox-list"
        role="listbox"
        class="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto hidden">
        {% for town in towns %}
        <div
          role="option"
          class="px-3 py-2 text-sm text-gray-800 cursor-pointer hover:bg-indigo-50"
          onmousedown="townComboSelect('{{ town }}')">
          {{ town }}
        </div>
        {% endfor %}
        {# Empty state — shown when no towns match the search query #}
        <div id="town-combobox-empty" class="px-3 py-2 text-sm text-gray-400 hidden">
          {{ "No towns found" | t }}
        </div>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 2: Add inline script for combobox behaviour**

  The entire partial is swapped into `#testimonial-drawer-content` via HTMX (`hx-swap="innerHTML"`).
  HTMX 1.x re-executes `<script>` tags inside swapped fragments by default (`htmx.config.allowScriptTags = true`),
  so the script runs fresh on every render — meaning `allItems` always references the current DOM.

  Place the `<script>` block immediately after the closing `</form>` tag at the bottom of the file
  (just before the final `</div>` that wraps the entire drawer). The file currently ends:
  ```
  </form>
  </div>   ← outermost wrapper
  ```
  Insert between those two lines.

  ```njk
  <script>
    (function () {
      // allItems excludes the empty-state element (it has no role="option")
      var allItems = Array.from(document.querySelectorAll('#town-combobox-list [role="option"]'));
      var emptyEl  = document.getElementById('town-combobox-empty');

      function townComboShow() {
        allItems.forEach(function (el) { el.style.display = ''; });
        emptyEl.classList.add('hidden');
        document.getElementById('town-combobox-list').classList.remove('hidden');
        document.getElementById('town-combobox-chevron').style.transform = 'translateY(-50%) rotate(180deg)';
        document.getElementById('drawer-clientTown-search').setAttribute('aria-expanded', 'true');
      }

      function townComboHide() {
        document.getElementById('town-combobox-list').classList.add('hidden');
        document.getElementById('town-combobox-chevron').style.transform = 'translateY(-50%)';
        document.getElementById('drawer-clientTown-search').setAttribute('aria-expanded', 'false');
      }

      function townComboFilter(q) {
        var lower   = q.toLowerCase();
        var anyVisible = false;
        allItems.forEach(function (el) {
          var match = el.textContent.trim().toLowerCase().includes(lower);
          el.style.display = match ? '' : 'none';
          if (match) anyVisible = true;
        });
        emptyEl.classList.toggle('hidden', anyVisible);
        document.getElementById('town-combobox-list').classList.remove('hidden');
        document.getElementById('town-combobox-chevron').style.transform = 'translateY(-50%) rotate(180deg)';
      }

      function townComboSelect(town) {
        document.getElementById('drawer-clientTown-search').value = town;
        document.getElementById('drawer-clientTown').value = town;
        townComboHide();
      }

      // Submit guard — prevent form submission if no town is selected.
      // (browsers do not enforce `required` on hidden inputs)
      var form = document.getElementById('drawer-clientTown-search').closest('form');
      form.addEventListener('submit', function (e) {
        if (!document.getElementById('drawer-clientTown').value) {
          e.preventDefault();
          document.getElementById('drawer-clientTown-search').focus();
          document.getElementById('drawer-clientTown-search').setCustomValidity('{{ "Please select a town." | t }}');
          document.getElementById('drawer-clientTown-search').reportValidity();
        } else {
          document.getElementById('drawer-clientTown-search').setCustomValidity('');
        }
      });

      window.townComboShow   = townComboShow;
      window.townComboHide   = townComboHide;
      window.townComboFilter = townComboFilter;
      window.townComboSelect = townComboSelect;
    })();
  </script>
  ```

- [ ] **Step 3: Manual smoke test**

  Start dev server: `npm run dev`

  1. Navigate to `/admin/content/testimonials`
  2. Click **+ Add Testimonial**
  3. Click the Town field — verify the full 26-town list appears
  4. Type `"bu"` — verify list filters to BUKIT BATOK, BUKIT MERAH, BUKIT PANJANG, BUKIT TIMAH
  5. Click **BUKIT TIMAH** — verify text input shows "BUKIT TIMAH", dropdown closes
  6. Submit the form with all required fields — verify testimonial is created successfully
  7. Submit the form with Town left empty (search input has text but nothing was selected from the list) — verify the browser shows a "Please select a town." validation tooltip and the form does NOT submit (the submit guard fires before HTMX)

- [ ] **Step 4: Run full test suite**

  Run: `npm test`
  Expected: All tests pass (no template-level unit tests exist for this partial; router tests pass because they only check HTTP status codes).

- [ ] **Step 5: Commit**

  ```bash
  git add src/views/partials/admin/testimonial-add-drawer.njk
  git commit -m "feat: replace town text input with searchable combobox in add testimonial drawer"
  ```
