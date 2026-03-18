# Admin Market Content Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate market content detail page with a slide-out sidebar on the list page, and remove market_content from the agent review queue where it does not belong.

**Architecture:** Two independent changes. First, surgically excise `market_content` from the agent review domain (types, repo, service, router, views, tests). Second, add an HTMX-powered slide-out panel to `/admin/content/market` using the same backdrop+panel+app.js pattern already established for the testimonial drawer and agent review panel.

**Tech Stack:** Nunjucks, HTMX, Tailwind CSS, TypeScript/Express, Jest

**Spec:** `docs/superpowers/specs/2026-03-18-admin-market-content-sidebar.md`

---

## Chunk 1: Remove market_content from agent review queue

### Task 1: Remove market_content from EntityType and related types

**Files:**
- Modify: `src/domains/review/review.types.ts`

- [ ] **Step 1: Remove `market_content` from `EntityType` union**

In `review.types.ts`, change:
```ts
export type EntityType =
  | 'financial_report'
  | 'listing_description'
  | 'listing_photos'
  | 'weekly_update'
  | 'market_content'
  | 'document_checklist';
```
to:
```ts
export type EntityType =
  | 'financial_report'
  | 'listing_description'
  | 'listing_photos'
  | 'weekly_update'
  | 'document_checklist';
```

- [ ] **Step 2: Remove `market_content` from `ENTITY_TYPES` array**

Change:
```ts
export const ENTITY_TYPES: EntityType[] = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'market_content',
  'document_checklist',
];
```
to:
```ts
export const ENTITY_TYPES: EntityType[] = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'document_checklist',
];
```

---

### Task 2: Clean up review.repository.ts

**Files:**
- Modify: `src/domains/review/review.repository.ts`

- [ ] **Step 1: Remove the `marketContentRecords` fetch from `getPendingQueue`**

Remove these lines from `getPendingQueue`:
```ts
// MarketContent has no sellerId/propertyId — global content queue
const marketContentRecords = agentId
  ? []
  : await prisma.marketContent.findMany({
      where: { status: 'pending_review' },
    });
```

- [ ] **Step 2: Remove the `marketContentRecords` spread from the items array**

Remove the entire block:
```ts
...marketContentRecords.map((m) => ({
  id: m.id,
  entityType: 'market_content' as EntityType,
  entityId: m.id,
  // MarketContent is not seller-specific; use empty strings for seller fields
  sellerId: '',
  sellerName: 'N/A',
  propertyAddress: buildMarketContentLabel(m.town, m.flatType, m.period),
  currentStatus: mapMcsToFrs(m.status),
  submittedAt: m.createdAt,
  priority: now - m.createdAt.getTime(),
})),
```

- [ ] **Step 3: Remove `market_content` from `countByType`**

Change:
```ts
const countByType: Record<EntityType, number> = {
  financial_report: financialReports.length,
  listing_description: listingDescs.length,
  listing_photos: listingPhotos.length,
  weekly_update: weeklyUpdates.length,
  market_content: marketContentRecords.length,
  document_checklist: docChecklists.length,
};
```
to:
```ts
const countByType: Record<EntityType, number> = {
  financial_report: financialReports.length,
  listing_description: listingDescs.length,
  listing_photos: listingPhotos.length,
  weekly_update: weeklyUpdates.length,
  document_checklist: docChecklists.length,
};
```

- [ ] **Step 4: Remove `market_content` case from `getDetailForReview`**

Remove:
```ts
case 'market_content':
  return prisma.marketContent.findUnique({
    where: { id: entityId },
  });
```
Also remove `prisma.marketContent.findUnique` from the return type union in the function signature.

**Important:** Leave the `default: entityType satisfies never;` arm intact — it is an exhaustive-check guard for the remaining entity types and must not be deleted.

- [ ] **Step 5: Remove `approveMarketContent` and `rejectMarketContent` functions**

