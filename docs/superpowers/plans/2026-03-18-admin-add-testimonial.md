# Admin Manual Testimonial Creation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "+ Add Testimonial" button to `/admin/content/testimonials` that opens a slide-in drawer, allowing admins to manually create testimonials from offline/external sources.

**Architecture:** Schema changes make `sellerId` and `transactionId` nullable and add `buyerId`, `clientType`, `source`, `isManual`, `createdByAgentId` fields. A new service method `createManualTestimonial` handles creation. Two new admin routes serve the drawer form (GET) and handle submission (POST). The slide-in drawer reuses the existing panel infrastructure from `/agent/reviews`.

**Tech Stack:** Prisma (PostgreSQL), Express, Nunjucks, HTMX, Tailwind CSS, Jest

---

## Chunk 1: Schema, Migration, Types, Validator, Repository

### Task 1: Update Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:870-890`

- [ ] **Step 1: Update schema**

Replace the `Testimonial` model and add the `ClientType` enum. Find the block at line ~216 (enums section) and add the enum after `TestimonialStatus`:

```prisma
enum ClientType {
  seller
  buyer
}
```

Replace the `Testimonial` model (lines ~870–890) with:

```prisma
model Testimonial {
  id                  String             @id
  sellerId            String?            @map("seller_id")
  seller              Seller?            @relation(fields: [sellerId], references: [id])
  buyerId             String?            @map("buyer_id")
  buyer               Buyer?             @relation(fields: [buyerId], references: [id])
  transactionId       String?            @unique @map("transaction_id")
  transaction         Transaction?       @relation(fields: [transactionId], references: [id])
  clientType          ClientType?        @map("client_type")
  content             String?
  rating              Int?
  clientName          String             @map("client_name")
  clientTown          String             @map("client_town")
  source              String?
  isManual            Boolean            @default(false) @map("is_manual")
  createdByAgentId    String?            @map("created_by_agent_id")
  createdByAgent      Agent?             @relation("TestimonialCreatedBy", fields: [createdByAgentId], references: [id])
  status              TestimonialStatus  @default(pending_submission)
  submissionToken     String?            @unique @map("submission_token")
  tokenExpiresAt      DateTime?          @map("token_expires_at")
  approvedByAgentId   String?            @map("approved_by_agent_id")
  approvedByAgent     Agent?             @relation("TestimonialApprovedBy", fields: [approvedByAgentId], references: [id])
  approvedAt          DateTime?          @map("approved_at")
  displayOnWebsite    Boolean            @default(false) @map("display_on_website")
  createdAt           DateTime           @default(now()) @map("created_at")

  @@map("testimonials")
}
```

Add the `testimonials` back-relation to the `Buyer` model (after `consentRecords ConsentRecord[]`):

```prisma
  testimonials   Testimonial[]
```

Update the `Agent` model — the existing `approvedByAgent` relation now needs a name. Find the existing unnamed `Testimonial[]` relation on Agent and replace it:

```prisma
  testimonialsApproved   Testimonial[]  @relation("TestimonialApprovedBy")
  testimonialsCreated    Testimonial[]  @relation("TestimonialCreatedBy")
```

> **Note on Agent relations:** The `Agent` model currently has `testimonials Testimonial[]` (unnamed). This will conflict with the two named relations. Replace that single field with the two named ones above.

- [ ] **Step 2: Run prisma generate to check for errors**

```bash
npx prisma generate
```

Expected: Success — Prisma client generated without errors.

---

### Task 2: Create migration

**Files:**
- Create: `prisma/migrations/20260318120000_testimonial_manual_and_client_type/migration.sql`

- [ ] **Step 1: Create shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
```

- [ ] **Step 2: Generate migration diff**

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" \
  --script
```

Copy the output SQL.

- [ ] **Step 3: Create migration file**

Create directory:
```bash
mkdir -p prisma/migrations/20260318120000_testimonial_manual_and_client_type
```

Save the SQL output to `prisma/migrations/20260318120000_testimonial_manual_and_client_type/migration.sql`.

