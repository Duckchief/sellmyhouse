# Admin Seller Detail Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/admin/sellers/:id` into a 2-column layout and add Transaction Timeline + Notifications sections loaded inline on page load.

**Architecture:** Add `milestones` and `notifications` to `AdminSellerDetail` by fetching them in `getAdminSellerDetail` via `getTimelineMilestones` (seller.service, pure fn) and `agentService.getNotificationHistory` (no agentId = admin sees all). The njk template is restructured into a 2-col grid with full-width bottom sections that include the existing agent partials.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, Tailwind CSS

---

## Chunk 1: Data Layer

### Task 1: Add `status` to property select in admin repo

The timeline needs property status to determine which milestone is current. Currently `findSellerDetailForAdmin` does not select it.

**Files:**
- Modify: `src/domains/admin/admin.repository.ts:430-438`

- [ ] **Step 1: Add `status: true` to properties select**

In `findSellerDetailForAdmin`, change the properties select from:
```typescript
select: {
  block: true,
  street: true,
  town: true,
  flatType: true,
  floorAreaSqm: true,
  storeyRange: true,
  askingPrice: true,
},
```
to:
```typescript
select: {
  block: true,
  street: true,
  town: true,
  flatType: true,
  floorAreaSqm: true,
  storeyRange: true,
  askingPrice: true,
  status: true,
},
```

- [ ] **Step 2: Run existing tests to confirm no breakage**

