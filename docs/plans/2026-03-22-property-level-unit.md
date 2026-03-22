# Property Level & Unit Number Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `storeyRange` and `flatModel` on the `Property` model with `level` and `unitNumber`, displayed as `#07-123`.

**Architecture:** Schema migration drops `storey_range`/`flat_model` and adds `level`/`unit_number` on the `properties` table only. `HdbTransaction` fields are untouched. All downstream types, validators, routes, views, and tests are updated to match.

**Tech Stack:** Prisma, TypeScript, Nunjucks, Jest, Supertest

---

### Task 1: Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma:473-475`
- Create: `prisma/migrations/20260322120000_property_level_unit/migration.sql`

**Step 1: Update the schema**

In `prisma/schema.prisma`, find the Property model and replace:
```
  storeyRange       String         @map("storey_range")
  floorAreaSqm      Float          @map("floor_area_sqm")
  flatModel         String         @map("flat_model")
```
with:
```
  level             String         @map("level")
  unitNumber        String         @map("unit_number")
  floorAreaSqm      Float          @map("floor_area_sqm")
```

**Step 2: Create the migration directory and SQL file**

```bash
mkdir -p prisma/migrations/20260322120000_property_level_unit
```

Create `prisma/migrations/20260322120000_property_level_unit/migration.sql`:
```sql
ALTER TABLE "public"."properties"
  ADD COLUMN "level" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "unit_number" TEXT NOT NULL DEFAULT '';

ALTER TABLE "public"."properties"
  DROP COLUMN "storey_range",
  DROP COLUMN "flat_model";

ALTER TABLE "public"."properties"
  ALTER COLUMN "level" DROP DEFAULT,
  ALTER COLUMN "unit_number" DROP DEFAULT;
```

**Step 3: Run the migration**

```bash
npm run docker:dev
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied`, no errors.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260322120000_property_level_unit/
git commit -m "feat(property): replace storeyRange/flatModel with level/unitNumber in schema"
```

---

### Task 2: Types + Validator

**Files:**
- Modify: `src/domains/property/property.types.ts:52-70`
- Modify: `src/domains/property/property.validator.ts:19-52`

**Step 1: Update property.types.ts**

In `CreatePropertyInput`, replace:
```typescript
  storeyRange: string;
  floorAreaSqm: number;
  flatModel: string;
```
with:
```typescript
  level: string;
  unitNumber: string;
  floorAreaSqm: number;
```

In `UpdatePropertyInput`, replace:
```typescript
  storeyRange?: string;
  floorAreaSqm?: number;
  flatModel?: string;
```
with:
```typescript
  level?: string;
  unitNumber?: string;
  floorAreaSqm?: number;
```

**Step 2: Update property.validator.ts**

Replace:
```typescript
  body('storeyRange').trim().notEmpty().withMessage('Storey range is required'),
  body('floorAreaSqm')
    .isFloat({ min: 30, max: 300 })
    .withMessage('Floor area must be between 30 and 300 sqm')
    .toFloat(),
  body('flatModel').trim().notEmpty().withMessage('Flat model is required'),
```
with:
```typescript
  body('level').trim().notEmpty().withMessage('Level is required'),
  body('unitNumber').trim().notEmpty().withMessage('Unit number is required'),
  body('floorAreaSqm')
    .isFloat({ min: 30, max: 300 })
    .withMessage('Floor area must be between 30 and 300 sqm')
    .toFloat(),
```

In `validatePropertyUpdate`, replace:
```typescript
  body('storeyRange').optional().trim().notEmpty(),
  body('floorAreaSqm').optional().isFloat({ min: 30, max: 300 }).toFloat(),
  body('flatModel').optional().trim().notEmpty(),
```
with:
```typescript
  body('level').optional().trim().notEmpty(),
  body('unitNumber').optional().trim().notEmpty(),
  body('floorAreaSqm').optional().isFloat({ min: 30, max: 300 }).toFloat(),
