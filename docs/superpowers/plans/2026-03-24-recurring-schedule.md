# Recurring Schedule Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upfront recurring slot pre-generation model with a config-based recurring schedule where `ViewingSlot` rows are only created when a buyer actually books.

**Architecture:** A new `RecurringSchedule` table stores the seller's weekly pattern as JSON. A pure function `generateRecurringWindowsForRange` produces virtual `VirtualSlot` objects on-the-fly. When a buyer books a virtual slot (identified by a `rec:` prefix ID), a `ViewingSlot` row is materialised via `INSERT ON CONFLICT DO NOTHING` before acquiring a `SELECT FOR UPDATE` lock. Manual one-off slots are unchanged.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), Nunjucks, Vanilla JS

---

## File Map

**New:**
- `prisma/migrations/20260324120000_recurring_schedule/migration.sql` — Schema changes
- `src/domains/viewing/recurring.utils.ts` — `generateRecurringWindowsForRange` pure function
- `src/domains/viewing/__tests__/recurring.utils.test.ts` — Unit tests for the above
- `tests/integration/viewing.test.ts` — Integration tests for schedule CRUD + booking flow

**Modified:**
- `prisma/schema.prisma` — `RecurringSchedule` model, `SlotSource` enum, `ViewingSlot.source`, unique constraint
- `src/domains/viewing/viewing.types.ts` — `VirtualSlot`, `SlotSource`, `RecurringScheduleRow` types; `BookingFormInput.propertyId`
- `src/domains/viewing/viewing.repository.ts` — Schedule CRUD + `materialiseRecurringSlot` raw SQL
- `src/domains/viewing/__tests__/viewing.repository.test.ts` — New repo test cases
- `src/domains/viewing/viewing.service.ts` — `getMonthSlotMeta`, `getSlotsForDate`, `getPublicBookingPage`, `initiateBooking`, `cancelSlotsForPropertyCascade`; add `saveSchedule`/`deleteSchedule`; remove `createRecurringSlots`/`getLastUpcomingSlotDate`
- `src/domains/viewing/__tests__/viewing.service.test.ts` — Updated + new service tests
- `src/domains/viewing/viewing.validator.ts` — Remove `propertyId` from recurring validator input; add booking validator update
- `src/domains/viewing/__tests__/viewing.validator.test.ts` — Updated validator tests
- `src/domains/viewing/viewing.router.ts` — New `POST/DELETE /seller/viewings/schedule`; remove old recurring route; update GET to load schedule; remove expiry fields
- `src/domains/viewing/__tests__/viewing.router.test.ts` — New route tests
- `src/views/pages/seller/viewings.njk` — Remove expiry nudge banner
- `src/views/partials/seller/viewings-dashboard.njk` — Pre-populate form from saved schedule; update button label
- `public/js/app.js` — Update fetch URL to `/seller/viewings/schedule`; remove expiry-related JS; pre-populate UI from schedule data

---

## Migration Note

**IMPORTANT:** `prisma migrate dev` is blocked by session table drift. Always use the shadow DB approach documented in `MEMORY.md`:
1. Create shadow DB
2. Use `prisma migrate diff` to generate SQL
3. Save manually under `prisma/migrations/YYYYMMDDHHMMSS_name/migration.sql`
4. Run `npx prisma migrate deploy`
5. Run `npx prisma generate`
6. Drop shadow DB

The migration name for this feature: `20260324120000_recurring_schedule`

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260324120000_recurring_schedule/migration.sql`

### Schema changes

- [ ] **Step 1: Update `prisma/schema.prisma`**

Add `SlotSource` enum after the existing `SlotType` enum (search for `enum SlotType`):

```prisma
enum SlotSource {
  manual
  recurring
}
```

Add `source` field and unique constraint to `ViewingSlot` model. Current model ends with:
```prisma
  @@index([propertyId, date, status])
  @@map("viewing_slots")
```
Change to:
```prisma
  source    SlotSource @default(manual)

  @@unique([propertyId, date, startTime, endTime])
  @@index([propertyId, date, status])
  @@map("viewing_slots")
```

Add `RecurringSchedule` model after the `ViewingSlot` model:

```prisma
model RecurringSchedule {
  id         String   @id
  propertyId String   @unique @map("property_id")
  days       Json
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  property Property @relation(fields: [propertyId], references: [id])

  @@map("recurring_schedules")
}
```

Add back-relation to `Property` model (search for `viewingSlots ViewingSlot[]` in the Property model and add after it):
```prisma
  recurringSchedule RecurringSchedule?
```

- [ ] **Step 2: Create migration SQL**

Create directory: `prisma/migrations/20260324120000_recurring_schedule/`

Write `migration.sql`:

```sql
-- Create SlotSource enum
CREATE TYPE "SlotSource" AS ENUM ('manual', 'recurring');

-- Add source column to viewing_slots with default manual
ALTER TABLE "viewing_slots" ADD COLUMN "source" "SlotSource" NOT NULL DEFAULT 'manual';

-- Deduplication: keep lowest ctid per (property_id, date, start_time, end_time)
-- Required before adding unique constraint to avoid conflicts
DELETE FROM viewing_slots
WHERE id NOT IN (
  SELECT DISTINCT ON (property_id, date, start_time, end_time) id
  FROM viewing_slots
  ORDER BY property_id, date, start_time, end_time, ctid
);

-- Add unique constraint enabling ON CONFLICT DO NOTHING in booking flow
ALTER TABLE "viewing_slots"
  ADD CONSTRAINT "viewing_slots_property_date_start_end_unique"
  UNIQUE ("property_id", "date", "start_time", "end_time");

