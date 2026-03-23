# Document Upload Per-Row Targeting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where uploading one document clears file selections in other document rows by targeting HTMX swaps to individual rows instead of the entire checklist.

**Architecture:** Extract `<li>` row into a reusable partial. Each form targets its own row ID. POST/DELETE routes render only the affected row. Event delegation replaces per-element listeners.

**Tech Stack:** Nunjucks templates, HTMX, Express router

**Design doc:** `docs/plans/2026-03-23-document-upload-row-targeting-design.md`

---

### Task 1: Create the row partial

**Files:**
- Create: `src/views/partials/seller/document-checklist-row.njk`

**Step 1: Create the row partial**

Create `src/views/partials/seller/document-checklist-row.njk` with the full `<li>` extracted from `document-checklist.njk`. Key changes from the original:
- The `<li>` gets `id="doc-row-{{ item.id }}"`
- The `docTypeMap` and `dbDocType` setup moves into this partial
- The upload form targets `#doc-row-{{ item.id }}` instead of `#document-checklist`
- The delete button also targets `#doc-row-{{ item.id }}`

```njk
{% set docTypeMap = {
  'nric': 'nric',
  'marriage-cert': 'marriage_cert',
  'eligibility-letter': 'eligibility_letter',
  'otp-scan': 'otp_scan',
  'estate-agency-agreement': 'eaa'
} %}
{% set dbDocType = docTypeMap[item.id] %}
<li class="p-4" id="doc-row-{{ item.id }}">
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-3">
      <div class="w-6 h-6 rounded flex items-center justify-center
        {% if item.status == 'received_by_agent' %}bg-green-100 text-green-600
        {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-600
        {% else %}bg-gray-100 text-gray-400{% endif %}">
        {% if item.status == 'received_by_agent' %}&#10003;
        {% elif item.status == 'uploaded' %}&uarr;
        {% else %}&middot;{% endif %}
      </div>
      <div>
        <p class="text-sm font-medium text-gray-900">
          {{ item.label | t }}
          {% if item.required %}<span class="text-red-500">*</span>{% endif %}
        </p>
        <p class="text-xs text-gray-500">{{ item.description | t }}</p>
      </div>
    </div>
    <span class="text-xs font-medium px-2 py-1 rounded
      {% if item.status == 'received_by_agent' %}bg-green-100 text-green-700
      {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-700
      {% else %}bg-gray-100 text-gray-500{% endif %}">
      {% if item.status == 'received_by_agent' %}{{ "Received by Agent" | t }}
      {% elif item.status == 'uploaded' %}{{ "Uploaded" | t }}
      {% else %}{{ "Not Uploaded" | t }}{% endif %}
    </span>
  </div>

  {# Show uploaded files for this item #}
  {% if activeDocuments %}
    {% for doc in activeDocuments %}
      {% if doc.docType == dbDocType %}
      <div class="ml-9 mb-1 flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
        <span>{{ doc.mimeType }} &middot; {{ (doc.sizeBytes / 1024) | round }}KB &middot; {{ doc.uploadedAt | date }}</span>
        <button
          hx-delete="/seller/documents/{{ doc.id }}"
          hx-target="#doc-row-{{ item.id }}"
          hx-swap="outerHTML"
          hx-confirm="{{ 'Are you sure you want to remove this file?' | t }}"
          class="text-red-500 hover:text-red-700 text-xs font-medium">
          {{ "Remove" | t }}
        </button>
      </div>
      {% endif %}
    {% endfor %}
  {% endif %}

  {# Upload area — always show so seller can re-upload after agent receives #}
  <div class="ml-9 mt-2">
    <form hx-post="/seller/documents"
          hx-target="#doc-row-{{ item.id }}"
          hx-swap="outerHTML"
          hx-encoding="multipart/form-data"
          class="flex items-center gap-2">
      <input type="hidden" name="docType" value="{{ dbDocType }}">
      <input type="file"
             name="file"
             accept="image/jpeg,image/png,application/pdf"
             required
             data-doc-file-input
             class="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
      <button type="submit"
              disabled
              class="text-xs font-medium px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {{ "Upload" | t }}
      </button>
    </form>
  </div>
</li>
```

**Step 2: Verify the file was created**

Run: `ls -la src/views/partials/seller/document-checklist-row.njk`
Expected: File exists

---

### Task 2: Refactor document-checklist.njk to use the row partial

**Files:**
- Modify: `src/views/partials/seller/document-checklist.njk`

**Step 1: Replace the inline `<li>` loop body with an include**

Replace the entire `document-checklist.njk` with:

```njk
{% if checklist.length == 0 %}
<div class="p-6 text-center text-gray-500">
  {{ "No documents required at this stage" | t }}
</div>
{% else %}
<ul class="divide-y divide-gray-200" id="document-checklist">
  {% for item in checklist %}
  {% include "partials/seller/document-checklist-row.njk" %}
  {% endfor %}
</ul>
<script nonce="{{ cspNonce }}">
(function() {
  var list = document.getElementById('document-checklist');
  if (!list) return;
  list.addEventListener('change', function(e) {
    if (!e.target.hasAttribute('data-doc-file-input')) return;
    var btn = e.target.closest('form').querySelector('[type=submit]');
    if (e.target.files.length) { btn.removeAttribute('disabled'); } else { btn.setAttribute('disabled', ''); }
  });
})();
</script>
{% endif %}
```