```

**Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: errors only in files not yet updated (property.router.ts etc.) — that's fine, we fix them next.

**Step 4: Commit**

```bash
git add src/domains/property/property.types.ts src/domains/property/property.validator.ts
git commit -m "feat(property): update types and validators for level/unitNumber"
```

---

### Task 3: Property Router

**Files:**
- Modify: `src/domains/property/property.router.ts:77-124`

**Step 1: Update destructuring and usage**

Replace the destructuring block:
```typescript
      const {
        askingPrice,
        town,
        street,
        block,
        flatType,
        storeyRange,
        floorAreaSqm,
        flatModel,
        leaseCommenceDate,
        remainingLease,
      } = req.body as Record<string, string>;
```
with:
```typescript
      const {
        askingPrice,
        town,
        street,
        block,
        flatType,
        level,
        unitNumber,
        floorAreaSqm,
        leaseCommenceDate,
        remainingLease,
      } = req.body as Record<string, string>;
```

Replace the create call fields:
```typescript
          storeyRange: storeyRange ?? '',
          floorAreaSqm: parseFloat(floorAreaSqm ?? '0'),
          flatModel: flatModel ?? '',
```
with:
```typescript
          level: level ?? '',
          unitNumber: unitNumber ?? '',
          floorAreaSqm: parseFloat(floorAreaSqm ?? '0'),
```

Replace the update block lines:
```typescript
        if (storeyRange !== undefined) updateData['storeyRange'] = storeyRange;
        if (floorAreaSqm !== undefined) updateData['floorAreaSqm'] = parseFloat(floorAreaSqm);
        if (flatModel !== undefined) updateData['flatModel'] = flatModel;
```
with:
```typescript
        if (level !== undefined) updateData['level'] = level;
        if (unitNumber !== undefined) updateData['unitNumber'] = unitNumber;
        if (floorAreaSqm !== undefined) updateData['floorAreaSqm'] = parseFloat(floorAreaSqm);
```

**Step 2: Commit**

```bash
git add src/domains/property/property.router.ts
git commit -m "feat(property): update property router for level/unitNumber"
```

---

### Task 4: Portal Formatter

**Files:**
- Modify: `src/domains/property/portal.formatter.ts`

**Step 1: Update PortalContent interface**

In the `flatDetails` object type, replace `storeyRange: string;` with:
```typescript
    unitAddress: string;
```

**Step 2: Update formatForPortal return value**

Replace:
```typescript
      storeyRange: property.storeyRange,
```
with:
```typescript
      unitAddress: `#${property.level}-${property.unitNumber}`,
```

**Step 3: Commit**

```bash
git add src/domains/property/portal.formatter.ts
git commit -m "feat(property): update portal formatter to emit unitAddress"
```

---

### Task 5: Seller Onboarding Router

**Files:**
- Modify: `src/domains/seller/seller.router.ts:165-218`

**Step 1: Update step 2 destructuring**

Replace:
```typescript
        const {
          town,
          street,
          block,
          flatType,
          storeyRange,
          floorAreaSqm,
          flatModel,
          leaseCommenceDate,
        } = req.body;
```
with:
```typescript
        const {
          town,
          street,
          block,
          flatType,
          level,
          unitNumber,
          floorAreaSqm,
          leaseCommenceDate,
        } = req.body;
```

**Step 2: Update validation check**

Replace:
```typescript
        if (
          !town ||
          !street ||
          !block ||
          !flatType ||
          !storeyRange ||
          !floorAreaSqm ||
          !flatModel ||
          !leaseCommenceDate
        ) {
          return res.status(400).render('partials/seller/onboarding-step-2', {
            towns: HDB_TOWNS,
            flatTypes: HDB_FLAT_TYPES,
            error: 'All property fields are required.',
          });
        }
```
with:
```typescript
        if (
          !town ||
          !street ||
          !block ||
          !flatType ||
          !level ||
          !unitNumber ||
          !floorAreaSqm ||
          !leaseCommenceDate
        ) {
          return res.status(400).render('partials/seller/onboarding-step-2', {
            towns: HDB_TOWNS,
            flatTypes: HDB_FLAT_TYPES,
            error: 'All property fields are required.',
          });
        }