-- Create recurring_schedules table
CREATE TABLE "recurring_schedules" (
  "id" TEXT NOT NULL,
  "property_id" TEXT NOT NULL,
  "days" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_schedules_property_id_key" ON "recurring_schedules"("property_id");

ALTER TABLE "recurring_schedules"
  ADD CONSTRAINT "recurring_schedules_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Run migration using shadow DB approach**

```bash
# Start dev DB if not running
npm run docker:dev

# Create shadow DB
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"

# Generate diff SQL (compare with what you wrote above — should match)
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" \
  --script

# Deploy migration
npx prisma migrate deploy

# Regenerate Prisma client
npx prisma generate

# Drop shadow DB
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

Expected: migration applies successfully, `prisma generate` runs without errors.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors. The new `SlotSource` enum and `RecurringSchedule` type are now available from `@prisma/client`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260324120000_recurring_schedule/
git commit -m "feat(db): add RecurringSchedule table, SlotSource enum, ViewingSlot unique constraint"
```

---

## Task 2: Types + Pure Utility Function

**Files:**
- Modify: `src/domains/viewing/viewing.types.ts`
- Create: `src/domains/viewing/recurring.utils.ts`
- Create: `src/domains/viewing/__tests__/recurring.utils.test.ts`

- [ ] **Step 1: Write the failing unit tests first**

Create `src/domains/viewing/__tests__/recurring.utils.test.ts`:

```typescript
import { generateRecurringWindowsForRange } from '../recurring.utils';
import type { RecurringScheduleRow } from '../viewing.types';

function makeSchedule(days: RecurringScheduleRow['days']): RecurringScheduleRow {
  return {
    id: 'sched-1',
    propertyId: 'prop-1',
    days,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('generateRecurringWindowsForRange', () => {
  // Monday 2026-03-23 is a Monday (dayOfWeek=1)
  const monday = new Date('2026-03-23T00:00:00.000Z');
  const tuesday = new Date('2026-03-24T00:00:00.000Z');

  it('returns empty array for empty schedule', () => {
    const schedule = makeSchedule([]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toEqual([]);
  });

  it('returns empty array when no day matches', () => {
    // Schedule only has Sunday (0), but range is Monday
    const schedule = makeSchedule([
      { dayOfWeek: 0, timeslots: [{ startTime: '10:00', endTime: '12:00', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toEqual([]);
  });

  it('generates 15-min sub-windows for single slot type', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(4); // 18:00-18:15, 18:15-18:30, 18:30-18:45, 18:45-19:00
    expect(result[0]).toMatchObject({
      id: 'rec:2026-03-23:18:00:18:15',
      startTime: '18:00',
      endTime: '18:15',
      slotType: 'single',
      maxViewers: 1,
    });
    expect(result[3]).toMatchObject({
      id: 'rec:2026-03-23:18:45:19:00',
      startTime: '18:45',
      endTime: '19:00',
    });
  });

  it('generates one window spanning full range for group slot type', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '14:00', endTime: '17:00', slotType: 'group' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'rec:2026-03-23:14:00:17:00',
      startTime: '14:00',
      endTime: '17:00',
      slotType: 'group',
    });
    expect(result[0].maxViewers).toBeGreaterThan(1); // calcOpenHouseMaxViewers result
  });

  it('generates windows across multiple days in range', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:30', slotType: 'single' }] },
      { dayOfWeek: 2, timeslots: [{ startTime: '18:00', endTime: '18:30', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, tuesday);
    // 2 sub-windows per day × 2 days = 4 total
    expect(result).toHaveLength(4);
    expect(result[0].id).toMatch(/^rec:2026-03-23:/);
    expect(result[2].id).toMatch(/^rec:2026-03-24:/);
  });

  it('handles multiple timeslots per day', () => {
    const schedule = makeSchedule([
      {
        dayOfWeek: 1,
        timeslots: [
          { startTime: '10:00', endTime: '10:30', slotType: 'single' },
          { startTime: '18:00', endTime: '18:30', slotType: 'single' },
        ],
      },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(4); // 2 per timeslot × 2 timeslots
  });

  it('date field on each virtual slot is midnight UTC', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result[0].date.getUTCHours()).toBe(0);
    expect(result[0].date.getUTCMinutes()).toBe(0);
  });

  it('respects exact range boundaries (inclusive)', () => {
    const endOfMonday = new Date('2026-03-23T23:59:59.000Z');
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '23:00', endTime: '23:15', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, endOfMonday);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest recurring.utils.test --no-coverage
```

Expected: FAIL — `Cannot find module '../recurring.utils'`

- [ ] **Step 3: Add types to `viewing.types.ts`**

At the end of `viewing.types.ts`, before the constants section, add:

```typescript
// ─── Schedule Types ────────────────────────────────────────

export type SlotSource = 'manual' | 'recurring';

export interface VirtualSlot {
  id: string; // 'rec:{YYYY-MM-DD}:{HH:MM}:{HH:MM}'
  date: Date;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  slotType: 'single' | 'group';
  maxViewers: number;
}

export interface RecurringScheduleRow {
  id: string;
  propertyId: string;
  days: unknown; // RecurringDayConfig[] at runtime — cast before use
  createdAt: Date;
  updatedAt: Date;
}
```

Also add `propertyId` to `BookingFormInput`:

```typescript
export interface BookingFormInput {
  name: string;
  phone: string;
  viewerType: 'buyer' | 'agent';
  agentName?: string;
  agentCeaReg?: string;
  agentAgencyName?: string;
  consentService: boolean;
  slotId: string;
  propertyId?: string; // Required for rec: IDs; resolved server-side from property slug
  // Anti-spam
  website?: string;
  formLoadedAt?: number;
}
```

- [ ] **Step 4: Create `recurring.utils.ts`**

Create `src/domains/viewing/recurring.utils.ts`:

```typescript
import { calcOpenHouseMaxViewers } from './viewing.validator';
import type { RecurringScheduleRow, VirtualSlot, RecurringDayConfig } from './viewing.types';

/**
 * Pure function. No DB access.
 * Given a RecurringSchedule and a date range (inclusive), returns all virtual slot windows.
 *
 * - single slots: generate 15-minute sub-windows
 * - group slots: one window spanning the full startTime–endTime
 *
 * Dates are handled in UTC to avoid timezone drift (the app stores dates as UTC midnight).
 */
export function generateRecurringWindowsForRange(
  schedule: RecurringScheduleRow,
  startDate: Date,
  endDate: Date,
): VirtualSlot[] {
  const results: VirtualSlot[] = [];
  const days = schedule.days as RecurringDayConfig[];

  // Iterate day by day across the range
  const cur = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ));
  const end = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
    23, 59, 59, 999,
  ));

  while (cur <= end) {
    const dow = cur.getUTCDay();
    const dateStr = cur.toISOString().split('T')[0]; // YYYY-MM-DD

    const dayConfig = days.find((d) => d.dayOfWeek === dow);
    if (dayConfig) {
      for (const ts of dayConfig.timeslots) {
        const slotDate = new Date(cur); // copy of midnight UTC date

        if (ts.slotType === 'group') {
          results.push({
            id: `rec:${dateStr}:${ts.startTime}:${ts.endTime}`,
            date: slotDate,
            startTime: ts.startTime,
            endTime: ts.endTime,
            slotType: 'group',
            maxViewers: calcOpenHouseMaxViewers(ts.startTime, ts.endTime),
          });
        } else {
          // single: generate 15-minute sub-windows
          const [sh, sm] = ts.startTime.split(':').map(Number);
          const [eh, em] = ts.endTime.split(':').map(Number);
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;

          for (let t = startMinutes; t + 15 <= endMinutes; t += 15) {
            const subStart = toHHMM(t);
            const subEnd = toHHMM(t + 15);
            results.push({
              id: `rec:${dateStr}:${subStart}:${subEnd}`,
              date: new Date(slotDate),
              startTime: subStart,
              endTime: subEnd,
              slotType: 'single',
              maxViewers: 1,
            });
          }
        }
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return results;
}

function toHHMM(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest recurring.utils.test --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 6: Run full unit test suite**

```bash
npm test
```

Expected: all tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/domains/viewing/viewing.types.ts \
        src/domains/viewing/recurring.utils.ts \
        src/domains/viewing/__tests__/recurring.utils.test.ts
git commit -m "feat(viewing): add VirtualSlot types and generateRecurringWindowsForRange pure function"
```

---

## Task 3: Repository Layer

**Files:**
- Modify: `src/domains/viewing/viewing.repository.ts`
- Modify: `src/domains/viewing/__tests__/viewing.repository.test.ts`

- [ ] **Step 1: Write failing tests for new repository functions**

Add the following test cases to `viewing.repository.test.ts`. Find the `describe('viewing repository')` block (or the file's top level) and add:

```typescript
// At top of file, add to existing mocks:
// prisma.recurringSchedule is already mocked if using the standard prisma mock setup

describe('findRecurringSchedule', () => {
  it('returns schedule for property', async () => {
    const schedule = { id: 's1', propertyId: 'p1', days: [], createdAt: new Date(), updatedAt: new Date() };
    mockPrisma.recurringSchedule.findUnique.mockResolvedValue(schedule);
    const result = await viewingRepo.findRecurringSchedule('p1');
    expect(mockPrisma.recurringSchedule.findUnique).toHaveBeenCalledWith({
      where: { propertyId: 'p1' },
    });
    expect(result).toEqual(schedule);
  });

  it('returns null when no schedule exists', async () => {
    mockPrisma.recurringSchedule.findUnique.mockResolvedValue(null);
    const result = await viewingRepo.findRecurringSchedule('p1');
    expect(result).toBeNull();
  });
});

describe('upsertRecurringSchedule', () => {
  it('upserts schedule with given days', async () => {
    const days = [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }] }];
    const schedule = { id: 's1', propertyId: 'p1', days, createdAt: new Date(), updatedAt: new Date() };
    mockPrisma.recurringSchedule.upsert.mockResolvedValue(schedule);

    await viewingRepo.upsertRecurringSchedule('p1', 's1', days);

    expect(mockPrisma.recurringSchedule.upsert).toHaveBeenCalledWith({
      where: { propertyId: 'p1' },
      update: { days },
      create: { id: 's1', propertyId: 'p1', days },
    });
  });
});

describe('deleteRecurringSchedule', () => {
  it('deletes schedule for property (no-op if not found)', async () => {
    mockPrisma.recurringSchedule.deleteMany.mockResolvedValue({ count: 1 });
    await viewingRepo.deleteRecurringSchedule('p1');
    expect(mockPrisma.recurringSchedule.deleteMany).toHaveBeenCalledWith({
      where: { propertyId: 'p1' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest viewing.repository.test --no-coverage
```

Expected: FAIL — functions do not exist yet.

- [ ] **Step 3: Add new repository functions**

At the end of `viewing.repository.ts`, before the `// ─── Bookings ────` section, add:

```typescript
// ─── Recurring Schedule ───────────────────────────────────

export async function findRecurringSchedule(propertyId: string) {
  return prisma.recurringSchedule.findUnique({ where: { propertyId } });
}

export async function upsertRecurringSchedule(
  propertyId: string,
  id: string,
  days: unknown,
) {
  return prisma.recurringSchedule.upsert({
    where: { propertyId },
    update: { days },
    create: { id, propertyId, days },
  });
}

export async function deleteRecurringSchedule(propertyId: string) {
  // deleteMany is safe when row may not exist (no error on 0 rows)
  return prisma.recurringSchedule.deleteMany({ where: { propertyId } });
}
```

Also add `materialiseRecurringSlot` after the schedule CRUD block. **This uses raw SQL because Prisma ORM does not support `ON CONFLICT DO NOTHING`.**

```typescript
/**
 * Materialises a virtual recurring slot as a real ViewingSlot row.
 * Uses INSERT ON CONFLICT DO NOTHING so concurrent bookings are safe.
 * Returns the UUID of the now-existing row (either the newly inserted one
 * or the pre-existing one if another request won the race).
 */
export async function materialiseRecurringSlot(data: {
  propertyId: string;
  date: Date;
  startTime: string;
  endTime: string;
  slotType: 'single' | 'group';
  maxViewers: number;
  durationMinutes: number;
  id: string; // cuid2 pre-generated by caller
}): Promise<string> {
  await prisma.$executeRaw`
    INSERT INTO viewing_slots
      (id, property_id, date, start_time, end_time,
       duration_minutes, slot_type, max_viewers, current_bookings,
       status, source, created_at)
    VALUES
      (${data.id}, ${data.propertyId}, ${data.date}, ${data.startTime}, ${data.endTime},
       ${data.durationMinutes}, ${data.slotType}::"SlotType", ${data.maxViewers}, 0,
       'available'::"SlotStatus", 'recurring'::"SlotSource", NOW())
    ON CONFLICT (property_id, date, start_time, end_time) DO NOTHING
  `;

  // Fetch actual UUID — may differ from data.id if another request inserted first
  const existing = await prisma.viewingSlot.findFirst({
    where: {
      propertyId: data.propertyId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
    },
    select: { id: true },
  });

  if (!existing) {
    throw new Error(
      `materialiseRecurringSlot: row missing after insert for ${data.propertyId} ${data.startTime}`,
    );
  }

  return existing.id;
}
```

- [ ] **Step 4: Run repository tests to verify they pass**

```bash
npx jest viewing.repository.test --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/domains/viewing/viewing.repository.ts \
        src/domains/viewing/__tests__/viewing.repository.test.ts
git commit -m "feat(viewing): add recurring schedule repository functions and materialiseRecurringSlot raw SQL"
```

---

## Task 4: Service Layer

**Files:**
- Modify: `src/domains/viewing/viewing.service.ts`
- Modify: `src/domains/viewing/__tests__/viewing.service.test.ts`

This is the largest task. Work through it one function at a time.

### 4a — Add `saveSchedule` and `deleteSchedule`

- [ ] **Step 1: Write failing tests for `saveSchedule` and `deleteSchedule`**

Add to `viewing.service.test.ts`:

```typescript
describe('saveSchedule', () => {
  it('resolves propertyId from seller and upserts schedule', async () => {
    const days = [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' as const }] }];
    mockPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'prop-1' });
    mockViewingRepo.upsertRecurringSchedule.mockResolvedValue({ id: 'sched-1', propertyId: 'prop-1', days, createdAt: new Date(), updatedAt: new Date() });

    const result = await viewingService.saveSchedule(days, 'seller-1');

    expect(mockViewingRepo.upsertRecurringSchedule).toHaveBeenCalledWith(
      'prop-1',
      expect.any(String), // cuid2
      days,
    );
    expect(result).toMatchObject({ propertyId: 'prop-1' });
  });

  it('throws NotFoundError if seller has no active property', async () => {
    mockPropertyService.getPropertyForSeller.mockResolvedValue(null);
    await expect(viewingService.saveSchedule([], 'seller-1')).rejects.toThrow(NotFoundError);
  });
});

describe('deleteSchedule', () => {
  it('resolves propertyId from seller and deletes schedule', async () => {
    mockPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'prop-1' });
    mockViewingRepo.deleteRecurringSchedule.mockResolvedValue({ count: 1 });

    await viewingService.deleteSchedule('seller-1');

    expect(mockViewingRepo.deleteRecurringSchedule).toHaveBeenCalledWith('prop-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest viewing.service.test --no-coverage -t "saveSchedule|deleteSchedule"
```

Expected: FAIL — functions do not exist yet.

- [ ] **Step 3: Implement `saveSchedule` and `deleteSchedule`**

In `viewing.service.ts`, add the following near the top of the "Slot Management" section (after existing imports). First, ensure `propertyService` is imported (check if it already is; if not, add `import * as propertyService from '@/domains/property/property.service';`).

Add after the existing recurring slots functions (or where `createRecurringSlots` currently lives):

```typescript
export async function saveSchedule(days: RecurringDayConfig[], sellerId: string) {
  const property = await propertyService.getPropertyForSeller(sellerId);
  if (!property) throw new NotFoundError('Property', sellerId);
  const propertyId = (property as { id: string }).id;

  return viewingRepo.upsertRecurringSchedule(propertyId, createId(), days);
}

export async function deleteSchedule(sellerId: string) {
  const property = await propertyService.getPropertyForSeller(sellerId);
  if (!property) throw new NotFoundError('Property', sellerId);
  const propertyId = (property as { id: string }).id;

  return viewingRepo.deleteRecurringSchedule(propertyId);
}
```

Add the `RecurringDayConfig` type to the service imports from `./viewing.types`.

- [ ] **Step 4: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "saveSchedule|deleteSchedule"
```

Expected: PASS.

### 4b — Remove `createRecurringSlots` and `getLastUpcomingSlotDate`

- [ ] **Step 5: Remove old functions and their tests**

In `viewing.service.ts`:
- Delete the entire `createRecurringSlots` function
- Delete the entire `getLastUpcomingSlotDate` function

In `viewing.repository.ts`:
- Delete the `findLastUpcomingSlot` function

In `viewing.service.test.ts`:
- Delete all test cases for `createRecurringSlots`
- Delete all test cases for `getLastUpcomingSlotDate`

In `viewing.repository.test.ts`:
- Delete all test cases for `findLastUpcomingSlot`

- [ ] **Step 6: Run tests to verify nothing breaks**

```bash
npm test
```

Expected: all tests pass (removed tests, no regressions).

### 4c — Update `cancelSlotsForPropertyCascade`

- [ ] **Step 7: Write failing test**

In `viewing.service.test.ts`, find the `cancelSlotsForPropertyCascade` test suite and add:

```typescript
it('deletes recurring schedule for property on cascade cancel', async () => {
  mockViewingRepo.findActiveSlotsByPropertyId.mockResolvedValue([]);
  mockViewingRepo.deleteRecurringSchedule.mockResolvedValue({ count: 0 });

  await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

  expect(mockViewingRepo.deleteRecurringSchedule).toHaveBeenCalledWith('prop-1');
});
```

- [ ] **Step 8: Implement the change**

At the end of `cancelSlotsForPropertyCascade` in `viewing.service.ts`, after all existing logic (the for-loop over slots and the audit log call that follows it), append:

```typescript
// Delete recurring schedule so no virtual windows are generated for a cancelled property
await viewingRepo.deleteRecurringSchedule(propertyId);
```

To find the correct location: search for `cancelSlotsForPropertyCascade` in the service file. The function ends with an audit log `auditService.log(...)` call. Add the `deleteRecurringSchedule` call on the very next line after that call, before the closing brace of the function.

- [ ] **Step 9: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "cancelSlotsForPropertyCascade"
```

Expected: PASS.

### 4d — Rewrite `getMonthSlotMeta` and `getSlotsForDate`

- [ ] **Step 10: Write failing tests for `getMonthSlotMeta`**

Add to `viewing.service.test.ts`:

```typescript
describe('getMonthSlotMeta — with recurring schedule', () => {
  const virtualSlot = {
    id: 'rec:2026-03-23:18:00:18:15',
    date: new Date('2026-03-23T00:00:00.000Z'),
    startTime: '18:00',
    endTime: '18:15',
    slotType: 'single' as const,
    maxViewers: 1,
  };

  beforeEach(() => {
    mockPropertyRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' });
    mockViewingRepo.findRecurringSchedule.mockResolvedValue({
      id: 'sched-1',
      propertyId: 'prop-1',
      days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }] }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('counts virtual slot as available when no real slot exists', async () => {
    mockViewingRepo.findSlotsByPropertyAndMonth.mockResolvedValue([]);

    const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

    expect(result['2026-03-23']).toEqual({ available: 1, full: 0 });
  });

  it('uses real slot status when materialised slot exists', async () => {
    mockViewingRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
      {
        id: 'uuid-1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        status: 'full',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 1,
      },
    ]);

    const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

    expect(result['2026-03-23']).toEqual({ available: 0, full: 1 });
  });

  it('includes manual slot not covered by schedule', async () => {
    mockViewingRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
      {
        id: 'uuid-manual',
        date: new Date('2026-03-25T00:00:00.000Z'), // Wednesday — not in schedule
        startTime: '10:00',
        endTime: '10:15',
        status: 'available',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 0,
      },
    ]);

    const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

    expect(result['2026-03-25']).toEqual({ available: 1, full: 0 });
    expect(result['2026-03-23']).toEqual({ available: 1, full: 0 }); // virtual still counted
  });

  it('returns empty object when no schedule and no slots', async () => {
    mockViewingRepo.findRecurringSchedule.mockResolvedValue(null);
    mockViewingRepo.findSlotsByPropertyAndMonth.mockResolvedValue([]);

    const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

    expect(result).toEqual({});
  });
});
```

- [ ] **Step 11: Run tests to verify they fail**

```bash
npx jest viewing.service.test --no-coverage -t "getMonthSlotMeta"
```

Expected: FAIL.

- [ ] **Step 12: Rewrite `getMonthSlotMeta`**

Find the existing `getMonthSlotMeta` function in `viewing.service.ts` and replace its body with:

```typescript
export async function getMonthSlotMeta(
  propertyId: string,
  year: number,
  month: number,
  sellerId: string,
): Promise<Record<string, { available: number; full: number }>> {
  await verifyPropertyOwnership(propertyId, sellerId);

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0)); // last day of month

  // Load virtual windows from schedule
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, startDate, endDate)
    : [];

  // Load real slots for the month
  const realSlots = await viewingRepo.findSlotsByPropertyAndMonth(propertyId, year, month);

  // Build lookup: "date:startTime:endTime" → real slot status
  const realSlotMap = new Map<string, string>();
  for (const s of realSlots as { date: Date; startTime: string; endTime: string; status: string }[]) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    realSlotMap.set(key, s.status);
  }

  const meta: Record<string, { available: number; full: number }> = {};
  const processedKeys = new Set<string>();

  // Process virtual slots (may be overridden by real slots)
  for (const vs of virtualSlots) {
    const dateStr = vs.date.toISOString().split('T')[0];
    const key = `${dateStr}:${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);

    const status = realSlotMap.get(key) ?? 'available';
    if (status === 'cancelled') continue;

    if (!meta[dateStr]) meta[dateStr] = { available: 0, full: 0 };
    if (status === 'full') {
      meta[dateStr].full++;
    } else {
      meta[dateStr].available++;
    }
  }

  // Process manual/materialised real slots NOT covered by a virtual window
  for (const s of realSlots as { date: Date; startTime: string; endTime: string; status: string }[]) {
    const dateStr = s.date.toISOString().split('T')[0];
    const key = `${dateStr}:${s.startTime}:${s.endTime}`;
    if (processedKeys.has(key)) continue; // already counted via virtual slot

    if (s.status === 'cancelled') continue;
    if (!meta[dateStr]) meta[dateStr] = { available: 0, full: 0 };
    if (s.status === 'full') {
      meta[dateStr].full++;
    } else {
      meta[dateStr].available++;
    }
  }

  return meta;
}
```

Add this import at the top of the service file:
```typescript
import { generateRecurringWindowsForRange } from './recurring.utils';
```

- [ ] **Step 13: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "getMonthSlotMeta"
```

