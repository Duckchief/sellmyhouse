# Admin Seller Detail Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable seller name links in /admin/pipeline, /admin/leads, and /admin/sellers list views that navigate to a new read-only /admin/sellers/:id detail page showing seller info, property, agent, transaction, compliance, and audit history.

**Architecture:** Plain `<a>` tags on name cells in three list partials link to `GET /admin/sellers/:id`. A new `getAdminSellerDetail` service method fetches seller+relations via a new admin repository function, CDD record via the existing `complianceService.findLatestSellerCddRecord` (cross-domain service call, per CLAUDE.md), and audit history via `auditRepo.findByEntity`. The detail page is a single scrolling server-rendered full page using the existing admin layout — no HTMX partials needed.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, Tailwind CSS

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/domains/admin/admin.types.ts` | Add `AdminSellerDetail` interface |
| Modify | `src/domains/admin/admin.repository.ts` | Add `findSellerDetailForAdmin` |
| Modify | `src/domains/admin/admin.service.ts` | Add `getAdminSellerDetail` |
| Modify | `src/domains/admin/admin.router.ts` | Add `GET /admin/sellers/:id` route |
| Create | `src/views/pages/admin/seller-detail.njk` | Detail page template |
| Modify | `src/views/partials/admin/pipeline-table.njk` | Name → link, remove Actions column |
| Modify | `src/views/partials/admin/lead-list.njk` | Name → link |
| Modify | `src/views/partials/admin/seller-list.njk` | Name → link |
| Modify | `src/domains/admin/__tests__/admin.service.test.ts` | Tests for `getAdminSellerDetail` |

---

## Chunk 1: Types, Repository, and Service

### Task 1: Add `AdminSellerDetail` type

**Files:**
- Modify: `src/domains/admin/admin.types.ts`

- [ ] **Step 1: Append the new interface**

Add to the end of `src/domains/admin/admin.types.ts`:

```typescript
export interface AdminSellerDetail {
  seller: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    status: string;
    notificationPreference: string;
    createdAt: Date;
  };
  property: {
    block: string;
    street: string;
    town: string;
    flatType: string;
    floorAreaSqm: number;
    storeyRange: string;
    askingPrice: number | null;
  } | null;
  agent: {
    id: string;
    name: string;
    ceaRegNo: string;
    phone: string | null;
  } | null;
  transaction: {
    id: string;
    status: string;
    offerId: string | null;
    agreedPrice: number;
    hdbApplicationStatus: string;
    otpStatus: string | null;
    createdAt: Date;
  } | null;
  compliance: {
    cdd: {
      riskLevel: string;
      identityVerified: boolean;
      verifiedAt: Date | null;
      createdAt: Date;
    } | null;
    consentCount: number;
    hasWithdrawal: boolean;
  };
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    details: unknown;
    createdAt: Date;
  }>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: exits 0, no errors related to admin.types.ts

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.types.ts
git commit -m "feat: add AdminSellerDetail type"
```

---

### Task 2: Add repository function

**Files:**
- Modify: `src/domains/admin/admin.repository.ts`

Note: The file is 419 lines. Look at the top to confirm the prisma import: `import { prisma } from '@/infra/database/prisma'`. Add the function at the end of the file.

**CDD data is NOT fetched here.** Per CLAUDE.md cross-domain rules ("import services, never repositories"), the CDD record is fetched in the service via `complianceService.findLatestSellerCddRecord`. Only the seller's own data (seller, property, agent, transactions, consentRecords) is fetched here.

- [ ] **Step 1: Add `findSellerDetailForAdmin`**

Append to end of `src/domains/admin/admin.repository.ts`:

```typescript
export async function findSellerDetailForAdmin(id: string) {
  return prisma.seller.findUnique({
    where: { id },
    include: {
      agent: {
        select: { id: true, name: true, ceaRegNo: true, phone: true },
      },
      properties: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          block: true,
          street: true,
          town: true,
          flatType: true,
          floorAreaSqm: true,
          storeyRange: true,
          askingPrice: true,
        },
      },
      transactions: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          offerId: true,
          agreedPrice: true,
          hdbApplicationStatus: true,
          otp: { select: { status: true } },
          createdAt: true,
        },
      },
      consentRecords: {
        select: { id: true, consentWithdrawnAt: true, createdAt: true },
      },
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add src/domains/admin/admin.repository.ts
git commit -m "feat: add findSellerDetailForAdmin to admin repo"
```

---

### Task 3: Write failing service tests

**Files:**
- Modify: `src/domains/admin/__tests__/admin.service.test.ts`

The test file already mocks `'../admin.repository'` and `'@/domains/shared/audit.repository'`. You need to add a mock for `complianceService` as well, because `getAdminSellerDetail` calls it cross-domain.

**Step 1a: Add compliance service mock to the existing mock setup block** (the top of the test file, before any imports of the real modules). Insert these two lines alongside the other `jest.mock(...)` calls:

```typescript
jest.mock('@/domains/compliance/compliance.service');
```

And alongside the other `import *` lines:

```typescript
import * as complianceService from '@/domains/compliance/compliance.service';
```

And alongside the other `const mock...` variable declarations:

```typescript
const mockComplianceService = complianceService as jest.Mocked<typeof complianceService>;
```

Also add `import { NotFoundError } from '@/domains/shared/errors';` as a static import at the top of the file (after the other imports) if it is not already there.

- [ ] **Step 1b: Append the test block**

Add to the end of `src/domains/admin/__tests__/admin.service.test.ts`:

```typescript
// ─── getAdminSellerDetail ────────────────────────────────────