```

**Step 3: Update createProperty / updateProperty calls**

Replace:
```typescript
            storeyRange,
            floorAreaSqm: parseFloat(floorAreaSqm),
            flatModel,
```
with:
```typescript
            level,
            unitNumber,
            floorAreaSqm: parseFloat(floorAreaSqm),
```
(applies to both the `updateProperty` and `createProperty` calls in step 2)

**Step 4: Commit**

```bash
git add src/domains/seller/seller.router.ts
git commit -m "feat(property): update onboarding step 2 for level/unitNumber"
```

---

### Task 6: Agent + Admin Types & Services

**Files:**
- Modify: `src/domains/agent/agent.types.ts` (property detail type)
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/admin/admin.types.ts`
- Modify: `src/domains/admin/admin.service.ts`

**Step 1: agent.types.ts**

Find the property sub-type in `SellerDetail` (around line 117). Replace:
```typescript
    storeyRange: string;
    ...
    flatModel: string;
```
with:
```typescript
    level: string;
    unitNumber: string;
```

**Step 2: agent.service.ts**

Around line 114, replace:
```typescript
      storeyRange: property.storeyRange,
      ...
      flatModel: property.flatModel,
```
with:
```typescript
      level: property.level,
      unitNumber: property.unitNumber,
```

**Step 3: admin.types.ts**

Find the property sub-type in seller detail (around line 166). Replace `storeyRange: string;` with:
```typescript
    level: string;
    unitNumber: string;
```

**Step 4: admin.service.ts**

Around line 708, replace:
```typescript
      storeyRange: property.storeyRange,
      ...
      flatModel: property.flatModel,
```
with:
```typescript
      level: property.level,
      unitNumber: property.unitNumber,
```

**Step 5: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.service.ts \
        src/domains/admin/admin.types.ts src/domains/admin/admin.service.ts
git commit -m "feat(property): update agent/admin types and services for level/unitNumber"
```

---

### Task 7: Verification Service Defaults

**Files:**
- Modify: `src/domains/lead/verification.service.ts:36-48`

**Step 1: Update defaults**

Replace:
```typescript
    flatType: 'Unknown',
    storeyRange: 'Unknown',
    floorAreaSqm: 0,
    flatModel: 'Unknown',
```
with:
```typescript
    flatType: 'Unknown',
    level: '',
    unitNumber: '',
    floorAreaSqm: 0,
```

**Step 2: Commit**

```bash
git add src/domains/lead/verification.service.ts
git commit -m "feat(property): update verification service defaults for level/unitNumber"
```

---

### Task 8: Views

**Files:**
- Modify: `src/views/partials/seller/onboarding-step-2.njk:64-116`
- Modify: `src/views/partials/seller/property-form.njk`
- Modify: `src/views/pages/admin/seller-detail.njk`

**Step 1: onboarding-step-2.njk**

Replace the Storey Range field block:
```html
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="storeyRange">{{ "Storey Range" | t }}</label>
        <input
          type="text"
          id="storeyRange"
          name="storeyRange"
          value="{{ property.storeyRange if property else '' }}"
          placeholder="{{ 'e.g. 07 TO 09' | t }}"
          class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
      </div>
```
with:
```html
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="level">{{ "Level" | t }}</label>
        <input
          type="text"
          id="level"
          name="level"
          value="{{ property.level if property else '' }}"
          placeholder="{{ 'e.g. 07' | t }}"
          class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
      </div>
```

Replace the Floor Area block's grid wrapper to add Unit Number alongside Level. Find the grid that contains storeyRange and floorAreaSqm, and update it to:
```html
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="level">{{ "Level" | t }}</label>
        <input type="text" id="level" name="level"
          value="{{ property.level if property else '' }}"
          placeholder="{{ 'e.g. 07' | t }}"
          class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="unitNumber">{{ "Unit Number" | t }}</label>
        <input type="text" id="unitNumber" name="unitNumber"
          value="{{ property.unitNumber if property else '' }}"
          placeholder="{{ 'e.g. 123' | t }}"
          class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
    </div>