The migration should include operations roughly equivalent to:
```sql
-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('seller', 'buyer');

-- AlterTable: make seller_id and transaction_id nullable; rename columns
ALTER TABLE "testimonials"
  RENAME COLUMN "seller_name" TO "client_name";
ALTER TABLE "testimonials"
  RENAME COLUMN "seller_town" TO "client_town";
ALTER TABLE "testimonials"
  ALTER COLUMN "seller_id" DROP NOT NULL,
  ALTER COLUMN "transaction_id" DROP NOT NULL;

-- Add new columns
ALTER TABLE "testimonials"
  ADD COLUMN "buyer_id" TEXT,
  ADD COLUMN "client_type" "ClientType",
  ADD COLUMN "source" TEXT,
  ADD COLUMN "is_manual" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "created_by_agent_id" TEXT;

-- AddForeignKey for buyer_id
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_buyer_id_fkey"
  FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for created_by_agent_id
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_created_by_agent_id_fkey"
  FOREIGN KEY ("created_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

> **Important:** Use the actual diff output, not the snippet above — Prisma may generate slightly different SQL for constraint renames/drops.

- [ ] **Step 4: Deploy migration**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: Migration applied; 0 errors.

- [ ] **Step 5: Drop shadow database**

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260318120000_testimonial_manual_and_client_type/
git commit -m "feat: add manual testimonial fields to schema (clientName, buyerId, isManual, source)"
```

---

### Task 3: Update types and validator

**Files:**
- Modify: `src/domains/content/content.types.ts`
- Modify: `src/domains/content/content.validator.ts`

- [ ] **Step 1: Update content.types.ts**

In `TestimonialSubmitInput` (line ~92), rename `sellerName` → `clientName` and `sellerTown` → `clientTown`:

```typescript
export interface TestimonialSubmitInput {
  content: string;
  rating: number;
  clientName: string;
  clientTown: string;
}
```

Add new type for admin manual creation:

```typescript
export interface CreateManualTestimonialInput {
  clientName: string;
  clientTown: string;
  rating: number;
  content: string;
  source?: string;
}
```

- [ ] **Step 2: Update content.validator.ts**

Rename fields in `validateTestimonialSubmit` and add new `validateManualTestimonialCreate`:

```typescript
export const validateTestimonialSubmit = [
  body('content').trim().notEmpty().withMessage('Please share your experience'),
  body('rating').isInt({ min: 1, max: 5 }).toInt().withMessage('Rating must be between 1 and 5'),
  body('clientName').trim().notEmpty().withMessage('Name is required'),
  body('clientTown').trim().notEmpty().withMessage('Town is required'),
];

export const validateManualTestimonialCreate = [
  body('clientName').trim().notEmpty().isLength({ max: 100 }).withMessage('Name is required (max 100 chars)'),
  body('clientTown').trim().notEmpty().isLength({ max: 100 }).withMessage('Town is required (max 100 chars)'),
  body('rating').isInt({ min: 1, max: 5 }).toInt().withMessage('Rating must be 1–5'),
  body('content').trim().isLength({ min: 10, max: 1000 }).withMessage('Testimonial must be 10–1000 characters'),
  body('source').optional().trim().isLength({ max: 50 }),
];
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/content/content.types.ts src/domains/content/content.validator.ts
git commit -m "feat: add CreateManualTestimonialInput type and validateManualTestimonialCreate validator"
```

---

### Task 4: Update repository (TDD)

**Files:**
- Modify: `src/domains/content/content.repository.ts`
- Modify: `src/domains/content/content.service.test.ts`

> **Note on naming:** The spec uses `createdByAdminId` but there is no `Admin` model in the schema — only `Agent` with `role = 'admin'`. The plan uses `createdByAgentId` (FK → `Agent`) which is architecturally correct.

- [ ] **Step 1: Write failing test + add mock**

In `src/domains/content/content.service.test.ts`, find where `mockedRepo` is set up (look for the `jest.mock` block at the top). Add `createManualTestimonial: jest.fn()` to the mocked repo object.

Then find the `submitTestimonial` describe block (line ~498) and before it add:

