# Avatar 2MB Upload Limit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a consistent 2MB file size limit on avatar uploads across service, multer middleware, and client-side JS.

**Architecture:** Three independent enforcement layers — client aborts before Cropper.js opens, multer rejects at HTTP boundary, service validates regardless of middleware. Each layer fails fast.

**Tech Stack:** TypeScript, multer, Express, Nunjucks, vanilla JS

---

## File Map

| File | Change |
|------|--------|
| `src/domains/profile/profile.service.ts` | Change `MAX_SIZE` to 2MB, update error message |
| `src/domains/profile/__tests__/profile.service.test.ts` | Update size test: 2MB threshold + new error message |
| `src/domains/profile/profile.multer.ts` | Change `fileSize` limit to 2MB |
| `src/views/partials/profile/avatar-display.njk` | Add `#avatar-size-error` element |
| `src/views/pages/profile/index.njk` | Add client-side size check in `change` handler |
| `src/views/pages/profile/index-admin.njk` | Same client-side size check (duplicate block) |

---

## Chunk 1: Service + Multer + Client

### Task 1: Service — change MAX_SIZE to 2MB

**Files:**
- Modify: `src/domains/profile/profile.service.ts:11,25-26`
- Test: `src/domains/profile/__tests__/profile.service.test.ts:56-61`

- [ ] **Step 1: Update the failing test first**

In `profile.service.test.ts`, find the test `'rejects files over 5MB'` and update it:

```typescript
it('rejects files over 2MB', async () => {
  const bigFile = { ...mockFile, size: 3 * 1024 * 1024 } as Express.Multer.File;
  await expect(service.uploadAvatar('agent1', bigFile)).rejects.toThrow(
    'File too large. Maximum size is 2MB.',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest profile.service --no-coverage 2>&1 | tail -20
```

Expected: FAIL — test expects `'File too large. Maximum size is 2MB.'` but service throws `'Avatar must be under 5MB'`

- [ ] **Step 3: Update the service**

In `profile.service.ts`, change lines 11, 24–26:

```typescript
// Line 11 — was: const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// Lines 24–26 — was: throw new ValidationError('Avatar must be under 5MB');
if (file.size > MAX_SIZE) {
  throw new ValidationError('File too large. Maximum size is 2MB.');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest profile.service --no-coverage 2>&1 | tail -10
```

Expected: all tests in `profile.service` pass

- [ ] **Step 5: Commit**

```bash
git add src/domains/profile/profile.service.ts src/domains/profile/__tests__/profile.service.test.ts
git commit -m "feat: enforce 2MB avatar size limit in service"
```

---

### Task 2: Multer — change fileSize limit to 2MB

**Files:**
- Modify: `src/domains/profile/profile.multer.ts:7`

No unit test for multer config (it's tested implicitly via integration tests). This is a one-line change.

- [ ] **Step 1: Update the limit**

In `profile.multer.ts`, change line 7:

```typescript
// was: limits: { fileSize: 5 * 1024 * 1024 }, // 5MB hard limit
limits: { fileSize: 2 * 1024 * 1024 }, // 2MB hard limit
```

- [ ] **Step 2: Run all profile tests**

```bash
npx jest profile --no-coverage 2>&1 | tail -10
```

Expected: all profile tests pass

- [ ] **Step 3: Commit**

```bash
git add src/domains/profile/profile.multer.ts
git commit -m "feat: set multer avatar fileSize limit to 2MB"
```

---

### Task 3: Client — size check before Cropper.js opens

**Files:**
- Modify: `src/views/partials/profile/avatar-display.njk` (add error element)
- Modify: `src/views/pages/profile/index.njk` (add size check in change handler)
- Modify: `src/views/pages/profile/index-admin.njk` (identical change)

No unit test for client-side JS — verified manually.

- [ ] **Step 1: Add the error element to the avatar-display partial**

In `avatar-display.njk`, add the error paragraph after the existing hint text line:

```html
    <p class="text-xs text-gray-400">{{ "jpg/ jpeg/ png only. Max 2MB" | t }}</p>
    <p id="avatar-size-error" class="hidden text-xs text-red-500">{{ "File too large. Max 2MB." | t }}</p>
```

The full `<div class="flex flex-col gap-1">` block after the change:

```nunjucks
  <div class="flex flex-col gap-1">
    <label for="avatar-file-input" class="cursor-pointer px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 text-gray-700 text-center">
      {{ "Upload photo" | t }}
    </label>
    <p class="text-xs text-gray-400">{{ "jpg/ jpeg/ png only. Max 2MB" | t }}</p>
    <p id="avatar-size-error" class="hidden text-xs text-red-500">{{ "File too large. Max 2MB." | t }}</p>
    {%- if hasAvatar %}
      <button
        hx-delete="/profile/avatar"
        hx-target="#avatar-display"
        hx-swap="outerHTML"
        hx-confirm="{{ 'Remove your profile photo?' | t }}"
        class="px-3 py-1.5 text-sm bg-white hover:bg-red-50 rounded border border-red-200 text-red-600"
      >
        {{ "Remove" | t }}
      </button>
    {%- endif %}
  </div>
```

- [ ] **Step 2: Add size check to `index.njk` change handler**

In `src/views/pages/profile/index.njk`, find the `change` event listener in the `{% block head %}` script and add the size check at the top, before `var reader = new FileReader()`:

```javascript
  document.getElementById('avatar-file-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    // Size check — fail fast before opening cropper
    var sizeErr = document.getElementById('avatar-size-error');
    if (file.size > 2 * 1024 * 1024) {
      if (sizeErr) sizeErr.classList.remove('hidden');
      this.value = '';
      return;
    }
    if (sizeErr) sizeErr.classList.add('hidden');

    var reader = new FileReader();
    // ... rest of handler unchanged
```

The full updated listener (replace the existing one in full):

```javascript
  document.getElementById('avatar-file-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var sizeErr = document.getElementById('avatar-size-error');
    if (file.size > 2 * 1024 * 1024) {
      if (sizeErr) sizeErr.classList.remove('hidden');
      this.value = '';
      return;
    }
    if (sizeErr) sizeErr.classList.add('hidden');

    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = document.getElementById('crop-preview');
      img.src = ev.target.result;
      document.getElementById('crop-modal').classList.remove('hidden');

      if (cropper) { cropper.destroy(); cropper = null; }
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    this.value = '';
  });
```

- [ ] **Step 3: Apply the identical change to `index-admin.njk`**

`src/views/pages/profile/index-admin.njk` has an identical `{% block head %}` script. Apply the same change — replace its `change` listener with the same updated version from Step 2.

- [ ] **Step 4: Run all tests**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass (the client-side change has no unit tests — it's pure template JS)

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/profile/avatar-display.njk src/views/pages/profile/index.njk src/views/pages/profile/index-admin.njk
git commit -m "feat: add client-side 2MB avatar size check before crop modal"
```