Remove both functions entirely:
```ts
export async function approveMarketContent(entityId: string, agentId: string) { ... }
export async function rejectMarketContent(entityId: string, _agentId: string, _reviewNotes: string) { ... }
```

- [ ] **Step 6: Remove `mapMcsToFrs` and `buildMarketContentLabel` helper functions**

These are only used for market_content queue mapping. Remove both:
```ts
export function mapMcsToFrs(status: string): FinancialReportStatus { ... }
export function buildMarketContentLabel(town: string, _flatType: string, period: string): string { ... }
```

---

### Task 3: Clean up review.service.ts

**Files:**
- Modify: `src/domains/review/review.service.ts`

- [ ] **Step 1: Remove `market_content` from `AUDIT_ACTION`**

Change:
```ts
const AUDIT_ACTION: Record<EntityType, string> = {
  financial_report: 'financial_report.reviewed',
  listing_description: 'listing.reviewed',
  listing_photos: 'listing.reviewed',
  weekly_update: 'weekly_update.reviewed',
  market_content: 'market_content.reviewed',
  document_checklist: 'document_checklist.reviewed',
};
```
to:
```ts
const AUDIT_ACTION: Record<EntityType, string> = {
  financial_report: 'financial_report.reviewed',
  listing_description: 'listing.reviewed',
  listing_photos: 'listing.reviewed',
  weekly_update: 'weekly_update.reviewed',
  document_checklist: 'document_checklist.reviewed',
};
```

- [ ] **Step 2: Remove `market_content` case from `approveReview`**

Remove:
```ts
case 'market_content':
  await reviewRepo.approveMarketContent(entityId, agentId);
  break;
```

- [ ] **Step 3: Remove `market_content` case from `rejectReview`**

Remove:
```ts
case 'market_content':
  await reviewRepo.rejectMarketContent(entityId, agentId, reviewNotes);
  break;
```

---

### Task 3b: Remove market_content from review.validator.ts

**Files:**
- Modify: `src/domains/review/review.validator.ts`

- [ ] **Step 1: Remove `'market_content'` from `VALID_ENTITY_TYPES`**

Change:
```ts
const VALID_ENTITY_TYPES = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'market_content',
  'document_checklist',
];
```
to:
```ts
const VALID_ENTITY_TYPES = [
  'financial_report',
  'listing_description',
  'listing_photos',
  'weekly_update',
  'document_checklist',
];
```

---

### Task 4: Clean up review.router.ts

**Files:**
- Modify: `src/domains/review/review.router.ts`

- [ ] **Step 1: Remove `market_content` from `partialMap`**

Change:
```ts
const partialMap: Record<EntityType, string> = {
  financial_report: 'partials/agent/review-detail-financial',
  listing_description: 'partials/agent/review-detail-listing-desc',
  listing_photos: 'partials/agent/review-detail-listing-photos',
  weekly_update: 'partials/agent/review-detail-weekly-update',
  market_content: 'partials/agent/review-detail-market-content',
  document_checklist: 'partials/agent/review-detail-document-checklist',
};
```
to:
```ts
const partialMap: Record<EntityType, string> = {
  financial_report: 'partials/agent/review-detail-financial',
  listing_description: 'partials/agent/review-detail-listing-desc',
  listing_photos: 'partials/agent/review-detail-listing-photos',
  weekly_update: 'partials/agent/review-detail-weekly-update',
  document_checklist: 'partials/agent/review-detail-document-checklist',
};
```

---

### Task 5: Remove market_content tab from agent reviews page

**Files:**
- Modify: `src/views/pages/agent/reviews.njk`
- Delete: `src/views/partials/agent/review-detail-market-content.njk`

- [ ] **Step 1: Remove `market_content` tab entry from `reviews.njk`**

In the `tabs` array, remove:
```njk
{ key: 'market_content', label: 'Market Content', count: queue.countByType.market_content },
```