```typescript
describe('createManualTestimonial', () => {
  it('creates testimonial with isManual true and pending_review status', async () => {
    const input: CreateManualTestimonialInput = {
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Excellent service from start to finish.',
      source: 'Google',
    };
    const mockRecord = {
      id: 'test-id',
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Excellent service from start to finish.',
      source: 'Google',
      isManual: true,
      status: 'pending_review',
      createdByAgentId: 'agent-1',
      sellerId: null,
      buyerId: null,
      transactionId: null,
    };
    mockedRepo.createManualTestimonial.mockResolvedValue(mockRecord as any);

    const result = await contentService.createManualTestimonial('agent-1', input);

    expect(mockedRepo.createManualTestimonial).toHaveBeenCalledWith(
      expect.objectContaining({
        isManual: true,
        status: 'pending_review',
        createdByAgentId: 'agent-1',
        sellerId: null,
        buyerId: null,
        transactionId: null,
        clientName: 'Mary L.',
        clientTown: 'Bishan',
        rating: 5,
        content: 'Excellent service from start to finish.',
        source: 'Google',
      }),
    );
    expect(result.isManual).toBe(true);
    expect(result.status).toBe('pending_review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="content.service.test" --no-coverage
```

Expected: FAIL — `contentService.createManualTestimonial is not a function`.

- [ ] **Step 3: Update repository**

In `content.repository.ts`, update `createTestimonial` input type and add `createManualTestimonial`:

**Update `createTestimonial` input type** (field renames for consistency):
```typescript
export async function createTestimonial(input: {
  id: string;
  sellerId: string;
  transactionId: string;
  clientName: string;
  clientTown: string;
  submissionToken: string;
  tokenExpiresAt: Date;
  clientType?: 'seller' | 'buyer';
}) {
  return prisma.testimonial.create({ data: input });
}
```

**Update `updateTestimonialSubmission`** (rename fields):
```typescript
export async function updateTestimonialSubmission(
  id: string,
  data: {
    content: string;
    rating: number;
    clientName: string;
    clientTown: string;
    status: 'pending_review';
  },
) {
  return prisma.testimonial.update({ where: { id }, data });
}
```

**Add `createManualTestimonial`** after `createTestimonial`:
```typescript
export async function createManualTestimonial(input: {
  id: string;
  clientName: string;
  clientTown: string;
  rating: number;
  content: string;
  source?: string | null;
  isManual: true;
  status: 'pending_review';
  createdByAgentId: string;
  sellerId: null;
  buyerId: null;
  transactionId: null;
}) {
  return prisma.testimonial.create({ data: input });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="content.service.test" --no-coverage
```