Key changes:
- The `<li>` body is replaced by `{% include "partials/seller/document-checklist-row.njk" %}` — Nunjucks `include` inherits the loop variable `item` and the outer `activeDocuments`
- The `<script>` uses event delegation on `#document-checklist` instead of `querySelectorAll`. This means newly swapped-in rows automatically work without re-running any setup script.

**Step 2: Verify template renders**

Run: `npm run build`
Expected: No template compilation errors

---

### Task 3: Update POST route to render single row

**Files:**
- Modify: `src/domains/seller/seller.router.ts:425-468`

**Step 1: Update the POST handler response**

In the POST `/seller/documents` handler (line ~456-463), after the upload succeeds, instead of rendering the full checklist, find just the uploaded item's checklist entry and render the row partial:

Replace lines 456-463 (the block after `await sellerDocService.uploadSellerDocument(...)`) with:

```typescript
      const overview = await sellerService.getDashboardOverview(user.id);
      const checklist = await sellerDocService.getDocumentChecklistWithStatus(
        user.id,
        overview.propertyStatus,
      );
      const activeDocuments = await sellerDocService.getActiveDocumentsForSeller(user.id);

      // Find the specific checklist item that was uploaded
      const docType = req.body.docType as string;
      const { DOC_TYPE_TO_CHECKLIST_ID } = await import('./seller-document.service');
      const checklistId = DOC_TYPE_TO_CHECKLIST_ID[docType];
      const item = checklist.find((c) => c.id === checklistId);

      if (item) {
        res.render('partials/seller/document-checklist-row', { item, activeDocuments });
      } else {
        // Fallback: re-render full checklist (shouldn't happen)
        res.render('partials/seller/document-checklist', { checklist, activeDocuments });
      }
```

**Step 2: Export DOC_TYPE_TO_CHECKLIST_ID from seller-document.service.ts**

In `src/domains/seller/seller-document.service.ts`, line ~196, change:

```typescript
const DOC_TYPE_TO_CHECKLIST_ID: Record<string, string> = {
```

to:

```typescript
export const DOC_TYPE_TO_CHECKLIST_ID: Record<string, string> = {
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No TypeScript errors

---

### Task 4: Update DELETE route to render single row

**Files:**
- Modify: `src/domains/seller/seller.router.ts:470-490`

**Step 1: Update the DELETE handler response**

In the DELETE `/seller/documents/:documentId` handler, we need to know which docType was deleted to find the right checklist item. The service already deletes the doc, so we need to look up the docType before deletion, or find it from the remaining checklist + active docs.

Approach: look up the document before deleting to capture its docType. Modify the handler:

```typescript
sellerRouter.delete(
  '/seller/documents/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      // Look up document before deleting to know the docType
      const doc = await sellerDocService.getSellerDocumentById(
        req.params['documentId'] as string,
        user.id,
      );
      const deletedDocType = doc?.docType;

      await sellerDocService.deleteSellerDocumentBySeller(req.params['documentId'] as string, user.id);

      const overview = await sellerService.getDashboardOverview(user.id);
      const checklist = await sellerDocService.getDocumentChecklistWithStatus(
        user.id,
        overview.propertyStatus,
      );
      const activeDocuments = await sellerDocService.getActiveDocumentsForSeller(user.id);

      // Render single row if we know which doc type was deleted
      if (deletedDocType) {
        const { DOC_TYPE_TO_CHECKLIST_ID } = await import('./seller-document.service');
        const checklistId = DOC_TYPE_TO_CHECKLIST_ID[deletedDocType];
        const item = checklist.find((c) => c.id === checklistId);
        if (item) {
          return res.render('partials/seller/document-checklist-row', { item, activeDocuments });
        }
      }

      // Fallback: full checklist
      res.render('partials/seller/document-checklist', { checklist, activeDocuments });
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 2: Add `getSellerDocumentById` to seller-document.service.ts (if not exists)**

Check if this function already exists. If not, add:

```typescript
export async function getSellerDocumentById(
  documentId: string,
  sellerId: string,
): Promise<SellerDocument | null> {
  return sellerDocRepo.findByIdAndSeller(documentId, sellerId);
}
```

And in `seller-document.repository.ts`, add `findByIdAndSeller` if it doesn't exist:

```typescript
export async function findByIdAndSeller(
  documentId: string,
  sellerId: string,
): Promise<SellerDocument | null> {
  return prisma.sellerDocument.findFirst({
    where: { id: documentId, sellerId, deletedAt: null },
  });
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No TypeScript errors

---

### Task 5: Verify and commit

**Step 1: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run integration tests**

Run: `npm run test:integration`
Expected: All tests pass

**Step 3: Manual smoke test**

Run: `npm run dev`

1. Go to `/seller/documents`
2. Select a file for NRIC (don't upload)
3. Select a file for Marriage Certificate (don't upload)
4. Click Upload on NRIC row
5. Verify: NRIC uploads successfully, Marriage Certificate file selection is preserved
6. Click Upload on Marriage Certificate row
7. Verify: Marriage Certificate uploads successfully

**Step 4: Commit**

```bash
git add src/views/partials/seller/document-checklist.njk src/views/partials/seller/document-checklist-row.njk src/domains/seller/seller.router.ts src/domains/seller/seller-document.service.ts src/domains/seller/seller-document.repository.ts
git commit -m "fix(documents): target HTMX swap to individual rows to preserve file selections

Extract document row into reusable partial with per-row hx-target.
POST/DELETE routes render only the affected row instead of the full
checklist. Event delegation replaces per-element listeners."
```