- [ ] **Step 2: Delete the review detail partial**

```bash
rm src/views/partials/agent/review-detail-market-content.njk
```

---

### Task 6: Update review tests

**Files:**
- Modify: `src/domains/review/__tests__/review.router.test.ts`
- Modify: `src/domains/review/__tests__/review.repository.test.ts`

- [ ] **Step 1: Remove `market_content: 0` from all `countByType` mock objects in `review.router.test.ts`**

There are two occurrences. Change each `countByType` mock from:
```ts
countByType: {
  financial_report: 0,
  listing_description: 0,
  listing_photos: 0,
  weekly_update: 0,
  market_content: 0,
  document_checklist: 0,
},
```
to:
```ts
countByType: {
  financial_report: 0,
  listing_description: 0,
  listing_photos: 0,
  weekly_update: 0,
  document_checklist: 0,
},
```

- [ ] **Step 2: Remove `mapMcsToFrs` and `buildMarketContentLabel` tests from `review.repository.test.ts`**

The file imports `mapMcsToFrs` and `buildMarketContentLabel` (lines 12, 14) and has `describe('mapMcsToFrs', ...)` (lines 20–40) and `describe('buildMarketContentLabel', ...)` (lines 52–65) blocks. Delete:
- Both imports from the `import { ... } from '../review.repository'` statement
- The entire `describe('mapMcsToFrs', ...)` block
- The entire `describe('buildMarketContentLabel', ...)` block

- [ ] **Step 3: Run tests and verify they pass**

```bash
npm test -- --testPathPattern=review
```
Expected: all review tests pass, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/domains/review/review.types.ts \
        src/domains/review/review.repository.ts \
        src/domains/review/review.service.ts \
        src/domains/review/review.router.ts \
        src/domains/review/review.validator.ts \
        src/domains/review/__tests__/review.router.test.ts \
        src/domains/review/__tests__/review.repository.test.ts \
        src/views/pages/agent/reviews.njk
git rm src/views/partials/agent/review-detail-market-content.njk
git commit -m "refactor: remove market_content from agent review queue"
```

---

## Chunk 2: Admin market content sidebar

### Task 7: Extract row partial

**Files:**
- Create: `src/views/partials/admin/market-content-row.njk`
- Modify: `src/views/partials/admin/market-content-list.njk`

The row partial is needed so approve/reject POST responses can re-render an individual row (in-place status badge update).

- [ ] **Step 1: Create `src/views/partials/admin/market-content-row.njk`**

```njk
<tr id="market-content-row-{{ record.id }}"
    class="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
    hx-get="/admin/content/market/{{ record.id }}/detail"
    hx-target="#market-content-detail-content"
    hx-swap="innerHTML">
  <td class="py-2 pr-4 font-mono text-sm">{{ record.period }}</td>
  <td class="py-2 pr-4">
    <span class="px-2 py-0.5 rounded text-xs font-medium {{ statusColors[record.status] }}">
      {{ record.status | replace('_', ' ') }}
    </span>
  </td>
  <td class="py-2 pr-4 text-gray-500 text-xs">{{ record.createdAt | date("D MMM YYYY") if record.createdAt }}</td>
</tr>
```

- [ ] **Step 2: Update `src/views/partials/admin/market-content-list.njk` to use the row partial and remove "View" column**

Replace the entire file content with:
```njk
{% set statusColors = {
  ai_generated: "bg-gray-100 text-gray-700",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  published: "bg-blue-100 text-blue-800"
} %}

{% if records | length == 0 %}
<p class="text-gray-500 text-sm">{{ "No market content records yet. Use 'Run Now' to generate the first one." | t }}</p>
{% else %}
<table class="w-full text-sm">
  <thead>
    <tr class="text-left text-gray-500 border-b">
      <th class="pb-2 pr-4">{{ "Period" | t }}</th>
      <th class="pb-2 pr-4">{{ "Status" | t }}</th>
      <th class="pb-2 pr-4">{{ "Created" | t }}</th>
    </tr>
  </thead>
  <tbody>
    {% for record in records %}
    {% include "partials/admin/market-content-row.njk" %}
    {% endfor %}
  </tbody>