Expected: PASS (new test + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/content/content.repository.ts src/domains/content/content.service.test.ts
git commit -m "feat: add createManualTestimonial to content repository"
```

---

## Chunk 2: Service, Routes, Views, app.js

### Task 5: Update content service

**Files:**
- Modify: `src/domains/content/content.service.ts`

- [ ] **Step 1: Update `issueTestimonialToken`** — rename `sellerName`/`sellerTown` → `clientName`/`clientTown` and set `clientType`:

```typescript
export async function issueTestimonialToken(
  sellerId: string,
  transactionId: string,
  sellerName: string,
  sellerTown: string,
) {
  const token = createId();
  const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return contentRepo.createTestimonial({
    id: createId(),
    sellerId,
    transactionId,
    clientName: formatDisplayName(sellerName),
    clientTown: sellerTown,
    clientType: 'seller',
    submissionToken: token,
    tokenExpiresAt,
  });
}
```

- [ ] **Step 2: Update `submitTestimonial`** — rename fields in the update call:

```typescript
return contentRepo.updateTestimonialSubmission(testimonial.id, {
  content: input.content,
  rating: input.rating,
  clientName: input.clientName,
  clientTown: input.clientTown,
  status: 'pending_review' as const,
});
```

- [ ] **Step 3: Update `rejectTestimonial`** — guard notification send (sellerId is now nullable):

```typescript
export async function rejectTestimonial(id: string, agentId?: string, reason?: string) {
  const testimonial = await contentRepo.updateTestimonialStatus(id, 'rejected');
  if (testimonial.sellerId) {
    void notificationService.send(
      {
        recipientType: 'seller',
        recipientId: testimonial.sellerId,
        templateName: 'testimonial_rejected',
        templateData: {
          reason: reason ?? 'Your testimonial did not meet our publication guidelines.',
        },
      },
      agentId ?? 'system',
    );
  }
  return testimonial;
}
```

- [ ] **Step 4: Add `createManualTestimonial`** after `rejectTestimonial`:

```typescript
export async function createManualTestimonial(
  agentId: string,
  input: CreateManualTestimonialInput,
) {
  return contentRepo.createManualTestimonial({
    id: createId(),
    clientName: input.clientName,
    clientTown: input.clientTown,
    rating: input.rating,
    content: input.content,
    source: input.source ?? null,
    isManual: true,
    status: 'pending_review',
    createdByAgentId: agentId,
    sellerId: null,
    buyerId: null,
    transactionId: null,
  });
}
```

Add `CreateManualTestimonialInput` to the import from `./content.types`.

- [ ] **Step 5: Run all content service tests**

```bash
npm test -- --testPathPattern="content.service.test" --no-coverage
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/content/content.service.ts
git commit -m "feat: add createManualTestimonial service method; update field renames and nullable sellerId guard"
```

---

### Task 6: Verify compliance.service.ts (PDPA path)

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`

> **Context:** `removeTestimonial(sellerId)` calls `findTestimonialBySeller(sellerId)` which queries `where: { sellerId }`. After making `sellerId` nullable on the model, this query still works correctly — it will only match seller-submitted records. No logic change is needed. This task verifies the existing code still typechecks and tests still pass.

- [ ] **Step 1: Run compliance tests**

```bash
npm test -- --testPathPattern="compliance" --no-coverage
```

Expected: All pass. If TypeScript errors appear on `sellerId` references (the field is now `String?` not `String`), update the `removeTestimonial` call in compliance.service.ts to guard against null:

```typescript
// If TypeScript complains about nullable sellerId in notification sends, add guard:
if (testimonial.sellerId) {
  // existing notification/audit code
}
```

- [ ] **Step 2: Confirm TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add src/domains/compliance/compliance.service.ts
git commit -m "fix: guard nullable sellerId in compliance removeTestimonial"
```

---

### Task 7: Update testimonial.router.ts (public form)

**Files:**
- Modify: `src/domains/content/testimonial.router.ts`

- [ ] **Step 1: Update field references in the POST route**

In the public testimonial form POST handler (line ~55), update body field references from `sellerName`/`sellerTown` → `clientName`/`clientTown`:

```typescript
sellerName: req.body.clientName as string,
sellerTown: req.body.clientTown as string,
```

Wait — the public form still uses `name="sellerName"` HTML field names. Keep the form field names as-is in the Nunjucks template, but update the router to read them correctly.

Update `testimonial.router.ts`:
```typescript
clientName: req.body.clientName as string,
clientTown: req.body.clientTown as string,
```

And update the public form template to use `clientName`/`clientTown` field names.

- [ ] **Step 2: Update public testimonial form template**

In `src/views/pages/public/testimonial-form.njk`, rename `sellerName` → `clientName` and `sellerTown` → `clientTown` in both `name=` attributes and `value=` references.

- [ ] **Step 3: Update public testimonials display partial**

In `src/views/partials/public/testimonials-section.njk` (lines 13–14), rename:
```njk
<p class="text-sm font-medium text-gray-800">{{ t.clientName }}</p>
<p class="text-xs text-gray-400">{{ t.clientTown }}</p>
```

- [ ] **Step 4: Run unit tests**

```bash
npm test --no-coverage
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/content/testimonial.router.ts src/views/pages/public/testimonial-form.njk src/views/partials/public/testimonials-section.njk
git commit -m "feat: rename sellerName/sellerTown to clientName/clientTown in public testimonial form"
```

---

### Task 8: Add admin routes for manual creation

**Files:**
- Modify: `src/domains/admin/admin.router.ts`

- [ ] **Step 1: Write failing integration tests first**

In the admin integration test file (found in Step 1 of Task 14), add these tests now — they will return 404 until the routes are implemented:

```typescript
describe('POST /admin/content/testimonials', () => {
  it('creates a manual testimonial and returns 200 (HTMX)', async () => {
    const response = await request(app)
      .post('/admin/content/testimonials')
      .set('Cookie', adminSessionCookie)
      .set('HX-Request', 'true')
      .send({ clientName: 'Mary L.', clientTown: 'Bishan', rating: '5', content: 'Excellent service from start to finish.' });
    expect(response.status).toBe(200);
  });
});
```

Then run to confirm they fail (404 ≠ 200):

```bash
npm run test:integration -- --testPathPattern="admin" --no-coverage
```

Expected: FAIL — `received 404, expected 200`. This is the correct red state.

- [ ] **Step 2: Add imports**

At the top of `admin.router.ts`, ensure `validateManualTestimonialCreate` is imported:

```typescript
import {
  // ... existing imports
  validateManualTestimonialCreate,
} from '../content/content.validator';
```

Also import `validationResult` from `express-validator` if not already present.

- [ ] **Step 3: Add GET /admin/content/testimonials/new route**

Add immediately before the existing `GET /admin/content/testimonials` route (so it doesn't get shadowed by the `:id` param routes):

```typescript
// Drawer form partial for manual testimonial creation
adminRouter.get(
  '/admin/content/testimonials/new',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      return res.render('partials/admin/testimonial-add-drawer');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Add POST /admin/content/testimonials route**

Add after the GET `/admin/content/testimonials` route and before the approval routes:

```typescript
adminRouter.post(
  '/admin/content/testimonials',
  ...adminAuth,
  validateManualTestimonialCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.status(422).render('partials/admin/testimonial-add-drawer', {
            errors: errors.array(),
            values: req.body,
          });
        }
        return res.redirect('/admin/content/testimonials');
      }

      const user = req.user as AuthenticatedUser;
      await contentService.createManualTestimonial(user.id, {
        clientName: req.body.clientName as string,
        clientTown: req.body.clientTown as string,
        rating: Number(req.body.rating),
        content: req.body.content as string,
        source: (req.body.source as string) || undefined,
      });

      if (req.headers['hx-request']) {
        const records = await contentService.listTestimonials();
        return res.render('partials/admin/testimonial-list', { records });
      }
      return res.redirect('/admin/content/testimonials');
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 5: Run tests**

```bash
npm test --no-coverage
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/admin/admin.router.ts
git commit -m "feat: add GET /admin/content/testimonials/new and POST /admin/content/testimonials routes"
```

---

### Task 9: Create drawer partial

**Files:**
- Create: `src/views/partials/admin/testimonial-add-drawer.njk`

- [ ] **Step 1: Create the drawer form partial**

```njk
{#
  testimonial-add-drawer.njk
  Slide-in drawer form for manually creating a testimonial.
  Used by: GET /admin/content/testimonials/new (loaded into #testimonial-drawer-content)
  On success POST: server renders partials/admin/testimonial-list into #testimonial-list
#}
<div class="p-6 flex flex-col gap-4 min-h-full">
  <div class="flex items-center justify-between mb-2">
    <h2 class="text-lg font-semibold text-gray-900">{{ "Add Testimonial" | t }}</h2>
    <button
      type="button"
      data-action="close-testimonial-drawer"
      aria-label="{{ 'Close' | t }}"
      class="text-gray-400 hover:text-gray-600 p-1 rounded">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>

  {% if errors | length %}
  <div class="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
    <ul class="list-disc list-inside space-y-1">
      {% for err in errors %}
      <li>{{ err.msg }}</li>
      {% endfor %}
    </ul>
  </div>
  {% endif %}

  <form
    hx-post="/admin/content/testimonials"
    hx-target="#testimonial-list"
    hx-swap="innerHTML"
    data-reset-on-success
    class="flex flex-col gap-4">

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-clientName">
        {{ "Client Name" | t }}
      </label>
      <input
        type="text"
        id="drawer-clientName"
        name="clientName"
        value="{{ values.clientName if values else '' }}"
        maxlength="100"
        required
        class="input-field w-full"
        placeholder="{{ 'e.g. Mary L.' | t }}">
    </div>

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

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1">
        {{ "Rating" | t }}
      </label>
      <select name="rating" required class="input-field w-full">
        {% set ratingVal = values.rating | int if values else 0 %}
        <option value="" {% if not ratingVal %}selected{% endif %} disabled>{{ "Select rating" | t }}</option>
        {% for n in [5, 4, 3, 2, 1] %}
        <option value="{{ n }}" {% if ratingVal == n %}selected{% endif %}>
          {{ n }}★
        </option>
        {% endfor %}
      </select>
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-content">
        {{ "Testimonial Text" | t }}
      </label>
      <textarea
        id="drawer-content"
        name="content"
        rows="5"
        minlength="10"
        maxlength="1000"
        required
        class="input-field w-full resize-y"
        placeholder="{{ 'What did the client say?' | t }}">{{ values.content if values else '' }}</textarea>
    </div>

    <div>
      <label class="block text-xs font-medium text-gray-500 uppercase mb-1" for="drawer-source">
        {{ "Source" | t }}
        <span class="text-gray-400 normal-case font-normal ml-1">{{ "(optional)" | t }}</span>
      </label>
      <input
        type="text"
        id="drawer-source"
        name="source"
        value="{{ values.source if values else '' }}"
        maxlength="50"
        class="input-field w-full"
        placeholder="{{ 'e.g. Google, WhatsApp, Phone' | t }}">
    </div>

    <div class="flex gap-2 pt-2">
      <button type="submit" class="btn-primary flex-1">
        {{ "Save as Pending Review" | t }}
      </button>
      <button
        type="button"
        data-action="close-testimonial-drawer"
        class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
        {{ "Cancel" | t }}
      </button>
    </div>

    <p class="text-xs text-gray-400 text-center">
      {{ "Saved as Pending Review — approve from the list to feature on website." | t }}
    </p>
  </form>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/admin/testimonial-add-drawer.njk
git commit -m "feat: add testimonial-add-drawer partial"
```

---

### Task 10: Update testimonials page + list partial

**Files:**
- Modify: `src/views/pages/admin/testimonials.njk`
- Modify: `src/views/partials/admin/testimonial-list.njk`

- [ ] **Step 1: Update testimonials.njk** — add button, backdrop, and drawer panel:

```njk
{% extends "layouts/admin.njk" %}

{% block title %}{{ "Testimonials" | t }} — Admin{% endblock %}

{% block content %}
{% set pageTitle = "Testimonials" %}
{% set pageActionsHtml %}
  <button
    hx-get="/admin/content/testimonials/new"
    hx-target="#testimonial-drawer-content"
    hx-swap="innerHTML"
    class="btn-primary text-sm">
    {{ "+ Add Testimonial" | t }}
  </button>
{% endset %}
{% include "partials/shared/page-header.njk" %}

<div id="testimonial-list">
  {% include "partials/admin/testimonial-list.njk" %}
</div>

{# Invisible click-outside backdrop #}
<div id="testimonial-drawer-backdrop" class="hidden fixed inset-0 z-[39]" data-action="close-testimonial-drawer"></div>

{# Slide-in drawer panel #}
<div
  id="testimonial-drawer-panel"
  class="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-40 translate-x-full opacity-0 pointer-events-none transition-all duration-300 ease-out overflow-y-auto"
  aria-hidden="true">
  <div id="testimonial-drawer-content">{# Populated via HTMX on button click #}</div>
</div>
{% endblock %}
```

- [ ] **Step 2: Update testimonial-list.njk** — rename fields + add Source column:

```njk
{% set statusColors = {
  pending_submission: "bg-gray-100 text-gray-700",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700"
} %}

{% if records | length == 0 %}
<p class="text-gray-500 text-sm">{{ "No testimonials yet." | t }}</p>
{% else %}
<table class="w-full text-sm">
  <thead>
    <tr class="text-left text-gray-500 border-b">
      <th class="pb-2 pr-4">{{ "Client" | t }}</th>
      <th class="pb-2 pr-4">{{ "Town" | t }}</th>
      <th class="pb-2 pr-4">{{ "Rating" | t }}</th>
      <th class="pb-2 pr-4">{{ "Status" | t }}</th>
      <th class="pb-2 pr-4">{{ "Source" | t }}</th>
      <th class="pb-2 pr-4">{{ "Featured" | t }}</th>
      <th class="pb-2"></th>
    </tr>
  </thead>
  <tbody>
    {% for record in records %}
    <tr class="border-b last:border-0 hover:bg-gray-50">
      <td class="py-2 pr-4">{{ record.clientName }}</td>
      <td class="py-2 pr-4 text-gray-500 text-xs">{{ record.clientTown }}</td>
      <td class="py-2 pr-4">{{ record.rating }}★</td>
      <td class="py-2 pr-4">
        <span class="px-2 py-0.5 rounded text-xs font-medium {{ statusColors[record.status] }}">
          {{ record.status | replace('_', ' ') }}
        </span>
      </td>
      <td class="py-2 pr-4">
        {% if record.isManual %}
          <span class="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">{{ "Manual" | t }}</span>
          {% if record.source %}<span class="ml-1 text-xs text-gray-500">{{ record.source }}</span>{% endif %}
        {% else %}
          <span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{{ "Seller" | t }}</span>
        {% endif %}
      </td>
      <td class="py-2 pr-4">
        {% if record.status == 'approved' %}
        <form method="POST" action="/admin/content/testimonials/{{ record.id }}/feature" class="inline">
          <input type="hidden" name="displayOnWebsite" value="{{ 'false' if record.displayOnWebsite else 'true' }}">
          <button type="submit" class="text-xs text-indigo-600 hover:underline">
            {{ "Unfeature" | t if record.displayOnWebsite else "Feature" | t }}
          </button>
        </form>
        {% endif %}
      </td>
      <td class="py-2 text-right flex gap-2 justify-end">
        {% if record.status == 'pending_review' %}
        <form method="POST" action="/admin/content/testimonials/{{ record.id }}/approve" class="inline">
          <button type="submit" class="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
            {{ "Approve" | t }}
          </button>
        </form>
        <form method="POST" action="/admin/content/testimonials/{{ record.id }}/reject" class="inline">
          <button type="submit" class="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
            {{ "Reject" | t }}
          </button>
        </form>
        {% endif %}
      </td>
    </tr>
    {% endfor %}
  </tbody>
</table>
<p class="mt-2 text-xs text-gray-500">{{ records | length }} {{ "testimonials" | t }}</p>
{% endif %}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/admin/testimonials.njk src/views/partials/admin/testimonial-list.njk
git commit -m "feat: add Add Testimonial button, drawer panel, and Source column to testimonials page"
```

---

### Task 11: Add drawer JS to app.js

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add testimonial drawer show/hide logic**

In `public/js/app.js`, find the `htmx:afterRequest` block for the review panel (line ~252). Immediately after the closing `});` of that block, add a new event listener for the testimonial drawer:

```javascript
// ── HTMX: testimonial drawer show/hide ──────────────────────
document.addEventListener('htmx:afterRequest', function (e) {
  var drawer = document.getElementById('testimonial-drawer-panel');
  if (drawer) {
    // Show drawer when form content loads into it
    if (e.detail.target && e.detail.target.id === 'testimonial-drawer-content' && e.detail.successful) {
      drawer.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
      drawer.removeAttribute('aria-hidden');
      var backdrop = document.getElementById('testimonial-drawer-backdrop');
      if (backdrop) backdrop.classList.remove('hidden');
    }
    // Hide drawer and refresh list after successful form POST
    if (e.detail.elt && e.detail.elt.closest && e.detail.elt.closest('#testimonial-drawer-panel') && e.detail.successful && e.detail.target && e.detail.target.id === 'testimonial-list') {
      drawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
      drawer.setAttribute('aria-hidden', 'true');
      var backdrop2 = document.getElementById('testimonial-drawer-backdrop');
      if (backdrop2) backdrop2.classList.add('hidden');
    }
  }
});
```

- [ ] **Step 2: Add close-testimonial-drawer action to the click delegation handler**

Find the `data-action` click handler (the block that already handles `close-review-panel`). Add after that case:

```javascript
if (action === 'close-testimonial-drawer') {
  var testimonialDrawer = document.getElementById('testimonial-drawer-panel');
  var testimonialBackdrop = document.getElementById('testimonial-drawer-backdrop');
  if (testimonialDrawer) {
    testimonialDrawer.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
    testimonialDrawer.setAttribute('aria-hidden', 'true');
  }
  if (testimonialBackdrop) testimonialBackdrop.classList.add('hidden');
}
```

- [ ] **Step 3: Run tests**

```bash
npm test --no-coverage
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add testimonial drawer open/close JS in app.js"
```

---

## Chunk 3: Tests

### Task 12: Add repository unit test for createManualTestimonial

**Files:**
- Modify or create: repository test file (check for `content.repository.test.ts` — create if absent)

- [ ] **Step 1: Find or create repository test file**

```bash
find src/domains/content -name "*.test.ts" | grep -v service
```

If no repo test file exists, create `src/domains/content/content.repository.test.ts` with standard Prisma mock setup (follow the pattern from any other `*.repository.test.ts` in the project).

- [ ] **Step 2: Write failing repository test**

```typescript
describe('createManualTestimonial', () => {
  it('inserts a testimonial with isManual true, pending_review, and null FKs', async () => {
    const input = {
      id: 'test-id',
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Excellent service from start to finish.',
      source: 'Google',
      isManual: true as const,
      status: 'pending_review' as const,
      createdByAgentId: 'agent-1',
      sellerId: null,
      buyerId: null,
      transactionId: null,
    };

    mockPrisma.testimonial.create.mockResolvedValue({ ...input, createdAt: new Date(), displayOnWebsite: false });

    await contentRepo.createManualTestimonial(input);

    expect(mockPrisma.testimonial.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isManual: true,
        status: 'pending_review',
        sellerId: null,
        buyerId: null,
        transactionId: null,
        createdByAgentId: 'agent-1',
      }),
    });
  });
});
```

- [ ] **Step 3: Run to verify it passes**

> **Note:** The repository implementation was already added in Task 4 Step 3. This task writes the coverage test after the fact — verify the test passes immediately:

```bash
npm test -- --testPathPattern="content.repository.test" --no-coverage
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domains/content/content.repository.test.ts
git commit -m "test: add repository unit test for createManualTestimonial"
```

---

### Task 13: Update existing tests for field renames

**Files:**
- Modify: `src/domains/content/content.service.test.ts`

- [ ] **Step 1: Find and update sellerName/sellerTown references**

In `content.service.test.ts`, update the `validInput` in `submitTestimonial` describe block (line ~499):

```typescript
const validInput: TestimonialSubmitInput = {
  content: 'Great service!',
  rating: 5,
  clientName: 'John Thomas',
  clientTown: 'Tampines',
};
```

Update any other `sellerName`/`sellerTown` references in the same file.

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPattern="content.service.test" --no-coverage
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/domains/content/content.service.test.ts
git commit -m "test: update sellerName/sellerTown → clientName/clientTown in content service tests"
```

---

### Task 14: Add integration test for POST /admin/content/testimonials

**Files:**
- Modify or create: integration test file for admin testimonials (look for existing `admin.router.test.ts` or `admin.integration.test.ts`)

- [ ] **Step 1: Find the integration test file**

```bash
find src -name "*.integration.test.ts" | head -20
# or
find src -name "admin.router.test.ts"
```

- [ ] **Step 2: Add integration tests**

In the relevant integration test file, add a describe block for the new routes:

```typescript
describe('POST /admin/content/testimonials', () => {
  it('creates a manual testimonial and returns 200 with list partial (HTMX)', async () => {
    const response = await request(app)
      .post('/admin/content/testimonials')
      .set('Cookie', adminSessionCookie)  // use existing auth helper
      .set('HX-Request', 'true')
      .send({
        clientName: 'Mary L.',
        clientTown: 'Bishan',
        rating: '5',
        content: 'Excellent service from start to finish.',
        source: 'Google',
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain('testimonial');
  });

  it('returns 422 with errors when required fields missing (HTMX)', async () => {
    const response = await request(app)
      .post('/admin/content/testimonials')
      .set('Cookie', adminSessionCookie)
      .set('HX-Request', 'true')
      .send({
        clientName: '',
        clientTown: '',
        rating: '0',
        content: 'short',
      });

    expect(response.status).toBe(422);
  });

  it('redirects to /admin/content/testimonials on success (non-HTMX)', async () => {
    const response = await request(app)
      .post('/admin/content/testimonials')
      .set('Cookie', adminSessionCookie)
      .send({
        clientName: 'Mary L.',
        clientTown: 'Bishan',
        rating: '5',
        content: 'Excellent service from start to finish.',
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin/content/testimonials');
  });
});

describe('GET /admin/content/testimonials/new', () => {
  it('returns drawer form partial (HTMX)', async () => {
    const response = await request(app)
      .get('/admin/content/testimonials/new')
      .set('Cookie', adminSessionCookie)
      .set('HX-Request', 'true');

    expect(response.status).toBe(200);
    expect(response.text).toContain('clientName');
  });
});
```

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration -- --testPathPattern="admin" --no-coverage
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
# Specify exact test file path found in Step 1
git add src/domains/admin/__tests__/admin.router.test.ts  # adjust filename if different
git commit -m "test: add integration tests for POST /admin/content/testimonials and GET /new"
```

---

### Task 15: Final check

- [ ] **Step 1: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: All pass.

- [ ] **Step 2: Build to verify TypeScript compiles**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Final commit**

If any loose files remain unstaged:

```bash
git status
git add <any remaining files>
git commit -m "feat: admin manual testimonial creation — complete"
```