```

Remove the entire Flat Model field block (label + input for `flatModel`).

**Step 2: property-form.njk**

Apply the same changes — replace Storey Range with Level + Unit Number (side by side), remove Flat Model.

**Step 3: admin/seller-detail.njk**

Find where `storeyRange` is displayed (around line 60). Replace:
```html
<dd>{{ detail.property.storeyRange }}</dd>
```
with:
```html
<dd>#{{ detail.property.level }}-{{ detail.property.unitNumber }}</dd>
```

**Step 4: Commit**

```bash
git add src/views/partials/seller/onboarding-step-2.njk \
        src/views/partials/seller/property-form.njk \
        src/views/pages/admin/seller-detail.njk
git commit -m "feat(property): update views for level/unitNumber fields"
```

---

### Task 9: Test Factory + Fixtures

**Files:**
- Modify: `tests/fixtures/factory.ts:93-128`
- Modify all test files that reference `storeyRange` or `flatModel` on a **Property** (not HdbTransaction)

**Step 1: Update factory.ts property factory**

In the `property()` function, replace:
```typescript
    storeyRange?: string;
    ...
    flatModel?: string;
```
overrides with:
```typescript
    level?: string;
    unitNumber?: string;
```

And replace the data block:
```typescript
        storeyRange: overrides.storeyRange ?? '07 TO 09',
        floorAreaSqm: overrides.floorAreaSqm ?? 93,
        flatModel: overrides.flatModel ?? 'Model A',
```
with:
```typescript
        level: overrides.level ?? '07',
        unitNumber: overrides.unitNumber ?? '123',
        floorAreaSqm: overrides.floorAreaSqm ?? 93,
```

Note: `hdbTransaction` factory keeps `storeyRange` and `flatModel` — do NOT change those.

**Step 2: Find all test files with Property storeyRange/flatModel references**

```bash
grep -rn "storeyRange\|flatModel" tests/ src/domains --include="*.ts" | grep -v "hdb\|HdbTransaction\|storey_range\|flat_model" | grep -v "node_modules"
```

**Step 3: Update each test file found**

For each file, replace property-level `storeyRange: '...'` with `level: '07'` and `flatModel: '...'` with `unitNumber: '123'`. Skip any HdbTransaction test data.

Key files to update:
- `tests/integration/property.test.ts` — lines 55, 57
- `tests/integration/seller-dashboard.test.ts` — lines 158, 160
- `tests/integration/compliance-sp1.test.ts` — lines 154, 156
- `tests/e2e/content.spec.ts` — lines 207, 209
- `src/domains/property/__tests__/property.service.test.ts`
- `src/domains/property/__tests__/property.router.test.ts`
- `src/domains/property/__tests__/property.repository.test.ts`
- `src/domains/property/__tests__/portal.formatter.test.ts`
- `src/domains/property/__tests__/portal.service.test.ts`
- `src/domains/agent/__tests__/agent.service.test.ts`
- `src/domains/seller/__tests__/seller.router.test.ts`
- `src/domains/admin/__tests__/admin.service.test.ts`

**Step 4: Run unit tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all suites pass.

**Step 5: Run integration tests**

```bash
npm run docker:test:db
npm run test:integration 2>&1 | tail -20
```

Expected: all integration tests pass.

**Step 6: Commit**

```bash
git add tests/ src/domains/
git commit -m "test(property): update test fixtures and tests for level/unitNumber"
```

---

### Task 10: Final Verification

**Step 1: Build**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: 0 TypeScript errors.

**Step 2: Smoke test in browser**

1. Go to `http://localhost:3000/seller/onboarding`
2. Click through step 1 (Welcome)
3. Step 2 shows **Level** and **Unit Number** fields (no Storey Range, no Flat Model)
4. Fill in Level `07`, Unit Number `123`, submit
5. Onboarding advances to step 3

**Step 3: Final commit if any cleanup needed**

```bash
git add -p
git commit -m "chore(property): final cleanup after level/unitNumber migration"
```