</table>
<p class="mt-2 text-xs text-gray-500">{{ records | length }} {{ "records" | t }}</p>
{% endif %}
```

---

### Task 8: Create the detail panel partial

**Files:**
- Create: `src/views/partials/admin/market-content-detail-panel.njk`

This partial is loaded via HTMX GET into `#market-content-detail-content`. It renders the full record content and, for `pending_review` items, shows approve/reject forms that POST back and swap the row in-place.

- [ ] **Step 1: Create `src/views/partials/admin/market-content-detail-panel.njk`**

```njk
<div class="p-4 border-b border-gray-200">
  <div class="font-bold text-gray-900">{{ record.period }}</div>
  <div class="text-sm text-gray-500 mt-1">
    <span class="px-2 py-0.5 rounded text-xs font-medium {{ statusColors[record.status] }}">
      {{ record.status | replace('_', ' ') }}
    </span>
    <span class="ml-2">{{ record.createdAt | date("D MMM YYYY") if record.createdAt }}</span>
  </div>
</div>

<div class="flex-1 overflow-y-auto p-4 space-y-4">
  {% if record.aiNarrative %}
  <div>
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">{{ "Narrative" | t }}</h4>
    <p class="text-sm text-gray-700 bg-gray-50 rounded p-3">{{ record.aiNarrative }}</p>
  </div>
  {% endif %}

  {% if record.tiktokFormat %}
  <div>
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">
      {{ "TikTok" | t }} <span class="text-gray-400 font-normal normal-case">≤ 150 chars</span>
    </h4>
    <p class="text-sm text-gray-700 bg-gray-50 rounded p-3 font-mono whitespace-pre-wrap">{{ record.tiktokFormat }}</p>
  </div>
  {% endif %}

  {% if record.instagramFormat %}
  <div>
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">
      {{ "Instagram" | t }} <span class="text-gray-400 font-normal normal-case">≤ 300 chars</span>
    </h4>
    <p class="text-sm text-gray-700 bg-gray-50 rounded p-3 font-mono whitespace-pre-wrap">{{ record.instagramFormat }}</p>
  </div>
  {% endif %}

  {% if record.linkedinFormat %}
  <div>
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">
      {{ "LinkedIn" | t }} <span class="text-gray-400 font-normal normal-case">≤ 700 chars</span>
    </h4>
    <p class="text-sm text-gray-700 bg-gray-50 rounded p-3 font-mono whitespace-pre-wrap">{{ record.linkedinFormat }}</p>
  </div>
  {% endif %}

  <div>
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">{{ "Raw Aggregation Data" | t }}</h4>
    <pre class="text-xs bg-gray-50 rounded p-3 overflow-auto">{{ record.rawData | dump(2) }}</pre>
  </div>

  {% if record.approvedAt %}
  <p class="text-xs text-gray-400">
    {{ "Approved" | t }} {{ record.approvedAt | date("D MMM YYYY HH:mm") }}
  </p>
  {% endif %}
</div>

{% if record.status == 'pending_review' %}
<div class="p-4 border-t border-gray-200 space-y-3">
  <form hx-post="/admin/content/market/{{ record.id }}/approve"
        hx-target="#market-content-row-{{ record.id }}"
        hx-swap="outerHTML">
    <button type="submit"
      class="w-full bg-green-600 text-white py-2 rounded font-medium hover:bg-green-700">
      {{ "Approve" | t }}
    </button>
  </form>
  <form hx-post="/admin/content/market/{{ record.id }}/reject"
        hx-target="#market-content-row-{{ record.id }}"
        hx-swap="outerHTML">
    <textarea name="reviewNotes" rows="2"
      class="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none mb-2"
      placeholder="{{ 'Rejection notes (optional)...' | t }}"></textarea>
    <button type="submit"
      class="w-full bg-red-600 text-white py-2 rounded font-medium hover:bg-red-700">
      {{ "Reject" | t }}
    </button>
  </form>
</div>
{% endif %}
```