Expected: PASS.

- [ ] **Step 14: Write failing tests for `getSlotsForDate`**

Add to `viewing.service.test.ts`:

```typescript
describe('getSlotsForDate — with recurring schedule', () => {
  beforeEach(() => {
    mockPropertyRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' });
    mockViewingRepo.findRecurringSchedule.mockResolvedValue({
      id: 'sched-1',
      propertyId: 'prop-1',
      days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }] }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockViewingRepo.findSlotsByPropertyAndDate.mockResolvedValue([]);
  });

  it('includes virtual slots in merged list passed to findNextAvailableGap', async () => {
    const result = await viewingService.getSlotsForDate('prop-1', '2026-03-23', 'seller-1');
    // 18:00-19:00 single = 4 × 15-min sub-windows
    expect(result.slots.length).toBeGreaterThanOrEqual(4);
    // Virtual slots use rec: IDs
    expect(result.slots.some((s: { id: string }) => s.id.startsWith('rec:'))).toBe(true);
  });

  it('suppresses virtual slot when real slot exists for same window', async () => {
    mockViewingRepo.findSlotsByPropertyAndDate.mockResolvedValue([
      {
        id: 'uuid-1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        status: 'booked',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 1,
      },
    ]);

    const result = await viewingService.getSlotsForDate('prop-1', '2026-03-23', 'seller-1');
    const slot1815 = result.slots.find(
      (s: { startTime: string }) => s.startTime === '18:00',
    );
    // Should use UUID, not rec: ID
    expect(slot1815?.id).toBe('uuid-1');
  });
});
```