```bash
npm test -- --testPathPattern="admin.service"
```
Expected: all existing tests pass (the new `status` field is just additional data on the mock object, doesn't affect existing assertions).

---

### Task 2: Update `AdminSellerDetail` type

**Files:**
- Modify: `src/domains/admin/admin.types.ts:153-205`

- [ ] **Step 1: Add imports reference comment and new fields**

At the top of `admin.types.ts`, add imports for the two types (these are type-only, no runtime cost):

```typescript
import type { TimelineMilestone } from '@/domains/seller/seller.types';
import type { NotificationHistoryItem } from '@/domains/agent/agent.types';
```

- [ ] **Step 2: Add fields to `AdminSellerDetail`**

Add after the `auditLog` field:
```typescript
  milestones: TimelineMilestone[];
  notifications: NotificationHistoryItem[];
```

The full updated interface tail becomes:
```typescript
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    details: unknown;
    createdAt: Date;
  }>;
  milestones: TimelineMilestone[];
  notifications: NotificationHistoryItem[];
}
```

- [ ] **Step 3: Run TypeScript to verify types compile**

```bash
npm run build 2>&1 | head -30
```
Expected: TypeScript errors about `admin.service.ts` not yet returning `milestones`/`notifications` — that's expected. We fix it in the next task.

---

### Task 3: Update `getAdminSellerDetail` in admin.service

**Files:**
- Modify: `src/domains/admin/admin.service.ts:1-28` (imports)
- Modify: `src/domains/admin/admin.service.ts:538-597` (getAdminSellerDetail function)

- [ ] **Step 1: Add new imports**

After the existing imports block (after line 27), add:
```typescript
import { getTimelineMilestones } from '@/domains/seller/seller.service';
import * as agentService from '@/domains/agent/agent.service';
```

- [ ] **Step 2: Update `getAdminSellerDetail` to fetch notifications**

Change the `Promise.all` call in `getAdminSellerDetail`. Currently:
```typescript
const [cdd, auditLog] = await Promise.all([
  complianceService.findLatestSellerCddRecord(id),
  auditRepo.findByEntity('seller', id),
]);
```

Replace with:
```typescript
const [cdd, auditLog, notifications] = await Promise.all([
  complianceService.findLatestSellerCddRecord(id),
  auditRepo.findByEntity('seller', id),
  agentService.getNotificationHistory(id),
]);
```

- [ ] **Step 3: Build the milestones and add both to the return object**

`getTimelineMilestones` is a pure synchronous function. The function already declares `property` and `transaction` from `raw` at lines 547–548 — **do not re-declare them**. Just insert the `milestones` call immediately after those existing declarations:

```typescript
// These lines already exist — do not add them again:
// const property = raw.properties[0] ?? null;
// const transaction = raw.transactions[0] ?? null;

// Add this line after the existing declarations:
const milestones = getTimelineMilestones(
  property?.status ?? null,
  transaction?.status ?? null,
);
```

Add `milestones` and `notifications` to the return object (after `auditLog`):
```typescript
  auditLog: auditLog.slice(0, 20),
  milestones,
  notifications,
```

- [ ] **Step 4: Run TypeScript build to confirm no type errors**

```bash
npm run build 2>&1 | head -30
```
Expected: clean compile (no errors related to `AdminSellerDetail`).

---

### Task 4: Update service unit tests

The existing `getAdminSellerDetail` tests need the new mock for `agentService` and the new assertions. The existing three tests (`throws NotFoundError`, `returns full detail`, `returns null when no property/agent/transaction`, `caps audit log`) all need `agentService.getNotificationHistory` mocked or they'll call the real function and fail.

**Files:**
- Modify: `src/domains/admin/__tests__/admin.service.test.ts`

- [ ] **Step 1: Add `agentService` mock at the top of the file**

Add to the `jest.mock(...)` block (before the imports):
```typescript
jest.mock('@/domains/agent/agent.service');
```

Add to the imports block (after existing imports):
```typescript
import * as agentService from '@/domains/agent/agent.service';
```

Add to the mock variable declarations:
```typescript
const mockAgentService = agentService as jest.Mocked<typeof agentService>;
```

- [ ] **Step 2: Add baseline `getNotificationHistory` mock in a describe-scoped `beforeEach`**

The file has a top-level `beforeEach` at lines 34–37 that resets all mocks. Add a **separate `beforeEach` inside the `getAdminSellerDetail` describe block** (at the top of that block, before the `baseSeller` constant) so it only applies to this describe group:

```typescript
describe('getAdminSellerDetail', () => {
  beforeEach(() => {
    mockAgentService.getNotificationHistory.mockResolvedValue([]);
  });

  const baseSeller = { ... }; // existing
```

- [ ] **Step 3: Update `'returns full detail when seller exists'` test**

Add a `baseNotification` constant alongside `baseSeller`, `baseCdd`, `baseAudit`:
```typescript
const baseNotification = [
  {
    id: 'notif-1',
    channel: 'whatsapp',
    templateName: 'welcome',
    content: 'Hello',
    status: 'delivered',
    sentAt: new Date('2026-02-01'),
    deliveredAt: new Date('2026-02-01'),
    createdAt: new Date('2026-02-01'),
  },
];
```

In the `'returns full detail when seller exists'` test, before calling `getAdminSellerDetail`, add:
```typescript
mockAgentService.getNotificationHistory.mockResolvedValue(baseNotification as never);
```

Add assertions after the existing ones:
```typescript
expect(result.milestones.length).toBeGreaterThan(0);
expect(result.notifications).toHaveLength(1);
expect(result.notifications[0].channel).toBe('whatsapp');
```

- [ ] **Step 4: Update baseSeller mock to include property status**

In `baseSeller.properties[0]`, add `status: 'listed'`:
```typescript
properties: [
  {
    block: '123',
    street: 'Tampines Ave 1',
    town: 'TAMPINES',
    flatType: '4 ROOM',
    floorAreaSqm: 90,
    storeyRange: '10 TO 12',
    askingPrice: { toNumber: () => 500000 },
    status: 'listed',
  },
],
```

- [ ] **Step 5: Run the service tests**

```bash
npm test -- --testPathPattern="admin.service"
```
Expected: all tests pass (4 tests in `getAdminSellerDetail` describe block).

- [ ] **Step 6: Commit the data layer changes**

```bash
git add src/domains/admin/admin.types.ts \
        src/domains/admin/admin.service.ts \
        src/domains/admin/admin.repository.ts \
        src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat: add milestones and notifications to admin seller detail data"
```

---

## Chunk 2: Template

### Task 5: Restructure `admin/seller-detail.njk`

Rewrite the template to use a 2-column grid for the 6 cards, then add full-width Timeline and Notifications sections below by including the existing agent partials.

**Files:**
- Modify: `src/views/pages/admin/seller-detail.njk`

- [ ] **Step 1: Replace the template content**

Replace the entire file content with:

```nunjucks
{% extends "layouts/admin.njk" %}

{% block content %}
<div class="mb-4">
  <a href="/admin/sellers" class="text-sm text-accent hover:underline">← {{ "Back to Sellers" | t }}</a>
</div>

{# ── Header ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
  <div class="flex items-center gap-4">
    <h1 class="text-2xl font-bold">{{ detail.seller.name }}</h1>
    <span class="px-2 py-0.5 text-xs rounded-full
      {% if detail.seller.status == 'lead' %}bg-blue-100 text-blue-800
      {% elif detail.seller.status == 'engaged' %}bg-yellow-100 text-yellow-800
      {% elif detail.seller.status == 'active' %}bg-green-100 text-green-800
      {% elif detail.seller.status == 'completed' %}bg-gray-100 text-gray-800
      {% elif detail.seller.status == 'archived' %}bg-red-100 text-red-800
      {% endif %}">{{ detail.seller.status | t }}</span>
  </div>
</div>

{# ── 2-column card grid ── #}
<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

  {# Left: Seller Info #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Seller Information" | t }}</h2>
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Phone" | t }}</dt>
        <dd>{{ detail.seller.phone }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Email" | t }}</dt>
        <dd>{{ detail.seller.email or '—' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Notification Preference" | t }}</dt>
        <dd>{{ detail.seller.notificationPreference }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Created" | t }}</dt>
        <dd>{{ detail.seller.createdAt | date }}</dd>
      </div>
    </dl>
  </div>

  {# Right: Property #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Property" | t }}</h2>
    {% if detail.property %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Address" | t }}</dt>
        <dd>{{ detail.property.block }} {{ detail.property.street }}, {{ detail.property.town }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Flat Type" | t }}</dt>
        <dd>{{ detail.property.flatType }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Floor Area" | t }}</dt>
        <dd>{{ detail.property.floorAreaSqm }} sqm</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Storey" | t }}</dt>
        <dd>{{ detail.property.storeyRange }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Asking Price" | t }}</dt>
        <dd>{% if detail.property.askingPrice %}${{ detail.property.askingPrice | formatPrice }}{% else %}—{% endif %}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No property on file." | t }}</p>
    {% endif %}
  </div>

  {# Left: Assigned Agent #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Assigned Agent" | t }}</h2>
    {% if detail.agent %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Name" | t }}</dt>
        <dd>{{ detail.agent.name }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "CEA Reg No" | t }}</dt>
        <dd>{{ detail.agent.ceaRegNo }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Phone" | t }}</dt>
        <dd>{{ detail.agent.phone or '—' }}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-sm">
      <span class="text-amber-600 font-medium">{{ "Unassigned" | t }}</span>
      — <a href="/admin/sellers" class="text-accent hover:underline">{{ "Go to sellers list to assign" | t }}</a>
    </p>
    {% endif %}
  </div>

  {# Right: Transaction #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Transaction" | t }}</h2>
    {% if detail.transaction %}
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Status" | t }}</dt>
        <dd>{{ detail.transaction.status }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Agreed Price" | t }}</dt>
        <dd>${{ detail.transaction.agreedPrice | formatPrice }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "HDB Application" | t }}</dt>
        <dd>{{ detail.transaction.hdbApplicationStatus }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "OTP Status" | t }}</dt>
        <dd>{{ detail.transaction.otpStatus or '—' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Started" | t }}</dt>
        <dd>{{ detail.transaction.createdAt | date }}</dd>
      </div>
    </dl>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No transaction yet." | t }}</p>
    {% endif %}
  </div>

  {# Left: Compliance #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Compliance" | t }}</h2>
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "CDD Record" | t }}</dt>
        <dd>
          {% if detail.compliance.cdd %}
            <span class="{% if detail.compliance.cdd.identityVerified %}text-green-700{% else %}text-amber-600{% endif %} font-medium">
              {% if detail.compliance.cdd.identityVerified %}{{ "Verified" | t }}{% else %}{{ "Pending" | t }}{% endif %}
            </span>
            <span class="text-gray-500">({{ detail.compliance.cdd.riskLevel }})</span>
          {% else %}
            <span class="text-gray-400">{{ "None on file" | t }}</span>
          {% endif %}
        </dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Consent Records" | t }}</dt>
        <dd>{{ detail.compliance.consentCount }}</dd>
      </div>
      <div>
        <dt class="text-gray-500 text-xs uppercase mb-1">{{ "Consent Withdrawal" | t }}</dt>
        <dd>
          {% if detail.compliance.hasWithdrawal %}
            <span class="text-red-600 font-medium">{{ "Yes" | t }}</span>
          {% else %}
            {{ "No" | t }}
          {% endif %}
        </dd>
      </div>
    </dl>
  </div>

  {# Right: Status History (audit log) #}
  <div class="bg-white rounded-lg shadow p-6">
    <h2 class="text-lg font-semibold mb-4">{{ "Status History" | t }}</h2>
    {% if detail.auditLog.length > 0 %}
    <ol class="relative border-l border-gray-200 ml-3 space-y-4">
      {% for entry in detail.auditLog %}
      <li class="ml-4">
        <div class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gray-300"></div>
        <time class="text-xs text-gray-400">{{ entry.createdAt | date }}</time>
        <p class="text-sm font-medium text-gray-800">{{ entry.action }}</p>
      </li>
      {% endfor %}
    </ol>
    {% else %}
    <p class="text-gray-400 text-sm">{{ "No audit history." | t }}</p>
    {% endif %}
  </div>

</div>

{# ── Transaction Timeline (full-width) ── #}
{# seller-timeline.njk renders its own <h3> heading and card shadow #}
{% set milestones = detail.milestones %}
{% include "partials/agent/seller-timeline.njk" %}

{# ── Notifications (full-width) ── #}
{# seller-notifications.njk renders its own bg-white rounded-lg shadow card.
   Only add a heading above it; do not double-wrap with another card div. #}
<div class="mt-6">
  <h2 class="text-lg font-semibold mb-4">{{ "Notifications" | t }}</h2>
  {% set notifications = detail.notifications %}
  {% include "partials/agent/seller-notifications.njk" %}
</div>

{% endblock %}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```
Expected: all tests pass (template changes have no unit tests — verified visually).

- [ ] **Step 3: Smoke-test in browser**

```bash
npm run dev
```
Navigate to `/admin/sellers/:id` for a seller with a property and transaction. Verify:
- 2-column layout renders correctly
- Transaction Timeline appears below the grid
- Notifications table appears below the timeline (or "No notifications sent" if none)
- Mobile: columns stack to single column

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/admin/seller-detail.njk
git commit -m "feat: restructure admin seller detail to 2-col layout with timeline and notifications"
```