---

### Task 9: Add detail route and update approve/reject routes in admin.router.ts

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

The existing `GET /admin/content/market/:id` route (full detail page) will be replaced by `GET /admin/content/market/:id/detail` (panel partial). The approve/reject POST routes need to handle HTMX requests (return an updated row) in addition to their existing redirect behaviour.

- [ ] **Step 1: Replace the `GET /admin/content/market/:id` route with a `/detail` panel route**

Find the existing route:
```ts
adminRouter.get(
  '/admin/content/market/:id',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getMarketContentById(req.params['id'] as string);
      const user = req.user as AuthenticatedUser;
      const hasAvatar = await getHasAvatar(user.id);
      return res.render('pages/admin/market-content-detail', {
        pageTitle: 'Market Content',
        user,
        hasAvatar,
        record,
        currentPath: '/admin/content/market',
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

Replace it with:
```ts
// GET /admin/content/market/:id/detail — HTMX slide-out panel
adminRouter.get(
  '/admin/content/market/:id/detail',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await contentService.getMarketContentById(req.params['id'] as string);
      const statusColors: Record<string, string> = {
        ai_generated: 'bg-gray-100 text-gray-700',
        pending_review: 'bg-yellow-100 text-yellow-800',
        approved: 'bg-green-100 text-green-800',
        rejected: 'bg-red-100 text-red-700',
        published: 'bg-blue-100 text-blue-800',
      };
      return res.render('partials/admin/market-content-detail-panel', { record, statusColors });
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 2: Update the `POST /admin/content/market/:id/approve` route to handle HTMX**

Find:
```ts
adminRouter.post(
  '/admin/content/market/:id/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await contentService.approveMarketContent(req.params['id'] as string, user.id);
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);
```

Replace with:
```ts
adminRouter.post(
  '/admin/content/market/:id/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const id = req.params['id'] as string;
      await contentService.approveMarketContent(id, user.id);
      if (req.headers['hx-request']) {
        const record = await contentService.getMarketContentById(id);
        const statusColors: Record<string, string> = {
          ai_generated: 'bg-gray-100 text-gray-700',
          pending_review: 'bg-yellow-100 text-yellow-800',
          approved: 'bg-green-100 text-green-800',
          rejected: 'bg-red-100 text-red-700',
          published: 'bg-blue-100 text-blue-800',
        };
        return res.render('partials/admin/market-content-row', { record, statusColors });
      }
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 3: Update the `POST /admin/content/market/:id/reject` route to handle HTMX**

Find:
```ts
adminRouter.post(
  '/admin/content/market/:id/reject',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await contentService.rejectMarketContent(req.params['id'] as string);
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);
```

Replace with:
```ts
adminRouter.post(
  '/admin/content/market/:id/reject',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      await contentService.rejectMarketContent(id);
      if (req.headers['hx-request']) {
        const record = await contentService.getMarketContentById(id);
        const statusColors: Record<string, string> = {
          ai_generated: 'bg-gray-100 text-gray-700',
          pending_review: 'bg-yellow-100 text-yellow-800',
          approved: 'bg-green-100 text-green-800',
          rejected: 'bg-red-100 text-red-700',
          published: 'bg-blue-100 text-blue-800',
        };
        return res.render('partials/admin/market-content-row', { record, statusColors });
      }
      return res.redirect('/admin/content/market');
    } catch (err) {
      return next(err);
    }
  },
);
```

---

### Task 10: Add panel + backdrop to market-content.njk

**Files:**
- Modify: `src/views/pages/admin/market-content.njk`

- [ ] **Step 1: Add the panel and backdrop HTML**

Replace the entire file with:
```njk
{% extends "layouts/admin.njk" %}