- [ ] **Step 15: Run tests to verify they fail**

```bash
npx jest viewing.service.test --no-coverage -t "getSlotsForDate"
```

Expected: FAIL.

- [ ] **Step 16: Rewrite `getSlotsForDate`**

Find the existing `getSlotsForDate` function and replace its body. The function should:
1. Verify ownership
2. Load recurring schedule for the day
3. Generate virtual slots for that single date
4. Load real slots for the date
5. Merge: real slots suppress virtual slots with matching (startTime, endTime)
6. Pass merged list to `findNextAvailableGap`

```typescript
export async function getSlotsForDate(propertyId: string, dateStr: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);

  const date = new Date(dateStr + 'T00:00:00.000Z');

  // Load and merge virtual + real slots for this date
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, date, date)
    : [];

  const realSlots = await viewingRepo.findSlotsByPropertyAndDate(propertyId, date);

  // Build real slot lookup by (startTime, endTime)
  const realSlotMap = new Map<
    string,
    { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }
  >();
  for (const s of realSlots as { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }[]) {
    realSlotMap.set(`${s.startTime}:${s.endTime}`, s);
  }

  // Merged slot list for the day
  const mergedSlots: { id: string; date: Date; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }[] = [];
  const processedKeys = new Set<string>();

  for (const vs of virtualSlots) {
    const key = `${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);
    const real = realSlotMap.get(key);
    if (real) {
      mergedSlots.push({ ...real, date });
    } else {
      mergedSlots.push({ id: vs.id, date: vs.date, startTime: vs.startTime, endTime: vs.endTime, status: 'available', slotType: vs.slotType, maxViewers: vs.maxViewers, currentBookings: 0 });
    }
  }

  // Add real slots not covered by virtual windows
  for (const s of realSlots as { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number; date: Date }[]) {
    const key = `${s.startTime}:${s.endTime}`;
    if (!processedKeys.has(key)) {
      mergedSlots.push({ ...s, date });
    }
  }

  // Sort by startTime
  mergedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const nextGap = findNextAvailableGap(mergedSlots, date);

  return { slots: mergedSlots, date, nextGap };
}
```

**Note:** You may need to check the existing `findSlotsByPropertyAndDate` repository function. If it doesn't exist by that name (the current repo may use `findSlotsByPropertyAndDateRange` for a range), add it to the repository:

```typescript
// In viewing.repository.ts
export async function findSlotsByPropertyAndDate(propertyId: string, date: Date) {
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      date,
      status: { not: 'cancelled' as SlotStatus },
    },
    orderBy: { startTime: 'asc' },
  });
}
```

- [ ] **Step 17: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "getSlotsForDate"
```

Expected: PASS.

### 4e — Update `initiateBooking` for `rec:` IDs

- [ ] **Step 18: Write failing tests for `rec:` booking path**

Add to `viewing.service.test.ts`:

```typescript
describe('initiateBooking — recurring slot', () => {
  const recSlotId = 'rec:2026-03-23:18:00:18:15';

  beforeEach(() => {
    // Mock spam checks to pass
    mockViewingRepo.findDuplicateBooking.mockResolvedValue(null);
    mockViewingRepo.countBookingsToday.mockResolvedValue(0);
    mockViewingRepo.findVerifiedViewerByPhone.mockResolvedValue(null);
    mockSettingsService.getNumber.mockResolvedValue(30);
    mockViewingRepo.createVerifiedViewer.mockResolvedValue({ id: 'viewer-1', noShowCount: 0, phoneVerifiedAt: null });
    mockViewingRepo.countOtpRequestsThisHour.mockResolvedValue(0);
    mockNotificationService.send.mockResolvedValue(undefined);
    mockViewingRepo.createViewingWithLock.mockResolvedValue({ id: 'viewing-1' });
    mockViewingRepo.findViewingById.mockResolvedValue(null);

    // Schedule mock
    mockViewingRepo.findRecurringSchedule.mockResolvedValue({
      id: 'sched-1',
      propertyId: 'prop-1',
      days: [{
        dayOfWeek: 1, // Monday
        timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }],
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Materialise returns a UUID
    mockViewingRepo.materialiseRecurringSlot.mockResolvedValue('uuid-materialised');
    // findSlotById is called with the resolved UUID
    mockViewingRepo.findSlotById.mockResolvedValue({
      id: 'uuid-materialised',
      propertyId: 'prop-1',
      date: new Date('2026-03-23T00:00:00.000Z'),
      startTime: '18:00',
    });
  });

  it('materialises slot and uses UUID for duplicate check', async () => {
    await viewingService.initiateBooking(
      {
        name: 'Test',
        phone: '91234567',
        viewerType: 'buyer',
        consentService: true,
        slotId: recSlotId,
        propertyId: 'prop-1',
      },
      {},
    );

    expect(mockViewingRepo.materialiseRecurringSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'prop-1',
        startTime: '18:00',
        endTime: '18:15',
        slotType: 'single',
        maxViewers: 1,
      }),
    );

    // Duplicate check uses materialised UUID, not rec: ID
    expect(mockViewingRepo.findDuplicateBooking).toHaveBeenCalledWith(
      '91234567',
      'uuid-materialised',
    );

    // createViewingWithLock also uses UUID
    expect(mockViewingRepo.createViewingWithLock).toHaveBeenCalledWith(
      expect.objectContaining({ viewingSlotId: 'uuid-materialised' }),
    );
  });

  it('throws ValidationError for rec: ID with window not in schedule', async () => {
    await expect(
      viewingService.initiateBooking(
        {
          name: 'Test',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: true,
          slotId: 'rec:2026-03-22:18:00:18:15', // Sunday, not in schedule
          propertyId: 'prop-1',
        },
        {},
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError if no recurring schedule exists', async () => {
    mockViewingRepo.findRecurringSchedule.mockResolvedValue(null);
    await expect(
      viewingService.initiateBooking(
        {
          name: 'Test',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: true,
          slotId: recSlotId,
          propertyId: 'prop-1',
        },
        {},
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 19: Run tests to verify they fail**

```bash
npx jest viewing.service.test --no-coverage -t "initiateBooking — recurring"
```

Expected: FAIL.

- [ ] **Step 20: Update `initiateBooking` in `viewing.service.ts`**

At the start of the `initiateBooking` function, after spam checks and before the `findDuplicateBooking` call, add the `rec:` resolution block:

```typescript
// ─── Resolve rec: virtual slot to a materialised UUID ──────
let resolvedSlotId = input.slotId;