describe('getAdminSellerDetail', () => {
  const baseSeller = {
    id: 'seller-1',
    name: 'Alice Tan',
    email: 'alice@example.com',
    phone: '91234567',
    status: 'lead',
    notificationPreference: 'whatsapp_and_email',
    createdAt: new Date('2026-01-01'),
    agent: { id: 'agent-1', name: 'Bob Agent', ceaRegNo: 'R12345', phone: '98765432' },
    properties: [
      {
        block: '123',
        street: 'Tampines Ave 1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
        floorAreaSqm: 90,
        storeyRange: '10 TO 12',
        askingPrice: { toNumber: () => 500000 },
      },
    ],
    transactions: [
      {
        id: 'txn-1',
        status: 'option_issued',
        offerId: 'offer-1',
        agreedPrice: { toNumber: () => 498000 },
        hdbApplicationStatus: 'not_started',
        otp: { status: 'prepared' },
        createdAt: new Date('2026-02-01'),
      },
    ],
    consentRecords: [
      { id: 'cr-1', consentWithdrawnAt: null, createdAt: new Date() },
      { id: 'cr-2', consentWithdrawnAt: new Date(), createdAt: new Date() },
    ],
  };

  const baseCdd = {
    id: 'cdd-1',
    riskLevel: 'standard',
    identityVerified: true,
    verifiedAt: new Date('2026-01-15'),
    createdAt: new Date('2026-01-15'),
  };

  const baseAudit = [
    {
      id: 'log-1',
      action: 'seller.created',
      entityType: 'seller',
      entityId: 'seller-1',
      details: {},
      createdAt: new Date(),
    },
  ];

  it('throws NotFoundError when seller not found', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(null);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
    mockAuditRepo.findByEntity.mockResolvedValue([] as never);

    await expect(adminService.getAdminSellerDetail('unknown-id')).rejects.toThrow(NotFoundError);
  });

  it('returns full detail when seller exists', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(baseSeller as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(baseCdd as never);
    mockAuditRepo.findByEntity.mockResolvedValue(baseAudit as never);

    const result = await adminService.getAdminSellerDetail('seller-1');

    expect(result.seller.name).toBe('Alice Tan');
    expect(result.seller.status).toBe('lead');
    expect(result.property?.town).toBe('TAMPINES');
    expect(result.property?.askingPrice).toBe(500000);
    expect(result.agent?.ceaRegNo).toBe('R12345');
    expect(result.transaction?.status).toBe('option_issued');
    expect(result.transaction?.offerId).toBe('offer-1');
    expect(result.transaction?.agreedPrice).toBe(498000);
    expect(result.transaction?.otpStatus).toBe('prepared');
    expect(result.compliance.cdd?.riskLevel).toBe('standard');
    expect(result.compliance.cdd?.identityVerified).toBe(true);
    expect(result.compliance.consentCount).toBe(2);
    expect(result.compliance.hasWithdrawal).toBe(true);
    expect(result.auditLog).toHaveLength(1);
    expect(result.auditLog[0].action).toBe('seller.created');
  });

  it('returns null property, agent and transaction when seller has none', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue({
      ...baseSeller,
      agent: null,
      properties: [],
      transactions: [],
      consentRecords: [],
    } as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
    mockAuditRepo.findByEntity.mockResolvedValue([] as never);

    const result = await adminService.getAdminSellerDetail('seller-2');
    expect(result.property).toBeNull();
    expect(result.transaction).toBeNull();
    expect(result.agent).toBeNull();
    expect(result.compliance.cdd).toBeNull();
    expect(result.compliance.consentCount).toBe(0);
    expect(result.compliance.hasWithdrawal).toBe(false);
    expect(result.auditLog).toHaveLength(0);
  });

  it('caps audit log at 20 entries', async () => {
    const manyLogs = Array.from({ length: 30 }, (_, i) => ({
      id: `log-${i}`,
      action: 'seller.updated',
      entityType: 'seller',
      entityId: 'seller-1',
      details: {},
      createdAt: new Date(),
    }));
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(baseSeller as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(baseCdd as never);
    mockAuditRepo.findByEntity.mockResolvedValue(manyLogs as never);

    const result = await adminService.getAdminSellerDetail('seller-1');
    expect(result.auditLog).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `npx jest --testPathPattern="admin.service.test" --no-coverage`
Expected: FAIL — `getAdminSellerDetail is not a function` (or similar, confirming tests are wired correctly)

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/domains/admin/__tests__/admin.service.test.ts
git commit -m "test: add failing tests for getAdminSellerDetail"
```

---

### Task 4: Implement `getAdminSellerDetail`

**Files:**
- Modify: `src/domains/admin/admin.service.ts`

First, check the top of admin.service.ts for existing imports. You will see:
- `import * as adminRepo from './admin.repository'`
- `import * as auditRepo from '@/domains/shared/audit.repository'`
- `import { NotFoundError, ... } from '@/domains/shared/errors'`

You need to add one import — the compliance service:
```typescript
import * as complianceService from '@/domains/compliance/compliance.service';
```

Add it alongside the other domain imports at the top of the file.

- [ ] **Step 1: Add the service method**

Add the following function at the end of `src/domains/admin/admin.service.ts`:

```typescript
export async function getAdminSellerDetail(id: string): Promise<AdminSellerDetail> {
  const raw = await adminRepo.findSellerDetailForAdmin(id);
  if (!raw) throw new NotFoundError('Seller not found');

  const [cdd, auditLog] = await Promise.all([
    complianceService.findLatestSellerCddRecord(id),
    auditRepo.findByEntity('seller', id),
  ]);

  const property = raw.properties[0] ?? null;
  const transaction = raw.transactions[0] ?? null;

  return {
    seller: {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      phone: raw.phone,
      status: raw.status,
      notificationPreference: raw.notificationPreference,
      createdAt: raw.createdAt,
    },
    property: property
      ? {
          block: property.block,
          street: property.street,
          town: property.town,
          flatType: property.flatType,
          floorAreaSqm: property.floorAreaSqm,
          storeyRange: property.storeyRange,
          askingPrice: property.askingPrice ? property.askingPrice.toNumber() : null,
        }
      : null,
    agent: raw.agent,
    transaction: transaction
      ? {
          id: transaction.id,
          status: transaction.status,
          offerId: transaction.offerId,
          agreedPrice: transaction.agreedPrice.toNumber(),
          hdbApplicationStatus: transaction.hdbApplicationStatus,
          otpStatus: transaction.otp?.status ?? null,
          createdAt: transaction.createdAt,
        }
      : null,
    compliance: {
      cdd: cdd
        ? {
            riskLevel: cdd.riskLevel,
            identityVerified: cdd.identityVerified,
            verifiedAt: cdd.verifiedAt,
            createdAt: cdd.createdAt,
          }
        : null,
      consentCount: raw.consentRecords.length,
      hasWithdrawal: raw.consentRecords.some((c) => c.consentWithdrawnAt !== null),
    },
    auditLog: auditLog.slice(0, 20),
  };
}
```

Also add `AdminSellerDetail` to the import at the top of admin.service.ts. Look for the existing line that imports from `'./admin.types'` and add `AdminSellerDetail` to it.

- [ ] **Step 2: Run the tests — expect PASS**

Run: `npx jest --testPathPattern="admin.service.test" --no-coverage`
Expected: all `getAdminSellerDetail` tests PASS

- [ ] **Step 3: Run full unit test suite**

Run: `npm test`
Expected: all tests pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.service.ts src/domains/admin/__tests__/admin.service.test.ts
git commit -m "feat: add getAdminSellerDetail service method with tests"
```

---

## Chunk 2: Route and Templates

### Task 5: Add the detail route

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

The file is 968 lines. Find the `GET /admin/sellers` route (around line 336). Add the new detail route **after** `GET /admin/sellers` and **before** `GET /admin/sellers/:id/assign-modal`. The `:id` pattern does not conflict with `assign-modal` since that has an extra path segment.

- [ ] **Step 1: Insert the new route**

Find this comment or route block (around line 336):
```typescript
// ── Sellers ──────────────────────────────────────────────────
```
Or find the line: `adminRouter.get('/sellers',` and locate the end of that handler.

After the `GET /admin/sellers` handler block (and before `GET /admin/sellers/:id/assign-modal`), insert:

```typescript
adminRouter.get('/sellers/:id', ...adminAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await adminService.getAdminSellerDetail(req.params.id);
    res.render('pages/admin/seller-detail', { detail });
  } catch (err) {
    next(err);
  }
});
```

`adminAuth` is already defined at the top of admin.router.ts as `const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()]` — all other routes use this spread pattern. `adminService`, `Request`, `Response`, and `NextFunction` are all already imported.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: exits 0

- [ ] **Step 3: Run unit tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/domains/admin/admin.router.ts
git commit -m "feat: add GET /admin/sellers/:id route"
```

---

### Task 6: Create the detail page template

**Files:**
- Create: `src/views/pages/admin/seller-detail.njk`

- [ ] **Step 1: Create the file**

```njk
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

{# ── Seller Info ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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

{# ── Property ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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

{# ── Assigned Agent ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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

{# ── Transaction ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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

{# ── Compliance ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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

{# ── Status History ── #}
<div class="bg-white rounded-lg shadow p-6 mb-6">
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
{% endblock %}
```

- [ ] **Step 2: Smoke-test in dev server**

Run: `npm run dev`
Navigate to `/admin/sellers`, click any seller name (won't work yet — links not added). Then manually visit `/admin/sellers/<a-real-seller-id>` from the database. Confirm the page renders without errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/seller-detail.njk
git commit -m "feat: create admin seller detail page template"
```

---

### Task 7: Update `pipeline-table.njk`

**Files:**
- Modify: `src/views/partials/admin/pipeline-table.njk`

Two changes: (1) name cell becomes a link, (2) the Actions column header and cell are removed.

- [ ] **Step 1: Replace the name `<td>` and remove the Actions column**

Replace the entire table `<thead>` and the name + actions `<td>` cells. The new template:

```njk
{% if pipeline.stages.length > 0 %}
  {% for stageData in pipeline.stages %}
  <div class="mb-8">
    <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
      {{ stageData.status | capitalize }}
      <span class="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">{{ stageData.count }}</span>
    </h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">{{ "Name" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Phone" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Town" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Agent" | t }}</th>
            <th class="px-4 py-3 text-left">{{ "Asking Price" | t }}</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          {% for seller in stageData.sellers %}
          <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 font-medium">
              <a href="/admin/sellers/{{ seller.id }}" class="text-accent hover:underline">{{ seller.name }}</a>
            </td>
            <td class="px-4 py-3 text-gray-600">{{ seller.phone or '-' }}</td>
            <td class="px-4 py-3 text-gray-600">{{ seller.town or '-' }}</td>
            <td class="px-4 py-3 text-gray-600">
              {% if seller.agentName %}{{ seller.agentName }}{% else %}<span class="text-amber-600">{{ "Unassigned" | t }}</span>{% endif %}
            </td>
            <td class="px-4 py-3 text-gray-600">
              {% if seller.askingPrice %}${{ seller.askingPrice | formatPrice }}{% else %}-{% endif %}
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </div>
  {% endfor %}
  <p class="text-xs text-gray-500">{{ "Total:" | t }} {{ pipeline.totalSellers }} {{ "sellers" | t }}</p>
{% else %}
  <p class="text-gray-400 text-sm">{{ "No sellers in pipeline." | t }}</p>
{% endif %}
```

- [ ] **Step 2: Verify in dev**

Run: `npm run dev`
Navigate to `/admin/pipeline`. Confirm: name cells are clickable links, no Actions column.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/pipeline-table.njk
git commit -m "feat: make seller name a link in admin pipeline table, remove Actions column"
```

---

### Task 8: Update `lead-list.njk`

**Files:**
- Modify: `src/views/partials/admin/lead-list.njk`

- [ ] **Step 1: Replace the name `<td>`**

In `src/views/partials/admin/lead-list.njk`, find:
```njk
        <td class="px-4 py-3 font-medium">{{ lead.name }}</td>
```

Replace with:
```njk
        <td class="px-4 py-3 font-medium">
          <a href="/admin/sellers/{{ lead.id }}" class="text-accent hover:underline">{{ lead.name }}</a>
        </td>
```

The Assign button in the Actions column stays unchanged.

- [ ] **Step 2: Verify in dev**

Navigate to `/admin/leads`. Confirm name is a clickable link and Assign button still works.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/admin/lead-list.njk
git commit -m "feat: make lead name a link in admin leads list"
```

---

### Task 9: Update `seller-list.njk`

**Files:**
- Modify: `src/views/partials/admin/seller-list.njk`

- [ ] **Step 1: Replace the name cell**

In `src/views/partials/admin/seller-list.njk`, find:
```njk
        <td class="px-4 py-3">
          <div class="font-medium">{{ seller.name }}</div>
          <div class="text-xs text-gray-500">{{ seller.email }}</div>
        </td>
```

Replace with:
```njk
        <td class="px-4 py-3">
          <a href="/admin/sellers/{{ seller.id }}" class="font-medium text-accent hover:underline">{{ seller.name }}</a>
          <div class="text-xs text-gray-500">{{ seller.email }}</div>
        </td>
```

The Assign/Reassign button in the Actions column stays unchanged.

- [ ] **Step 2: Verify in dev**

Navigate to `/admin/sellers`. Confirm name is a clickable link and Assign/Reassign button still works.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/admin/seller-list.njk
git commit -m "feat: make seller name a link in admin sellers list"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: all tests pass, no regressions

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration`
Expected: all tests pass

- [ ] **Step 3: Manual smoke test**

With `npm run dev`:
1. `/admin/pipeline` — click a seller name → lands on `/admin/sellers/:id` detail page with all sections
2. `/admin/leads` — click a lead name → same; Assign button still triggers modal
3. `/admin/sellers` — click a seller name → same; Assign/Reassign button still works
4. `/admin/sellers/<nonexistent-id>` → 404 error page

- [ ] **Step 4: Final commit if anything was missed**

```bash
git add -p
git commit -m "chore: admin seller detail page cleanup"
```