{% block title %}{{ "Market Content" | t }} — Admin{% endblock %}

{% block content %}
{% set pageTitle = "Market Content" %}
{% set pageActionsHtml %}
<form method="POST" action="/admin/content/market/run">
  <button type="submit"
    class="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700">
    {{ "Run Now" | t }}
  </button>
</form>
{% endset %}
{% include "partials/shared/page-header.njk" %}

{% if error %}
<div class="bg-red-50 border border-red-200 rounded p-3 mb-4">
  <p class="text-red-700 text-sm">{{ error }}</p>
</div>
{% endif %}

<div id="market-content-list">
  {% include "partials/admin/market-content-list.njk" %}
</div>

{# Click-outside backdrop — closes panel when open #}
<div id="market-content-backdrop" class="hidden fixed inset-0 z-[39]" data-action="close-market-content-panel"></div>

{# Slide-out detail panel #}
<div id="market-content-panel"
     class="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl z-40 translate-x-full opacity-0 pointer-events-none transition-all duration-300 ease-out flex flex-col border-l-2 border-indigo-600"
     aria-hidden="true">
  <button data-action="close-market-content-panel"
          aria-label="{{ 'Close' | t }}"
          class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 p-1 rounded z-10">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
    </svg>
  </button>
  <div id="market-content-detail-content" class="flex flex-col h-full">{# Populated via HTMX on row click #}</div>
</div>
{% endblock %}
```

---

### Task 11: Add JS handlers to app.js

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add `close-market-content-panel` to the click delegation block**

After the `close-testimonial-drawer` block (around line 183), add:
```js
if (action === 'close-market-content-panel') {
  var mcPanel = document.getElementById('market-content-panel');
  var mcBackdrop = document.getElementById('market-content-backdrop');
  if (mcPanel) {
    mcPanel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
    mcPanel.setAttribute('aria-hidden', 'true');
  }
  if (mcBackdrop) mcBackdrop.classList.add('hidden');
}
```

- [ ] **Step 2: Add `htmx:afterRequest` handler for market content panel**

After the testimonial drawer `htmx:afterRequest` block (around line 338), add:
```js
// ── HTMX: market content panel show/hide ──────────────────────
document.addEventListener('htmx:afterRequest', function (e) {
  var panel = document.getElementById('market-content-panel');
  if (panel) {
    // Show panel when detail content loads into it
    if (e.detail.target && e.detail.target.id === 'market-content-detail-content' && e.detail.successful) {
      panel.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
      panel.removeAttribute('aria-hidden');
      var backdrop = document.getElementById('market-content-backdrop');
      if (backdrop) backdrop.classList.remove('hidden');
    }
    // Hide panel after approve/reject (form inside the panel fires the request)
    if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#market-content-panel') && e.detail.successful) {
      panel.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
      panel.setAttribute('aria-hidden', 'true');
      var backdrop2 = document.getElementById('market-content-backdrop');
      if (backdrop2) backdrop2.classList.add('hidden');
    }
  }
});
```

---

### Task 12: Delete the old detail page and its route

**Files:**
- Delete: `src/views/pages/admin/market-content-detail.njk`
- Modify: `src/domains/admin/admin.router.ts` (already done in Task 9 — the route was replaced)

- [ ] **Step 1: Delete the old detail page template**

```bash
git rm src/views/pages/admin/market-content-detail.njk
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```
Expected: exits 0 with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/admin/market-content.njk \
        src/views/partials/admin/market-content-list.njk \
        src/views/partials/admin/market-content-row.njk \
        src/views/partials/admin/market-content-detail-panel.njk \
        src/domains/admin/admin.router.ts \
        public/js/app.js
git rm src/views/pages/admin/market-content-detail.njk
git commit -m "feat: add slide-out sidebar to admin market content list"
```