if (input.slotId.startsWith('rec:')) {
  const parts = input.slotId.split(':');
  // Format: rec:YYYY-MM-DD:HH:MM:HH:MM
  // YYYY-MM-DD uses hyphens, so split(':') yields exactly 6 parts:
  // ["rec", "2026-03-23", "18", "00", "18", "15"]
  // parts[0]="rec", parts[1]="2026-03-23", parts[2]="18", parts[3]="00", parts[4]="18", parts[5]="15"
  const dateStr = parts[1];
  const startTime = `${parts[2]}:${parts[3]}`;
  const endTime = `${parts[4]}:${parts[5]}`;
  const slotDate = new Date(dateStr + 'T00:00:00.000Z');

  if (!input.propertyId) {
    throw new ValidationError('propertyId is required for recurring slot bookings');
  }

  const schedule = await viewingRepo.findRecurringSchedule(input.propertyId);
  if (!schedule) throw new NotFoundError('RecurringSchedule', input.propertyId);

  // Verify this exact window is in the schedule (prevents arbitrary slot fabrication)
  const windows = generateRecurringWindowsForRange(schedule, slotDate, slotDate);
  const window = windows.find((w) => w.startTime === startTime && w.endTime === endTime);
  if (!window) {
    throw new ValidationError('Requested slot is not in the recurring schedule');
  }

  // Materialise the slot row (INSERT ON CONFLICT DO NOTHING + fetch UUID)
  resolvedSlotId = await viewingRepo.materialiseRecurringSlot({
    id: createId(),
    propertyId: input.propertyId,
    date: slotDate,
    startTime,
    endTime,
    slotType: window.slotType,
    maxViewers: window.maxViewers,
    durationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
  });
}
```

Then update the `findDuplicateBooking` call (line ~469) to use `resolvedSlotId`:

```typescript
const duplicate = await viewingRepo.findDuplicateBooking(input.phone, resolvedSlotId);
```

Update the `findSlotById` call (line ~547):
```typescript
const slot = await viewingRepo.findSlotById(resolvedSlotId);
if (!slot) throw new NotFoundError('ViewingSlot', resolvedSlotId);
```

Update the `createViewingWithLock` call:
```typescript
const viewing = await viewingRepo.createViewingWithLock({
  id: createId(),
  propertyId: slotData.propertyId,
  viewingSlotId: resolvedSlotId,  // ← was input.slotId
  ...
```

- [ ] **Step 21: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "initiateBooking"
```

Expected: all initiateBooking tests PASS.

### 4f — Rewrite `getPublicBookingPage` (buyer-facing merge logic)

The public booking page must return a unified slot list: virtual recurring windows + manual `ViewingSlot` rows. Manual slots suppress matching virtual windows (precedence rule).

- [ ] **Step 22: Write failing tests for `getPublicBookingPage`**

Add to `viewing.service.test.ts`:

```typescript
describe('getPublicBookingPage — with recurring schedule', () => {
  const propertySlug = 'test-slug';

  beforeEach(() => {
    mockViewingRepo.findPropertyBySlug.mockResolvedValue({
      id: 'prop-1',
      slug: propertySlug,
      // ... other required fields
    });
    mockViewingRepo.findRecurringSchedule.mockResolvedValue({
      id: 'sched-1',
      propertyId: 'prop-1',
      days: [{
        dayOfWeek: 1, // Monday
        timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }],
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockViewingRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([]);
  });

  it('includes virtual slots in availableSlots', async () => {
    const result = await viewingService.getPublicBookingPage(propertySlug);
    expect(result).not.toBeNull();
    // Should contain virtual slots (rec: IDs) for Mondays in next 30 days
    expect(result!.availableSlots.some((s) => s.id.startsWith('rec:'))).toBe(true);
  });

  it('virtual slot carries slotType and maxViewers', async () => {
    const result = await viewingService.getPublicBookingPage(propertySlug);
    const virtualSlot = result!.availableSlots.find((s) => s.id.startsWith('rec:'));
    expect(virtualSlot).toBeDefined();
    expect(virtualSlot!.slotType).toBe('single');
    expect(virtualSlot!.maxViewers).toBe(1);
  });

  it('manual slot suppresses matching virtual window (precedence rule)', async () => {
    // Find a Monday in the next 30 days
    const nextMonday = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      const dow = d.getUTCDay();
      const days = (1 - dow + 7) % 7 || 7;
      d.setUTCDate(d.getUTCDate() + days);
      return d;
    })();
    const dateStr = nextMonday.toISOString().split('T')[0];

    // A manual slot exists for the same 18:00-18:15 window
    mockViewingRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
      {
        id: 'manual-uuid',
        date: nextMonday,
        startTime: '18:00',
        endTime: '18:15',
        status: 'available',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 0,
      },
    ]);

    const result = await viewingService.getPublicBookingPage(propertySlug);

    // The 18:00 slot should be the manual one (UUID, not rec:)
    const slot1800 = result!.availableSlots.find(
      (s) => s.startTime === '18:00' && s.endTime === '18:15'
        && s.id.includes(dateStr.replace(/-/g, '')),
    );
    if (slot1800) {
      expect(slot1800.id).toBe('manual-uuid');
    }

    // No duplicate rec: slot for the same window
    const recSlotForWindow = result!.availableSlots.filter(
      (s) => s.id === `rec:${dateStr}:18:00:18:15`,
    );
    expect(recSlotForWindow).toHaveLength(0);
  });

  it('cancelled slots are excluded', async () => {
    const result = await viewingService.getPublicBookingPage(propertySlug);
    expect(result!.availableSlots.every((s) => s.status !== 'cancelled')).toBe(true);
  });

  it('returns null when property not found', async () => {
    mockViewingRepo.findPropertyBySlug.mockResolvedValue(null);
    const result = await viewingService.getPublicBookingPage(propertySlug);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 23: Run tests to verify they fail**

```bash
npx jest viewing.service.test --no-coverage -t "getPublicBookingPage"
```

Expected: FAIL — current implementation returns only real slots.

- [ ] **Step 24: Rewrite `getPublicBookingPage`**

Replace the existing function body (currently lines ~1149-1162):

```typescript
export async function getPublicBookingPage(slug: string) {
  const property = await viewingRepo.findPropertyBySlug(slug);
  if (!property) return null;

  const propertyId = (property as { id: string }).id;
  const now = new Date();
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Load virtual windows from schedule
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, now, endDate)
    : [];

  // Load real slots for next 30 days (available, booked, full — not cancelled)
  const realSlots = (await viewingRepo.findSlotsByPropertyAndDateRange(
    propertyId,
    now,
    endDate,
  )) as SlotSummary[];

  // Build real slot lookup by "date:startTime:endTime"
  const realSlotMap = new Map<string, SlotSummary>();
  for (const s of realSlots) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    realSlotMap.set(key, s);
  }

  // Merge: manual slot suppresses virtual window for the same window
  const merged: (SlotSummary | (VirtualSlot & { status: string }))[] = [];
  const processedKeys = new Set<string>();

  for (const vs of virtualSlots) {
    const dateStr = vs.date.toISOString().split('T')[0];
    const key = `${dateStr}:${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);

    const real = realSlotMap.get(key);
    if (real) {
      // Manual/materialised slot takes precedence
      if (real.status !== 'cancelled') merged.push(real);
    } else {
      // Virtual slot — available by definition
      merged.push({ ...vs, status: 'available' });
    }
  }

  // Add manual real slots not covered by any virtual window
  for (const s of realSlots) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    if (!processedKeys.has(key) && s.status !== 'cancelled') {
      merged.push(s);
    }
  }

  // Public page only shows available or booked (not full)
  const availableSlots = merged.filter(
    (s) => s.status === 'available' || s.status === 'booked',
  );

  return { property, availableSlots };
}
```

Add `VirtualSlot` to the imports from `./viewing.types` at the top of the service file.

- [ ] **Step 25: Run tests**

```bash
npx jest viewing.service.test --no-coverage -t "getPublicBookingPage"
```

Expected: PASS.

- [ ] **Step 26: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 27: Commit**

```bash
git add src/domains/viewing/viewing.service.ts \
        src/domains/viewing/viewing.repository.ts \
        src/domains/viewing/__tests__/viewing.service.test.ts \
        src/domains/viewing/__tests__/viewing.repository.test.ts
git commit -m "feat(viewing): rewrite getPublicBookingPage and getSlotsForDate with virtual+real merge, add saveSchedule/deleteSchedule, materialise-on-booking"
```

---

## Task 5: Validator + Router

**Files:**
- Modify: `src/domains/viewing/viewing.validator.ts`
- Modify: `src/domains/viewing/__tests__/viewing.validator.test.ts`
- Modify: `src/domains/viewing/viewing.router.ts`
- Modify: `src/domains/viewing/__tests__/viewing.router.test.ts`

### 5a — Validator: server-side propertyId

- [ ] **Step 1: Write failing validator test**

In `viewing.validator.test.ts`, find the `validateCreateRecurringSlots` tests. Add:

```typescript
it('no longer requires propertyId from client body', () => {
  const input = {
    // propertyId intentionally absent — it is now supplied server-side
    days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }] }],
  };
  // Should not throw
  expect(() => validateScheduleDays(input.days)).not.toThrow();
});
```

We'll introduce a new exported function `validateScheduleDays` that only validates `days` (no propertyId):

- [ ] **Step 2: Add `validateScheduleDays` to `viewing.validator.ts`**

In `viewing.validator.ts`, add after `validateCreateRecurringSlots`:

```typescript
/**
 * Validates the `days` array for a recurring schedule save request.
 * propertyId is NOT accepted here — the router supplies it server-side.
 */
export function validateScheduleDays(days: unknown): RecurringDayConfig[] {
  if (!Array.isArray(days) || days.length === 0 || days.length > 7) {
    throw new ValidationError('days must be an array of 1–7 entries');
  }

  // Reuse the inner validation logic from validateCreateRecurringSlots
  // by calling it with a synthetic propertyId
  const result = validateCreateRecurringSlots({ propertyId: '__server__', days });
  return result.days;
}
```

Import `RecurringDayConfig` type in the validator if not already imported.

- [ ] **Step 3: Run validator tests**

```bash
npx jest viewing.validator.test --no-coverage
```

Expected: PASS.

### 5b — Booking route: pass `propertyId` for rec: IDs

The `POST /view/:propertySlug/book` route must inject `propertyId` into the booking input when `slotId` is a `rec:` ID. The service needs it to load the recurring schedule.

- [ ] **Step 4: Update `validateBookingForm` in `viewing.validator.ts` to pass through `propertyId`**

Find `validateBookingForm` and add `propertyId` extraction alongside the existing field parsing:

```typescript
const propertyId = b.propertyId ? String(b.propertyId) : undefined;
// Include in the returned object:
// return { name, phone, ..., slotId, propertyId, website, formLoadedAt };
```

- [ ] **Step 5: Update the booking route in `viewing.router.ts`**

The public booking page already returns `property.id` from `getPublicBookingPage`. Rather than an extra DB lookup at booking time, add `propertyId` as a hidden field in the booking form template (`public/viewing-booking.njk`):

```html
<input type="hidden" name="propertyId" value="{{ property.id }}">
```

This means `propertyId` flows through the form naturally and `validateBookingForm` passes it into `BookingFormInput.propertyId`. No router changes needed.

**Verify:** The booking route at `POST /view/:propertySlug/book` calls `validateBookingForm(req.body)` — with the hidden field in the form, `input.propertyId` will be set when the form is submitted.

### 5c — Router: new schedule routes

- [ ] **Step 6: Write failing router tests for schedule routes**

In `viewing.router.test.ts`, add:

```typescript
describe('POST /seller/viewings/schedule', () => {
  it('saves schedule and returns 200', async () => {
    mockService.saveSchedule.mockResolvedValue({
      id: 'sched-1',
      propertyId: 'prop-1',
      days: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/seller/viewings/schedule')
      .send({
        days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }] }],
      });

    expect(res.status).toBe(200);
    expect(mockService.saveSchedule).toHaveBeenCalledWith(
      expect.any(Array),
      'seller-1',
    );
  });

  it('returns 400 for invalid days', async () => {
    const res = await request(app)
      .post('/seller/viewings/schedule')
      .send({ days: [] }); // empty array
    expect(res.status).toBe(400);
  });
});

describe('DELETE /seller/viewings/schedule', () => {
  it('deletes schedule and returns 200', async () => {
    mockService.deleteSchedule.mockResolvedValue(undefined);

    const res = await request(app).delete('/seller/viewings/schedule');

    expect(res.status).toBe(200);
    expect(mockService.deleteSchedule).toHaveBeenCalledWith('seller-1');
  });
});
```

Also update the existing GET `/seller/viewings` router test to expect `recurringSchedule` in the render context:

```typescript
it('passes recurringSchedule to full page render', async () => {
  mockService.getSellerDashboard.mockResolvedValue({
    stats: null, slots: [], totalSlots: 0, page: 1, pageSize: 20, slotsByDate: {},
  });
  mockService.getRecurringSchedule.mockResolvedValue({
    id: 'sched-1',
    propertyId: 'prop-1',
    days: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'prop-1' });

  const res = await request(app).get('/seller/viewings');

  expect(res.body.recurringSchedule).toBeDefined();
});
```

Add a `getRecurringSchedule` service function (wrapper around the repo):

- [ ] **Step 7: Add `getRecurringSchedule` service function**

In `viewing.service.ts`:

```typescript
export async function getRecurringSchedule(propertyId: string) {
  return viewingRepo.findRecurringSchedule(propertyId);
}
```

- [ ] **Step 8: Run router tests to verify they fail**

```bash
npx jest viewing.router.test --no-coverage -t "POST /seller/viewings/schedule|DELETE /seller/viewings/schedule"
```

Expected: FAIL — routes don't exist yet.

- [ ] **Step 9: Update `viewing.router.ts`**

**Add new imports at top:**
```typescript
import { validateScheduleDays } from './viewing.validator';
```

**Add schedule routes** (place them before the existing `POST /seller/viewings/slots/recurring`):

```typescript
viewingRouter.post(
  '/seller/viewings/schedule',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const days = validateScheduleDays(req.body.days);
      const schedule = await viewingService.saveSchedule(days, user.id);
      return res.status(200).json({ success: true, schedule });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.delete(
  '/seller/viewings/schedule',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.deleteSchedule(user.id);
      return res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);
```

**Remove old recurring route:** Delete the entire `POST /seller/viewings/slots/recurring` route handler (lines ~178–195).

**Update GET `/seller/viewings`** to load the recurring schedule and remove expiry fields:

In the GET handler (currently ~line 76-86), replace:
```typescript
let lastSlotDate: Date | null = null;
let daysUntilExpiry: number | null = null;
if (propertyId) {
  lastSlotDate = await viewingService.getLastUpcomingSlotDate(propertyId);
  if (lastSlotDate) {
    const msPerDay = 1000 * 60 * 60 * 24;
    daysUntilExpiry = Math.ceil(
      (lastSlotDate.getTime() - Date.now()) / msPerDay,
    );
  }
}
```

With:
```typescript
const recurringSchedule = propertyId
  ? await viewingService.getRecurringSchedule(propertyId)
  : null;
```

Update the `res.render('pages/seller/viewings', {...})` call to remove `lastSlotDate` and `daysUntilExpiry` and add `recurringSchedule`:

```typescript
return res.render('pages/seller/viewings', {
  stats,
  slots,
  propertyId,
  slotsByDate,
  page,
  hasMore,
  totalSlots,
  recurringSchedule,
});
```

Also update the HTMX partial render to pass `recurringSchedule`:
```typescript
if (req.headers['hx-request']) {
  return res.render('partials/seller/viewings-dashboard', {
    stats,
    slots,
    propertyId,
    slotsByDate,
    page,
    hasMore,
    totalSlots,
    recurringSchedule,
  });
}
```

- [ ] **Step 10: Run router tests**

```bash
npx jest viewing.router.test --no-coverage
```

Expected: all router tests PASS.

- [ ] **Step 11: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/domains/viewing/viewing.validator.ts \
        src/domains/viewing/__tests__/viewing.validator.test.ts \
        src/domains/viewing/viewing.router.ts \
        src/domains/viewing/__tests__/viewing.router.test.ts \
        src/domains/viewing/viewing.service.ts
git commit -m "feat(viewing): add POST/DELETE /seller/viewings/schedule routes, remove old recurring route, load schedule in GET handler"
```

---

## Task 6: Integration Tests

**Files:**
- Create: `tests/integration/viewing.test.ts`

These tests run against a real Docker Postgres database and the full Express app. Run with `npm run test:integration`.

- [ ] **Step 1: Add `viewingSlot` and `recurringSchedule` helpers to `tests/fixtures/factory.ts`**

In `tests/fixtures/factory.ts`, add to the `factory` object:

```typescript
async viewingSlot(overrides: {
  propertyId: string;
  date?: Date;
  startTime?: string;
  endTime?: string;
  slotType?: 'single' | 'group';
  maxViewers?: number;
  status?: 'available' | 'booked' | 'full' | 'cancelled';
}) {
  return testPrisma.viewingSlot.create({
    data: {
      id: createId(),
      propertyId: overrides.propertyId,
      date: overrides.date ?? new Date('2026-04-01T00:00:00.000Z'),
      startTime: overrides.startTime ?? '18:00',
      endTime: overrides.endTime ?? '18:15',
      durationMinutes: 15,
      slotType: (overrides.slotType ?? 'single') as SlotType,
      maxViewers: overrides.maxViewers ?? 1,
      status: (overrides.status ?? 'available') as SlotStatus,
    },
  });
},

async recurringSchedule(overrides: {
  propertyId: string;
  days?: unknown;
}) {
  return testPrisma.recurringSchedule.create({
    data: {
      id: createId(),
      propertyId: overrides.propertyId,
      days: (overrides.days ?? []) as Prisma.InputJsonValue,
    },
  });
},
```

Add needed Prisma enum imports: `import type { SlotType, SlotStatus } from '@prisma/client';`

- [ ] **Step 2: Create integration test file**

Create `tests/integration/viewing.test.ts`:

```typescript
import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import { getCsrfToken, withCsrf } from '../helpers/csrf';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
  await factory.systemSetting({ key: 'commission_amount', value: '1499' });
  await factory.systemSetting({ key: 'gst_rate', value: '0.09' });
  await factory.systemSetting({ key: 'open_house_slot_duration_minutes', value: '30' });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function loginAsSeller(overrides?: { onboardingStep?: number; status?: 'active' }) {
  const password = 'TestPassword1!';
  const seller = await factory.seller({
    email: `seller-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    onboardingStep: overrides?.onboardingStep ?? 4,
    status: overrides?.status ?? 'active',
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/seller').set('x-csrf-token', csrfToken).type('form').send({
    email: seller.email,
    password,
  });

  return { seller, agent: withCsrf(agent, csrfToken) };
}

// ─── Schedule CRUD ───────────────────────────────────────

describe('POST /seller/viewings/schedule', () => {
  it('creates a new recurring schedule', async () => {
    const { seller, agent } = await loginAsSeller();
    const agentRecord = await factory.agent();
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id });
    // Give the seller an active property
    await testPrisma.seller.update({ where: { id: seller.id }, data: { activePropertyId: property.id } });

    const days = [
      {
        dayOfWeek: 1,
        timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }],
      },
    ];

    const res = await agent.post('/seller/viewings/schedule').send({ days });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.schedule.propertyId).toBe(property.id);

    // Verify in DB
    const schedule = await testPrisma.recurringSchedule.findUnique({
      where: { propertyId: property.id },
    });
    expect(schedule).not.toBeNull();
    expect((schedule!.days as { dayOfWeek: number }[])[0].dayOfWeek).toBe(1);
  });

  it('overwrites existing schedule on second save', async () => {
    const { seller, agent } = await loginAsSeller();
    const agentRecord = await factory.agent();
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id });
    await testPrisma.seller.update({ where: { id: seller.id }, data: { activePropertyId: property.id } });
    await factory.recurringSchedule({ propertyId: property.id, days: [{ dayOfWeek: 0, timeslots: [] }] });

    const days = [{ dayOfWeek: 3, timeslots: [{ startTime: '10:00', endTime: '12:00', slotType: 'group' }] }];
    const res = await agent.post('/seller/viewings/schedule').send({ days });

    expect(res.status).toBe(200);
    const schedules = await testPrisma.recurringSchedule.findMany({ where: { propertyId: property.id } });
    expect(schedules).toHaveLength(1); // upsert, not duplicate
    expect((schedules[0].days as { dayOfWeek: number }[])[0].dayOfWeek).toBe(3);
  });

  it('returns 400 for invalid days', async () => {
    const { agent } = await loginAsSeller();
    const res = await agent.post('/seller/viewings/schedule').send({ days: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /seller/viewings/schedule', () => {
  it('removes schedule without affecting materialised ViewingSlot rows', async () => {
    const { seller, agent } = await loginAsSeller();
    const agentRecord = await factory.agent();
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id });
    await testPrisma.seller.update({ where: { id: seller.id }, data: { activePropertyId: property.id } });
    await factory.recurringSchedule({ propertyId: property.id, days: [] });

    // Create a materialised recurring slot
    const slot = await factory.viewingSlot({ propertyId: property.id });
    await testPrisma.viewingSlot.update({ where: { id: slot.id }, data: { source: 'recurring' } });

    const res = await agent.delete('/seller/viewings/schedule');
    expect(res.status).toBe(200);

    // Schedule removed
    const schedule = await testPrisma.recurringSchedule.findUnique({ where: { propertyId: property.id } });
    expect(schedule).toBeNull();

    // Materialised slot still exists
    const stillExists = await testPrisma.viewingSlot.findUnique({ where: { id: slot.id } });
    expect(stillExists).not.toBeNull();
  });
});

// ─── Booking Flow ────────────────────────────────────────

describe('Booking a virtual recurring slot', () => {
  it('materialises ViewingSlot row when buyer books a rec: slot', async () => {
    const agentRecord = await factory.agent();
    const seller = await factory.seller({ status: 'active' });
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id });

    // Create a recurring schedule with Monday 18:00-18:15 single
    await factory.recurringSchedule({
      propertyId: property.id,
      days: [
        {
          dayOfWeek: 1, // Monday
          timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }],
        },
      ],
    });

    // Book a virtual slot for next Monday
    const nextMonday = getNextWeekday(1); // 1 = Monday
    const dateStr = nextMonday.toISOString().split('T')[0];

    const res = await request(app).post('/view/book').type('form').send({
      name: 'Test Buyer',
      phone: '91234567',
      viewerType: 'buyer',
      consentService: 'true',
      slotId: `rec:${dateStr}:18:00:18:15`,
      propertyId: property.id,
    });

    // Should create a pending OTP booking (201 or redirect)
    expect(res.status).toBeLessThan(400);

    // ViewingSlot row should now exist with source=recurring
    const materialised = await testPrisma.viewingSlot.findFirst({
      where: { propertyId: property.id, startTime: '18:00', endTime: '18:15' },
    });
    expect(materialised).not.toBeNull();
    expect(materialised!.source).toBe('recurring');
  });

  it('rejects rec: ID when window not in schedule', async () => {
    const agentRecord = await factory.agent();
    const seller = await factory.seller({ status: 'active' });
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id });
    await factory.recurringSchedule({
      propertyId: property.id,
      days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }] }],
    });

    // Try to book Sunday (not in schedule)
    const nextSunday = getNextWeekday(0);
    const dateStr = nextSunday.toISOString().split('T')[0];

    const res = await request(app).post('/view/book').type('form').send({
      name: 'Test Buyer',
      phone: '91234567',
      viewerType: 'buyer',
      consentService: 'true',
      slotId: `rec:${dateStr}:18:00:18:15`,
      propertyId: property.id,
    });

    expect(res.status).toBe(400);
  });
});

// ─── Public Booking Page ─────────────────────────────────

describe('GET /view/:propertySlug — virtual slots appear', () => {
  it('returns virtual recurring slots in the booking page', async () => {
    const agentRecord = await factory.agent();
    const seller = await factory.seller({ status: 'active' });
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id, slug: `test-prop-${Date.now()}` });
    await factory.recurringSchedule({
      propertyId: property.id,
      days: [
        {
          dayOfWeek: 1, // Monday
          timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }],
        },
      ],
    });

    const res = await request(app).get(`/view/${property.slug}`);

    expect(res.status).toBe(200);
    // The rendered page should include at least one rec: slot ID
    // (check by looking at the response body for the rec: prefix)
    expect(res.text).toContain('rec:');
  });

  it('manual slot suppresses virtual window in public page', async () => {
    const agentRecord = await factory.agent();
    const seller = await factory.seller({ status: 'active' });
    const property = await factory.property({ sellerId: seller.id, agentId: agentRecord.id, slug: `test-prop2-${Date.now()}` });

    const nextMonday = getNextWeekday(1);
    const dateStr = nextMonday.toISOString().split('T')[0];

    await factory.recurringSchedule({
      propertyId: property.id,
      days: [{ dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }] }],
    });
    // Materialised slot for same window
    await factory.viewingSlot({
      propertyId: property.id,
      date: nextMonday,
      startTime: '18:00',
      endTime: '18:15',
      status: 'available',
    });
    await testPrisma.viewingSlot.updateMany({
      where: { propertyId: property.id, startTime: '18:00' },
      data: { source: 'recurring' },
    });

    const res = await request(app).get(`/view/${property.slug}`);

    expect(res.status).toBe(200);
    // Virtual slot for this window should NOT appear (real slot takes precedence)
    expect(res.text).not.toContain(`rec:${dateStr}:18:00:18:15`);
  });
});

// ─── Helpers ─────────────────────────────────────────────

function getNextWeekday(targetDow: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const daysUntil = (targetDow - dow + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d;
}
```

**Note:** The integration test for booking assumes a `/view/book` route exists. Check the actual route in `src/domains/viewing/viewing.router.ts` and adjust the path if needed (it may be `POST /view/:propertySlug/book` or similar).

- [ ] **Step 3: Run integration tests**

```bash
npm run docker:test:db   # ensure test DB is running
npm run test:integration -- --testPathPattern=viewing
```

Expected: all tests PASS. If any fail due to missing `factory.property` fields or route path differences, adjust accordingly.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/viewing.test.ts tests/fixtures/factory.ts
git commit -m "test(viewing): add integration tests for schedule CRUD and materialise-on-booking flow"
```

---

## Task 7: Templates + App.js

**Files:**
- Modify: `src/views/pages/seller/viewings.njk`
- Modify: `src/views/partials/seller/viewings-dashboard.njk`
- Modify: `public/js/app.js`

- [ ] **Step 1: Add hidden `propertyId` field to the public booking form**

In `src/views/public/viewing-booking.njk` (or wherever the booking form lives), add a hidden field inside the booking `<form>`:

```html
<input type="hidden" name="propertyId" value="{{ property.id }}">
```

This ensures `propertyId` is submitted with the booking form so that `initiateBooking` can load the recurring schedule for `rec:` slot IDs.

- [ ] **Step 3: Remove expiry nudge banner from `viewings.njk`**

In `src/views/pages/seller/viewings.njk`, remove the entire expiry nudge block:

```nunjucks
{# DELETE this entire block: #}
{% if lastSlotDate === null or daysUntilExpiry !== null and daysUntilExpiry <= 7 %}
<div class="mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
  <span>
    {% if lastSlotDate %}
      {{ "Your viewing slots expire in" | t }} {{ daysUntilExpiry }} {{ "days." | t }}
    {% else %}
      {{ "You have no upcoming viewing slots." | t }}
    {% endif %}
  </span>
  <a href="?tab=recurring" class="font-semibold underline whitespace-nowrap">
    {% if lastSlotDate %}{{ "Create more →" | t }}{% else %}{{ "Create slots →" | t }}{% endif %}
  </a>
</div>
{% endif %}
```

- [ ] **Step 4: Update "Save Schedule" button label in `viewings-dashboard.njk`**

In `src/views/partials/seller/viewings-dashboard.njk`, find the submit button for the recurring form. It should say "Create Recurring Slots" or similar. Change the button label to "Save Schedule" and remove any helper text that says "Creates slots for 1 month from today":

Find:
```nunjucks
{# Look for the submit button near id="recurring-slots-form-new" #}
```

Change button text from `"Create Recurring Slots" | t` to `"Save Schedule" | t` (or the equivalent literal text found in the file).

Remove any helper text about "1 month from today".

- [ ] **Step 5: Pre-populate recurring form from saved schedule**

In `viewings-dashboard.njk`, the recurring form's day rows need to be pre-populated from `recurringSchedule` (now passed in the template context).

For each day row (identified by `data-dow="N"`), add conditional logic to set the toggle state and timeslot values. The template already has a `days` array for the 7 days. Add a macro or inline logic to find the matching day in the schedule:

Locate where the day rows are rendered (around `{% for day in days %}`). Add before the loop:

```nunjucks
{# Build a lookup from the saved schedule #}
{% set savedDays = {} %}
{% if recurringSchedule and recurringSchedule.days %}
  {% for d in recurringSchedule.days %}
    {% set savedDays = savedDays | merge({ [d.dayOfWeek]: d }) %}
  {% endfor %}
{% endif %}
```

Then in the day row, use `savedDays[day.dow]` to determine whether the toggle is on and what the timeslot values are. The exact changes depend on the template structure — inspect the current Nunjucks template and adapt.

**Key changes needed:**
- Toggle `aria-pressed`: set to `"true"` if `savedDays[day.dow]` exists, else `"false"`
- Background class: `bg-blue-500` if toggled on, `bg-gray-300` if off
- `startTime` select value: use first timeslot's `startTime` from saved schedule if available
- `endTime` select value: use first timeslot's `endTime` from saved schedule if available
- `slotType` select value: use first timeslot's `slotType` from saved schedule if available

**Note:** Nunjucks does not support `| merge` natively; use a simpler approach — pass `recurringSchedule.days` as a raw JSON string in a data attribute on the form, then read it in JavaScript. This is more reliable:

In the template, add to the form element:
```nunjucks
<form id="recurring-slots-form-new"
      data-property-id="{{ propertyId }}"
      data-saved-schedule="{{ recurringSchedule.days | dump | escape if recurringSchedule else '[]' }}">
```

Then in `app.js`, read it on page load and pre-populate the form.

- [ ] **Step 6: Update `app.js` — fetch URL and pre-populate logic**

In `public/js/app.js`, find the recurring form submit handler (around line 1228):

Change:
```javascript
fetch('/seller/viewings/slots/recurring', {
```
To:
```javascript
fetch('/seller/viewings/schedule', {
```

Change the loading message (around line 1220):
```javascript
if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-gray-400">Creating slots…</p>';
```
To:
```javascript
if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-gray-400">Saving schedule…</p>';
```

Change the success handling. Currently it renders HTML returned from the server. The new endpoint returns JSON. Update:
```javascript
.then(function (res) {
  return res.json().then(function (data) {
    if (!res.ok) throw new Error(res.status + ': ' + JSON.stringify(data));
    return data;
  });
})
.then(function (data) {
  if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-green-600">Schedule saved.</p>';
})
.catch(function (err) {
  if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-red-500">' + (err.message || 'Failed to save schedule.') + '</p>';
});
```

**Add pre-populate logic** after `var recurringForm = document.getElementById('recurring-slots-form-new');`:

```javascript
if (recurringForm) {
  var savedScheduleRaw = recurringForm.dataset.savedSchedule;
  if (savedScheduleRaw && savedScheduleRaw !== '[]') {
    try {
      var savedDays = JSON.parse(savedScheduleRaw);
      savedDays.forEach(function (dayConfig) {
        var dayRow = recurringForm.querySelector('[data-dow="' + dayConfig.dayOfWeek + '"]');
        if (!dayRow || !dayConfig.timeslots || dayConfig.timeslots.length === 0) return;

        // Enable the toggle
        var toggle = dayRow.querySelector('.recurring-day-toggle');
        if (toggle) {
          toggle.setAttribute('aria-pressed', 'true');
          toggle.classList.remove('bg-gray-300');
          toggle.classList.add('bg-blue-500');
          // Show time selects
          dayRow.querySelectorAll('.recurring-time-select, .recurring-type-select').forEach(function (el) {
            el.closest('.recurring-timeslot').querySelectorAll('select').forEach(function (s) {
              s.disabled = false;
            });
          });
        }

        // Set first timeslot values
        var firstTs = dayRow.querySelector('.recurring-timeslot');
        if (firstTs && dayConfig.timeslots[0]) {
          var ts = dayConfig.timeslots[0];
          var selects = firstTs.querySelectorAll('.recurring-time-select');
          if (selects[0]) selects[0].value = ts.startTime;
          if (selects[1]) selects[1].value = ts.endTime;
          var typeSel = firstTs.querySelector('.recurring-type-select');
          if (typeSel) typeSel.value = ts.slotType;
        }

        // Add additional timeslot rows if saved schedule has > 1
        // (trigger the add-row logic for each extra timeslot)
        for (var i = 1; i < dayConfig.timeslots.length; i++) {
          var addBtn = dayRow.querySelector('.recurring-add-btn');
          if (addBtn) addBtn.click(); // triggers existing add logic
          var allTs = dayRow.querySelectorAll('.recurring-timeslot');
          var newTs = allTs[i];
          if (newTs && dayConfig.timeslots[i]) {
            var ts2 = dayConfig.timeslots[i];
            var sels2 = newTs.querySelectorAll('.recurring-time-select');
            if (sels2[0]) sels2[0].value = ts2.startTime;
            if (sels2[1]) sels2[1].value = ts2.endTime;
            var typeSel2 = newTs.querySelector('.recurring-type-select');
            if (typeSel2) typeSel2.value = ts2.slotType;
          }
        }
      });
    } catch (e) {
      console.warn('Failed to pre-populate recurring schedule form:', e);
    }
  }
}
```

Also **remove any expiry-related JS** — search for `daysUntilExpiry` or `lastSlotDate` in `app.js` and remove those code blocks.

- [ ] **Step 7: Start dev server and manually verify**

```bash
npm run dev
```

1. Navigate to `/seller/viewings` and click the Recurring tab
2. Verify no expiry nudge banner appears
3. Save a schedule — button should say "Save Schedule", success message should say "Schedule saved."
4. Reload the page — the form should pre-populate with the saved schedule
5. Save again — should overwrite without error
6. Delete the schedule via DevTools console: `fetch('/seller/viewings/schedule', { method: 'DELETE', headers: { 'x-csrf-token': document.querySelector('meta[name="csrf-token"]').content } })`
7. Reload — form should be back to defaults

- [ ] **Step 8: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/views/pages/seller/viewings.njk \
        src/views/partials/seller/viewings-dashboard.njk \
        public/js/app.js
git commit -m "feat(viewing): update UI — remove expiry banner, Save Schedule button, pre-populate form from saved schedule"
```

---

## Final Verification

- [ ] Run full test suite

```bash
npm test && npm run test:integration
```

Expected: all tests pass.

- [ ] Build TypeScript

```bash
npm run build
```

Expected: no errors.

- [ ] Manual smoke test: full buyer booking flow via virtual slot

1. Start dev server: `npm run dev`
2. Set up a property with a recurring schedule (Mon–Fri 18:00–20:00 single)
3. Open the public booking page for the property
4. Verify virtual slots appear (rec: IDs in the HTML)
5. Book one — it should materialise the slot and create a Viewing record with `pending_otp` status
6. Verify `viewing_slots` table now has a row with `source = 'recurring'` for that booking

---

## Checklist Summary

- [ ] Task 1: Schema + migration
- [ ] Task 2: Types + `recurring.utils.ts` + unit tests
- [ ] Task 3: Repository functions + tests
- [ ] Task 4: Service layer (saveSchedule, deleteSchedule, getMonthSlotMeta, getSlotsForDate, initiateBooking, cascade)
- [ ] Task 5: Validator + router
- [ ] Task 6: Integration tests
- [ ] Task 7: Templates + app.js
- [ ] Final: full test suite green, TypeScript clean, smoke test passes
