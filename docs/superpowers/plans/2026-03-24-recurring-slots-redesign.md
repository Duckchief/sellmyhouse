# Recurring Slots Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Recurring Slots tab with a 7-day row layout (Mon–Sun) where each day has an Apple-style toggle and up to 3 timeslots (start, end, type), submitted in a single JSON request that generates 1 month of slots from today.

**Architecture:** New `POST /seller/viewings/slots/recurring` endpoint accepts all day/timeslot configs in one request; server derives date range (SGT today → +1 month), slot duration (10 min for normal, full window for open house), and maxViewers. Frontend serialises enabled rows to JSON on submit; HTMX is replaced by a vanilla fetch handler for this form. Expiry nudge banner added to viewings page using a lightweight `findLastUpcomingSlot` repo query.

**Tech Stack:** TypeScript, Express, Prisma, PostgreSQL, Nunjucks, HTMX (existing dashboard), Tailwind CSS, vanilla JS

**Spec:** `docs/superpowers/specs/2026-03-24-recurring-slots-redesign.md`

---

## File Structure

| File | Role |
|------|------|
| `src/domains/viewing/viewing.types.ts` | Add `CreateRecurringSlotsInput`, `RecurringDayConfig`, `RecurringTimeslotConfig` types |
| `src/domains/viewing/viewing.validator.ts` | Export `calcOpenHouseMaxViewers`; add `validateCreateRecurringSlots` |
| `src/domains/viewing/viewing.repository.ts` | Add `findLastUpcomingSlot`, `findActiveSlotsByDateRange` |
| `src/domains/viewing/viewing.service.ts` | Add `createRecurringSlots`, `getLastUpcomingSlotDate` |
| `src/domains/viewing/viewing.router.ts` | Add `POST /seller/viewings/slots/recurring`; pass `lastSlotDate` to viewings page |
| `src/views/pages/seller/viewings.njk` | Add expiry nudge banner |
| `src/views/partials/seller/viewings-dashboard.njk` | Replace recurring slots form with 7-day row table |
| `public/js/app.js` | Toggle rows, add/remove timeslot rows, JSON serialisation on submit |
| `src/domains/viewing/__tests__/viewing.validator.test.ts` | Fix broken tests + add new validator tests |
| `src/domains/viewing/__tests__/viewing.repository.test.ts` | Add tests for new repo functions |
| `src/domains/viewing/__tests__/viewing.service.test.ts` | Add tests for `createRecurringSlots` |
| `src/domains/viewing/__tests__/viewing.router.test.ts` | Add tests for new route |

---

### Task 1: Foundation — types, export helper, fix broken validator tests

**Files:**
- Modify: `src/domains/viewing/viewing.types.ts`
- Modify: `src/domains/viewing/viewing.validator.ts`
- Modify: `src/domains/viewing/__tests__/viewing.validator.test.ts`

**Context:** The existing `calcOpenHouseMaxViewers` function in `viewing.validator.ts` is module-private (no `export`). The new service will need to import it. Also, earlier in this session the validator was changed so that group slots automatically compute `maxViewers` from the window size — which breaks two existing tests that assumed explicit `maxViewers` was required. Fix those tests first before adding new code.

- [ ] **Step 1: Add types to `viewing.types.ts`**

Add after the `CreateBulkSlotsInput` interface (around line 55):

```typescript
export interface RecurringTimeslotConfig {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  slotType: 'single' | 'group';
}

export interface RecurringDayConfig {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  timeslots: RecurringTimeslotConfig[];
}

export interface CreateRecurringSlotsInput {
  propertyId: string;
  days: RecurringDayConfig[];
}
```

Also add `CreateRecurringSlotsInput` to the imports in `viewing.service.ts` once needed.

- [ ] **Step 2: Export `calcOpenHouseMaxViewers` in `viewing.validator.ts`**

Change line 14:
```typescript
function calcOpenHouseMaxViewers(startTime: string, endTime: string): number {
```
to:
```typescript
export function calcOpenHouseMaxViewers(startTime: string, endTime: string): number {
```

- [ ] **Step 3: Fix broken validator tests**

In `viewing.validator.test.ts`, the following two tests are now wrong because group slots no longer require an explicit `maxViewers` — it is computed from the window. Update them:

Find and replace:
```typescript
    it('accepts group slot with maxViewers', () => {
      const result = validateCreateSlot({
        ...validInput,
        slotType: 'group',
        maxViewers: '5',
      });
      expect(result.slotType).toBe('group');
      expect(result.maxViewers).toBe(5);
    });
```
With:
```typescript
    it('computes maxViewers from window for group slots', () => {
      // validInput: startTime '10:00', endTime '10:15' → 15 min → rounds to 30 min → 10 viewers
      const result = validateCreateSlot({
        ...validInput,
        slotType: 'group',
      });
      expect(result.slotType).toBe('group');
      expect(result.maxViewers).toBe(10); // ceil(15/30)*30/60*20 = 30/60*20 = 10
    });
```

Find and replace:
```typescript
    it('requires maxViewers for group slots', () => {
      expect(() => validateCreateSlot({ ...validInput, slotType: 'group' })).toThrow(
        ValidationError,
      );
    });
```
With:
```typescript
    it('accepts group slot without explicit maxViewers (computed from window)', () => {
      const result = validateCreateSlot({ ...validInput, slotType: 'group' });
      expect(result.maxViewers).toBeGreaterThanOrEqual(2);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest viewing.validator --no-coverage
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/viewing.types.ts src/domains/viewing/viewing.validator.ts src/domains/viewing/__tests__/viewing.validator.test.ts
git commit -m "feat(viewing): add recurring slots types, export calcOpenHouseMaxViewers, fix validator tests"
```

---

### Task 2: Add `validateCreateRecurringSlots` validator

**Files:**
- Modify: `src/domains/viewing/viewing.validator.ts`
- Modify: `src/domains/viewing/__tests__/viewing.validator.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block in `viewing.validator.test.ts`:

```typescript
import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateCreateRecurringSlots,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from '../viewing.validator';

// ... existing tests ...

  describe('validateCreateRecurringSlots', () => {
    const validDay = {
      dayOfWeek: 1,
      timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }],
    };

    it('accepts valid input', () => {
      const result = validateCreateRecurringSlots({
        propertyId: 'prop-1',
        days: [validDay],
      });
      expect(result.propertyId).toBe('prop-1');
      expect(result.days).toHaveLength(1);
      expect(result.days[0].dayOfWeek).toBe(1);
      expect(result.days[0].timeslots[0].slotType).toBe('single');
    });

    it('rejects missing propertyId', () => {
      expect(() =>
        validateCreateRecurringSlots({ days: [validDay] }),
      ).toThrow(ValidationError);
    });

    it('rejects empty days array', () => {
      expect(() =>
        validateCreateRecurringSlots({ propertyId: 'p', days: [] }),
      ).toThrow(ValidationError);
    });

    it('rejects more than 7 days', () => {
      const days = Array.from({ length: 8 }, (_, i) => ({
        dayOfWeek: i % 7,
        timeslots: [{ startTime: '10:00', endTime: '11:00', slotType: 'single' }],
      }));
      expect(() =>
        validateCreateRecurringSlots({ propertyId: 'p', days }),
      ).toThrow(ValidationError);
    });

    it('rejects duplicate dayOfWeek', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [validDay, { ...validDay }],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects more than 3 timeslots per day', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [{
            dayOfWeek: 1,
            timeslots: [
              { startTime: '10:00', endTime: '11:00', slotType: 'single' },
              { startTime: '11:00', endTime: '12:00', slotType: 'single' },
              { startTime: '12:00', endTime: '13:00', slotType: 'single' },
              { startTime: '13:00', endTime: '14:00', slotType: 'single' },
            ],
          }],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects overlapping timeslots within a day', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [{
            dayOfWeek: 1,
            timeslots: [
              { startTime: '10:00', endTime: '12:00', slotType: 'single' },
              { startTime: '11:00', endTime: '13:00', slotType: 'single' },
            ],
          }],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects times outside 10:00–20:00', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [{
            dayOfWeek: 1,
            timeslots: [{ startTime: '09:00', endTime: '11:00', slotType: 'single' }],
          }],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid slotType', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [{
            dayOfWeek: 1,
            timeslots: [{ startTime: '10:00', endTime: '11:00', slotType: 'invalid' }],
          }],
        }),
      ).toThrow(ValidationError);
    });

    it('accepts group slotType', () => {
      const result = validateCreateRecurringSlots({
        propertyId: 'p',
        days: [{
          dayOfWeek: 6,
          timeslots: [{ startTime: '13:00', endTime: '17:00', slotType: 'group' }],
        }],
      });
      expect(result.days[0].timeslots[0].slotType).toBe('group');
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest viewing.validator --no-coverage
```
Expected: new tests FAIL with "validateCreateRecurringSlots is not a function"

- [ ] **Step 3: Implement `validateCreateRecurringSlots` in `viewing.validator.ts`**

Add after `validateCreateBulkSlots`:

```typescript
export function validateCreateRecurringSlots(body: unknown): CreateRecurringSlotsInput {
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid request body');
  const b = body as Record<string, unknown>;

  const propertyId = String(b.propertyId || '');
  if (!propertyId) throw new ValidationError('Property ID is required');

  const days = b.days;
  if (!Array.isArray(days) || days.length === 0 || days.length > 7) {
    throw new ValidationError('days must be an array of 1–7 entries');
  }

  const seenDays = new Set<number>();

  const validatedDays = days.map((day: unknown) => {
    if (!day || typeof day !== 'object') throw new ValidationError('Invalid day config');
    const d = day as Record<string, unknown>;

    const dayOfWeek = Number(d.dayOfWeek);
    if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new ValidationError('dayOfWeek must be 0–6');
    }
    if (seenDays.has(dayOfWeek)) {
      throw new ValidationError(`Duplicate dayOfWeek: ${dayOfWeek}`);
    }
    seenDays.add(dayOfWeek);

    const timeslots = d.timeslots;
    if (!Array.isArray(timeslots) || timeslots.length === 0 || timeslots.length > 3) {
      throw new ValidationError('timeslots must be an array of 1–3 entries');
    }

    let lastEndTime = '';
    const validatedTimeslots = timeslots.map((ts: unknown) => {
      if (!ts || typeof ts !== 'object') throw new ValidationError('Invalid timeslot');
      const t = ts as Record<string, unknown>;

      const startTime = String(t.startTime || '');
      if (!TIME_REGEX.test(startTime)) throw new ValidationError('startTime must be HH:MM format');
      if (startTime < EARLIEST_START || startTime > LATEST_END)
        throw new ValidationError(TIME_BOUNDS_MSG);

      const endTime = String(t.endTime || '');
      if (!TIME_REGEX.test(endTime)) throw new ValidationError('endTime must be HH:MM format');
      if (endTime < EARLIEST_START || endTime > LATEST_END)
        throw new ValidationError(TIME_BOUNDS_MSG);

      if (endTime <= startTime) throw new ValidationError('endTime must be after startTime');

      if (lastEndTime && startTime < lastEndTime) {
        throw new ValidationError('Timeslots within a day must not overlap');
      }
      lastEndTime = endTime;

      const slotType = String(t.slotType || 'single') as 'single' | 'group';
      if (!['single', 'group'].includes(slotType)) throw new ValidationError('Invalid slotType');

      return { startTime, endTime, slotType };
    });

    return { dayOfWeek, timeslots: validatedTimeslots };
  });

  return { propertyId, days: validatedDays };
}
```

Also add `CreateRecurringSlotsInput` to the imports at the top of the file:
```typescript
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  CreateRecurringSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
} from './viewing.types';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest viewing.validator --no-coverage
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/viewing.validator.ts src/domains/viewing/__tests__/viewing.validator.test.ts
git commit -m "feat(viewing): add validateCreateRecurringSlots validator"
```

---

### Task 3: Add repository functions — `findLastUpcomingSlot` + `findActiveSlotsByDateRange`

**Files:**
- Modify: `src/domains/viewing/viewing.repository.ts`
- Modify: `src/domains/viewing/__tests__/viewing.repository.test.ts`

**Context:** The repository mocks Prisma directly (see `viewing.repository.test.ts` — `jest.mock('@/infra/database/prisma', ...)`). `findLastUpcomingSlot` uses `prisma.viewingSlot.findFirst`. `findActiveSlotsByDateRange` uses `prisma.viewingSlot.findMany` with a lightweight select (no includes).

- [ ] **Step 1: Write failing tests**

Add to the `describe('viewing.repository')` block in `viewing.repository.test.ts`:

```typescript
  describe('findLastUpcomingSlot', () => {
    it('returns the last upcoming non-cancelled slot', async () => {
      const mockSlot = { id: 'slot-1', date: new Date('2026-04-15') };
      mockedPrisma.viewingSlot.findFirst.mockResolvedValue(mockSlot as never);

      const result = await viewingRepo.findLastUpcomingSlot('prop-1');

      expect(mockedPrisma.viewingSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: 'prop-1',
            status: { not: 'cancelled' },
          }),
          orderBy: { date: 'desc' },
        }),
      );
      expect(result).toEqual(mockSlot);
    });

    it('returns null when no upcoming slots', async () => {
      mockedPrisma.viewingSlot.findFirst.mockResolvedValue(null);
      const result = await viewingRepo.findLastUpcomingSlot('prop-1');
      expect(result).toBeNull();
    });
  });

  describe('findActiveSlotsByDateRange', () => {
    it('returns active slots in date range without includes', async () => {
      const mockSlots = [
        { id: 's1', date: new Date('2026-04-01'), startTime: '10:00', endTime: '10:10', status: 'available' },
      ];
      mockedPrisma.viewingSlot.findMany.mockResolvedValue(mockSlots as never);

      const result = await viewingRepo.findActiveSlotsByDateRange(
        'prop-1',
        new Date('2026-04-01'),
        new Date('2026-05-01'),
      );

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: 'prop-1',
            status: { in: ['available', 'booked', 'full'] },
          }),
        }),
      );
      expect(result).toEqual(mockSlots);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest viewing.repository --no-coverage
```
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Implement both functions in `viewing.repository.ts`**

Add after `findActiveSlotsByPropertyId`:

```typescript
export async function findLastUpcomingSlot(propertyId: string) {
  return prisma.viewingSlot.findFirst({
    where: {
      propertyId,
      status: { not: 'cancelled' as SlotStatus },
      date: { gte: new Date() },
    },
    orderBy: { date: 'desc' },
  });
}

export async function findActiveSlotsByDateRange(
  propertyId: string,
  startDate: Date,
  endDate: Date,
) {
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      status: { in: ['available', 'booked', 'full'] as SlotStatus[] },
      date: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest viewing.repository --no-coverage
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/viewing.repository.ts src/domains/viewing/__tests__/viewing.repository.test.ts
git commit -m "feat(viewing): add findLastUpcomingSlot and findActiveSlotsByDateRange to repository"
```

---

### Task 4: Add `createRecurringSlots` service method

**Files:**
- Modify: `src/domains/viewing/viewing.service.ts`
- Modify: `src/domains/viewing/__tests__/viewing.service.test.ts`

**Context:** The service uses `createId()` from `@paralleldrive/cuid2` (mocked as `'test-id-123'` in tests), `viewingRepo`, and `auditService`. Study the existing `createBulkSlots` implementation (lines 98–172 of viewing.service.ts) — it is the closest analogue. Key differences for `createRecurringSlots`: (1) date range is server-computed in SGT, (2) multiple day configs per request, (3) slot generation differs for `single` vs `group` type, (4) DB-level overlap check with skip (not throw).

- [ ] **Step 1: Write failing tests**

Add to the `describe('viewing.service')` block in `viewing.service.test.ts`:

```typescript
  describe('createRecurringSlots', () => {
    const validInput = {
      propertyId: 'prop-1',
      days: [
        {
          dayOfWeek: 1, // Monday
          timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' as const }],
        },
      ],
    };

    beforeEach(() => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([] as never);
      mockedRepo.findActiveSlotsByDateRange.mockResolvedValue([] as never);
      mockedRepo.createManySlots.mockResolvedValue({ count: 1 } as never);
    });

    it('creates slots for enabled days', async () => {
      const result = await viewingService.createRecurringSlots(validInput, 'seller-1');
      expect(mockedRepo.createManySlots).toHaveBeenCalled();
      expect(result.count).toBeGreaterThan(0);
    });

    it('sets durationMinutes to 10 for single slots', async () => {
      await viewingService.createRecurringSlots(validInput, 'seller-1');
      const insertedSlots = mockedRepo.createManySlots.mock.calls[0][0];
      expect(insertedSlots[0].durationMinutes).toBe(10);
      expect(insertedSlots[0].slotType).toBe('single');
      expect(insertedSlots[0].maxViewers).toBe(1);
    });

    it('creates exactly 1 slot per day occurrence for group type', async () => {
      const groupInput = {
        propertyId: 'prop-1',
        days: [{
          dayOfWeek: 1,
          timeslots: [{ startTime: '13:00', endTime: '17:00', slotType: 'group' as const }],
        }],
      };
      await viewingService.createRecurringSlots(groupInput, 'seller-1');
      const insertedSlots = mockedRepo.createManySlots.mock.calls[0][0];
      // All inserted slots for group type should span the full window
      const groupSlots = insertedSlots.filter((s: { slotType: string }) => s.slotType === 'group');
      groupSlots.forEach((s: { startTime: string; endTime: string; durationMinutes: number }) => {
        expect(s.startTime).toBe('13:00');
        expect(s.endTime).toBe('17:00');
        expect(s.durationMinutes).toBe(240); // 4 hours
      });
    });

    it('skips slots that overlap with existing DB slots', async () => {
      mockedRepo.findActiveSlotsByDateRange.mockResolvedValue([
        {
          id: 'existing',
          date: expect.any(Date),
          startTime: '18:00',
          endTime: '20:00',
          status: 'available',
        },
      ] as never);
      const result = await viewingService.createRecurringSlots(validInput, 'seller-1');
      // All Mon 18:00–20:00 sub-slots should be skipped
      expect(result.count).toBe(0);
    });

    it('throws when MAX_ACTIVE_SLOTS already reached', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue(
        Array(200).fill({ id: 'x' }) as never,
      );
      await expect(
        viewingService.createRecurringSlots(validInput, 'seller-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws when generation would exceed MAX_ACTIVE_SLOTS', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue(
        Array(199).fill({ id: 'x' }) as never,
      );
      // validInput generates many slots for a month of Mondays
      await expect(
        viewingService.createRecurringSlots(validInput, 'seller-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError when seller does not own property', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'other-seller',
      } as never);
      await expect(
        viewingService.createRecurringSlots(validInput, 'seller-1'),
      ).rejects.toThrow();
    });

    it('logs audit event', async () => {
      await viewingService.createRecurringSlots(validInput, 'seller-1');
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'viewing.recurring_slots_created' }),
      );
    });
  });
```

Also add `findActiveSlotsByDateRange` to the `mockedRepo` mock setup — it will need to be listed in the mock. Add it to the beforeEach setup block.

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest viewing.service --no-coverage
```
Expected: FAIL — `createRecurringSlots` not found

- [ ] **Step 3: Implement `createRecurringSlots` in `viewing.service.ts`**

Add the following imports to the top of `viewing.service.ts` if not already present:
```typescript
import type { CreateRecurringSlotsInput } from './viewing.types';
import { calcOpenHouseMaxViewers } from './viewing.validator';
```

Add helper at the top of the service file (after imports, before `createSlot`):

```typescript
function formatTimeFromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function getSgtToday(): Date {
  const sgtDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  return new Date(sgtDateStr);
}
```

Add the service method after `createBulkSlots`:

```typescript
export async function createRecurringSlots(input: CreateRecurringSlotsInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  // Early exit if already at limit
  const currentActive = await viewingRepo.findActiveSlotsByPropertyId(input.propertyId);
  if (currentActive.length >= MAX_ACTIVE_SLOTS) {
    throw new ValidationError(
      `Maximum ${MAX_ACTIVE_SLOTS} active slots reached. Please cancel existing slots first.`,
    );
  }

  // Date range: SGT today → +1 month
  const startDate = getSgtToday();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  // Fetch existing active slots in range for overlap checking (lightweight)
  const existingSlots = await viewingRepo.findActiveSlotsByDateRange(
    input.propertyId,
    startDate,
    endDate,
  );

  // Build date-keyed map for fast overlap lookup
  const existingByDate = new Map<string, { startTime: string; endTime: string }[]>();
  for (const slot of existingSlots) {
    const key = (slot.date as Date).toISOString().split('T')[0];
    if (!existingByDate.has(key)) existingByDate.set(key, []);
    existingByDate.get(key)!.push({ startTime: slot.startTime as string, endTime: slot.endTime as string });
  }

  // Day-of-week config map: dayOfWeek → timeslots
  const dayConfig = new Map(input.days.map((d) => [d.dayOfWeek, d.timeslots]));

  const toInsert: {
    id: string;
    propertyId: string;
    date: Date;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    slotType: 'single' | 'group';
    maxViewers: number;
  }[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    const dow = current.getDay();
    const timeslots = dayConfig.get(dow);

    if (timeslots) {
      const dateKey = current.toISOString().split('T')[0];
      const existingOnDate = existingByDate.get(dateKey) ?? [];

      for (const ts of timeslots) {
        if (ts.slotType === 'group') {
          // One slot spanning the full window
          const overlaps = existingOnDate.some(
            (e) => e.startTime < ts.endTime && e.endTime > ts.startTime,
          );
          if (!overlaps) {
            const [sh, sm] = ts.startTime.split(':').map(Number);
            const [eh, em] = ts.endTime.split(':').map(Number);
            const durationMinutes = eh * 60 + em - (sh * 60 + sm);
            toInsert.push({
              id: createId(),
              propertyId: input.propertyId,
              date: new Date(current),
              startTime: ts.startTime,
              endTime: ts.endTime,
              durationMinutes,
              slotType: 'group',
              maxViewers: calcOpenHouseMaxViewers(ts.startTime, ts.endTime),
            });
          }
        } else {
          // 10-minute sub-slots
          const [sh, sm] = ts.startTime.split(':').map(Number);
          const [eh, em] = ts.endTime.split(':').map(Number);
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;

          for (let t = startMinutes; t + 10 <= endMinutes; t += 10) {
            const slotStart = formatTimeFromMinutes(t);
            const slotEnd = formatTimeFromMinutes(t + 10);
            const overlaps = existingOnDate.some(
              (e) => e.startTime < slotEnd && e.endTime > slotStart,
            );
            if (!overlaps) {
              toInsert.push({
                id: createId(),
                propertyId: input.propertyId,
                date: new Date(current),
                startTime: slotStart,
                endTime: slotEnd,
                durationMinutes: 10,
                slotType: 'single',
                maxViewers: 1,
              });
            }
          }
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  // Post-check after overlap filtering
  if (currentActive.length + toInsert.length > MAX_ACTIVE_SLOTS) {
    const remaining = MAX_ACTIVE_SLOTS - currentActive.length;
    throw new ValidationError(
      `This would create ${toInsert.length} slots but only ${remaining} more allowed (limit: ${MAX_ACTIVE_SLOTS}).`,
    );
  }

  if (toInsert.length > 0) {
    await viewingRepo.createManySlots(toInsert);
  }

  await auditService.log({
    action: 'viewing.recurring_slots_created',
    entityType: 'viewing_slot',
    entityId: input.propertyId,
    details: { count: toInsert.length, sellerId },
  });

  return { count: toInsert.length };
}

export async function getLastUpcomingSlotDate(propertyId: string): Promise<Date | null> {
  const slot = await viewingRepo.findLastUpcomingSlot(propertyId);
  return slot ? slot.date : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest viewing.service --no-coverage
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/viewing.service.ts src/domains/viewing/__tests__/viewing.service.test.ts
git commit -m "feat(viewing): add createRecurringSlots and getLastUpcomingSlotDate service methods"
```

---

### Task 5: Add `POST /seller/viewings/slots/recurring` route

**Files:**
- Modify: `src/domains/viewing/viewing.router.ts`
- Modify: `src/domains/viewing/__tests__/viewing.router.test.ts`

**Context:** The router test uses `supertest` and mocks `viewingService`. The test app intercepts `res.render` and returns `{ _view: view, ...options }` as JSON. Study the existing `POST /seller/viewings/slots` route (around line 162) for the pattern.

- [ ] **Step 1: Write failing tests**

Add to `viewing.router.test.ts`:

```typescript
  describe('POST /seller/viewings/slots/recurring', () => {
    const validBody = {
      propertyId: 'prop-1',
      days: [
        {
          dayOfWeek: 1,
          timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }],
        },
      ],
    };

    it('returns slots-created partial for HTMX request', async () => {
      mockService.createRecurringSlots.mockResolvedValue({ count: 42 } as never);

      const res = await request(app)
        .post('/seller/viewings/slots/recurring')
        .set('hx-request', 'true')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body._view).toBe('partials/seller/slots-created');
      expect(res.body.count).toBe(42);
    });

    it('returns JSON for non-HTMX request', async () => {
      mockService.createRecurringSlots.mockResolvedValue({ count: 10 } as never);

      const res = await request(app)
        .post('/seller/viewings/slots/recurring')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(10);
    });

    it('returns 400 for invalid input', async () => {
      const res = await request(app)
        .post('/seller/viewings/slots/recurring')
        .send({ propertyId: 'p', days: [] });

      expect(res.status).toBe(400);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest viewing.router --no-coverage
```
Expected: FAIL — route not found (404)

- [ ] **Step 3: Add the route to `viewing.router.ts`**

Add the following import at the top of `viewing.router.ts`:
```typescript
import { validateCreateRecurringSlots } from './viewing.validator';
```

Add the new route after the existing bulk-delete route (before the public routes section). Place it **before** `POST /seller/viewings/slots` to avoid route shadowing:

```typescript
viewingRouter.post(
  '/seller/viewings/slots/recurring',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const input = validateCreateRecurringSlots(req.body);
      const result = await viewingService.createRecurringSlots(input, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/slots-created', { count: result.count });
      }
      return res.status(201).json({ success: true, count: result.count });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest viewing.router --no-coverage
```
Expected: all passing

- [ ] **Step 5: Run the full test suite to confirm nothing is broken**

```bash
npm test
```
Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add src/domains/viewing/viewing.router.ts src/domains/viewing/__tests__/viewing.router.test.ts
git commit -m "feat(viewing): add POST /seller/viewings/slots/recurring endpoint"
```

---

### Task 6: Expiry nudge banner — pass `lastSlotDate` to page + add banner to template

**Files:**
- Modify: `src/domains/viewing/viewing.router.ts` (GET /seller/viewings handler)
- Modify: `src/views/pages/seller/viewings.njk`

**Context:** The GET `/seller/viewings` handler (line 29 of viewing.router.ts) builds `dashboard` data and renders `pages/seller/viewings`. We need to add `lastSlotDate` and `daysUntilExpiry` to that render call. `viewingService.getLastUpcomingSlotDate` is the service method added in Task 4.

- [ ] **Step 1: Update GET /seller/viewings to pass lastSlotDate**

In `viewing.router.ts`, find the full-page render call (the one that renders `pages/seller/viewings`). It currently looks like:

```typescript
      return res.render('pages/seller/viewings', {
        stats,
        slots,
        propertyId,
        slotsByDate,
        page,
        hasMore,
        totalSlots,
      });
```

Replace with:

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

      return res.render('pages/seller/viewings', {
        stats,
        slots,
        propertyId,
        slotsByDate,
        page,
        hasMore,
        totalSlots,
        lastSlotDate,
        daysUntilExpiry,
      });
```

- [ ] **Step 2: Add expiry nudge banner to `viewings.njk`**

In `src/views/pages/seller/viewings.njk`, add the banner after the `page-header` include and before the `viewings-container` div:

```njk
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

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all passing (no template tests, just confirming nothing regressed)

- [ ] **Step 4: Commit**

```bash
git add src/domains/viewing/viewing.router.ts src/views/pages/seller/viewings.njk
git commit -m "feat(viewing): add expiry nudge banner to seller viewings page"
```

---

### Task 7: Replace recurring slots form in `viewings-dashboard.njk`

**Files:**
- Modify: `src/views/partials/seller/viewings-dashboard.njk`

**Context:** The Recurring Slots tab currently contains a form with id `recurring-slots-form` (around line 180). Replace everything inside the tab's `<div id="tab-recurring-content">` (or equivalent wrapper) with the new 7-day row table. The new form will have `id="recurring-slots-form-new"` — the existing `recurring-slots-form` id is removed since JS will drive this form via fetch (Task 8).

Read the full Recurring Slots tab section of `viewings-dashboard.njk` (lines 140–296 approximately) before editing to understand the exact boundaries.

The time `<select>` options are the same 21 options used in the Single Slot tab. Define a Nunjucks macro or just inline them — since Nunjucks in this project does not use macros (check existing patterns), inline the options each time.

- [ ] **Step 1: Read the current Recurring Slots tab section**

```bash
grep -n "tab-recurring\|recurring-slots\|bulk-start\|bulk-end\|Recurring" src/views/partials/seller/viewings-dashboard.njk | head -30
```

- [ ] **Step 2: Replace the Recurring Slots tab content**

Find the div wrapping the Recurring Slots tab content (it starts after the tab toggle and the calendar section). Replace the entire recurring form section (from the two-calendar date pickers through the `<div id="bulk-result">` element) with:

```njk
  {# ── Recurring Slots Tab ──────────────────────────────── #}
  <div id="tab-recurring-content" class="hidden">

    <form id="recurring-slots-form-new" data-property-id="{{ propertyId }}">
      <input type="hidden" name="propertyId" value="{{ propertyId }}">

      {# 7-day row table #}
      <div class="border border-gray-200 rounded-lg overflow-hidden mb-4">

        {# Header #}
        <div class="grid grid-cols-[44px_56px_1fr_1fr_120px] gap-0 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <div></div>
          <div>{{ "Day" | t }}</div>
          <div>{{ "Start" | t }}</div>
          <div>{{ "End" | t }}</div>
          <div>{{ "Type" | t }}</div>
        </div>

        {# Day rows — Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Sat(6) Sun(0) #}
        {% set days = [
          { dow: 1, label: "Mon", defaultStart: "18:00", defaultEnd: "20:00" },
          { dow: 2, label: "Tue", defaultStart: "18:00", defaultEnd: "20:00" },
          { dow: 3, label: "Wed", defaultStart: "18:00", defaultEnd: "20:00" },
          { dow: 4, label: "Thu", defaultStart: "18:00", defaultEnd: "20:00" },
          { dow: 5, label: "Fri", defaultStart: "18:00", defaultEnd: "20:00" },
          { dow: 6, label: "Sat", defaultStart: "13:00", defaultEnd: "17:00" },
          { dow: 0, label: "Sun", defaultStart: "13:00", defaultEnd: "17:00" }
        ] %}

        {% for day in days %}
        <div class="recurring-day-row border-b border-gray-100 last:border-b-0"
             data-dow="{{ day.dow }}"
             data-default-start="{{ day.defaultStart }}"
             data-default-end="{{ day.defaultEnd }}">

          {# First timeslot row #}
          <div class="recurring-timeslot grid grid-cols-[44px_56px_1fr_1fr_120px] gap-0 px-3 py-2 items-center bg-white">
            {# Toggle — first slot carries the toggle #}
            <div class="flex items-center">
              <button type="button"
                      class="recurring-day-toggle relative w-9 h-5 rounded-full transition-colors duration-200 bg-blue-500 focus:outline-none"
                      aria-pressed="true"
                      data-dow="{{ day.dow }}">
                <span class="absolute top-0.5 right-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"></span>
              </button>
            </div>
            <div class="text-sm font-semibold text-gray-800 recurring-day-label">{{ day.label }}</div>
            <div class="pr-2">
              <select name="startTime" class="recurring-time-select w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="10:00"{% if day.defaultStart == "10:00" %} selected{% endif %}>10:00 AM</option>
                <option value="10:30"{% if day.defaultStart == "10:30" %} selected{% endif %}>10:30 AM</option>
                <option value="11:00"{% if day.defaultStart == "11:00" %} selected{% endif %}>11:00 AM</option>
                <option value="11:30"{% if day.defaultStart == "11:30" %} selected{% endif %}>11:30 AM</option>
                <option value="12:00"{% if day.defaultStart == "12:00" %} selected{% endif %}>12:00 PM</option>
                <option value="12:30"{% if day.defaultStart == "12:30" %} selected{% endif %}>12:30 PM</option>
                <option value="13:00"{% if day.defaultStart == "13:00" %} selected{% endif %}>1:00 PM</option>
                <option value="13:30"{% if day.defaultStart == "13:30" %} selected{% endif %}>1:30 PM</option>
                <option value="14:00"{% if day.defaultStart == "14:00" %} selected{% endif %}>2:00 PM</option>
                <option value="14:30"{% if day.defaultStart == "14:30" %} selected{% endif %}>2:30 PM</option>
                <option value="15:00"{% if day.defaultStart == "15:00" %} selected{% endif %}>3:00 PM</option>
                <option value="15:30"{% if day.defaultStart == "15:30" %} selected{% endif %}>3:30 PM</option>
                <option value="16:00"{% if day.defaultStart == "16:00" %} selected{% endif %}>4:00 PM</option>
                <option value="16:30"{% if day.defaultStart == "16:30" %} selected{% endif %}>4:30 PM</option>
                <option value="17:00"{% if day.defaultStart == "17:00" %} selected{% endif %}>5:00 PM</option>
                <option value="17:30"{% if day.defaultStart == "17:30" %} selected{% endif %}>5:30 PM</option>
                <option value="18:00"{% if day.defaultStart == "18:00" %} selected{% endif %}>6:00 PM</option>
                <option value="18:30"{% if day.defaultStart == "18:30" %} selected{% endif %}>6:30 PM</option>
                <option value="19:00"{% if day.defaultStart == "19:00" %} selected{% endif %}>7:00 PM</option>
                <option value="19:30"{% if day.defaultStart == "19:30" %} selected{% endif %}>7:30 PM</option>
                <option value="20:00"{% if day.defaultStart == "20:00" %} selected{% endif %}>8:00 PM</option>
              </select>
            </div>
            <div class="pr-2">
              <select name="endTime" class="recurring-time-select w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="10:00"{% if day.defaultEnd == "10:00" %} selected{% endif %}>10:00 AM</option>
                <option value="10:30"{% if day.defaultEnd == "10:30" %} selected{% endif %}>10:30 AM</option>
                <option value="11:00"{% if day.defaultEnd == "11:00" %} selected{% endif %}>11:00 AM</option>
                <option value="11:30"{% if day.defaultEnd == "11:30" %} selected{% endif %}>11:30 AM</option>
                <option value="12:00"{% if day.defaultEnd == "12:00" %} selected{% endif %}>12:00 PM</option>
                <option value="12:30"{% if day.defaultEnd == "12:30" %} selected{% endif %}>12:30 PM</option>
                <option value="13:00"{% if day.defaultEnd == "13:00" %} selected{% endif %}>1:00 PM</option>
                <option value="13:30"{% if day.defaultEnd == "13:30" %} selected{% endif %}>1:30 PM</option>
                <option value="14:00"{% if day.defaultEnd == "14:00" %} selected{% endif %}>2:00 PM</option>
                <option value="14:30"{% if day.defaultEnd == "14:30" %} selected{% endif %}>2:30 PM</option>
                <option value="15:00"{% if day.defaultEnd == "15:00" %} selected{% endif %}>3:00 PM</option>
                <option value="15:30"{% if day.defaultEnd == "15:30" %} selected{% endif %}>3:30 PM</option>
                <option value="16:00"{% if day.defaultEnd == "16:00" %} selected{% endif %}>4:00 PM</option>
                <option value="16:30"{% if day.defaultEnd == "16:30" %} selected{% endif %}>4:30 PM</option>
                <option value="17:00"{% if day.defaultEnd == "17:00" %} selected{% endif %}>5:00 PM</option>
                <option value="17:30"{% if day.defaultEnd == "17:30" %} selected{% endif %}>7:30 PM</option>
                <option value="18:00"{% if day.defaultEnd == "18:00" %} selected{% endif %}>6:00 PM</option>
                <option value="18:30"{% if day.defaultEnd == "18:30" %} selected{% endif %}>6:30 PM</option>
                <option value="19:00"{% if day.defaultEnd == "19:00" %} selected{% endif %}>7:00 PM</option>
                <option value="19:30"{% if day.defaultEnd == "19:30" %} selected{% endif %}>7:30 PM</option>
                <option value="20:00"{% if day.defaultEnd == "20:00" %} selected{% endif %}>8:00 PM</option>
              </select>
            </div>
            <div class="flex items-center gap-1">
              <select name="slotType" class="recurring-type-select flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="single">{{ "Normal Viewing" | t }}</option>
                <option value="group">{{ "Open House" | t }}</option>
              </select>
              <button type="button" class="recurring-add-btn flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-base font-bold flex items-center justify-center hover:bg-blue-200 transition">+</button>
            </div>
          </div>
          {# Additional timeslot rows added dynamically by JS #}
        </div>
        {% endfor %}

      </div>

      <div class="flex items-center gap-3">
        <button type="submit"
                class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition">
          {{ "Create Recurring Slots" | t }}
        </button>
        <span class="text-xs text-gray-400">{{ "Creates slots for 1 month from today" | t }}</span>
      </div>
    </form>

    <div id="recurring-result" class="mt-3"></div>
  </div>
```

**Note on tab switching:** Check whether the existing JS tab-toggle mechanism uses `id="tab-recurring-content"` or another id/class. If the existing tab content div has a different id, match it exactly. Do not change the tab toggle buttons.

- [ ] **Step 3: Verify no existing recurring form elements remain**

```bash
grep -n "recurring-slots-form\b\|bulk-start\|bulk-end\|bulk-result\|bulk-start-calendar\|bulk-end-calendar\|dayOfWeek\|slotDurationMinutes" src/views/partials/seller/viewings-dashboard.njk
```

Expected: no matches (or only inside comments).

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/seller/viewings-dashboard.njk
git commit -m "feat(viewing): replace recurring slots form with 7-day row table"
```

---

### Task 8: Recurring slots JS — toggle, add/remove rows, JSON submit

**Files:**
- Modify: `public/js/app.js`

**Context:** The app.js file uses event delegation via `document.body.addEventListener`. All new handlers follow this pattern. The recurring form has `id="recurring-slots-form-new"`. Submission uses `fetch` (not HTMX) to POST JSON and swap the `#recurring-result` div with the response HTML.

The toggle button uses CSS classes `bg-blue-500` (on) / `bg-gray-300` (off), and the knob moves right (on) / left (off). When off, all `.recurring-time-select` and `.recurring-type-select` inputs in that row get `disabled` and the row gets `opacity-50`.

The add (+) button clones the timeslot row template. The remove (×) button removes its parent `.recurring-timeslot` row. The + button is hidden on the last row when 3 timeslots exist; the × button is hidden on the first row.

- [ ] **Step 1: Add the recurring slots JS block to `app.js`**

Find the comment `// Show server error under Add Slot button` in app.js and add the following block **before** it:

```javascript
  // ── Recurring Slots: toggle day rows ─────────────────────
  document.body.addEventListener('click', function (e) {
    var btn = e.target.closest('.recurring-day-toggle');
    if (!btn) return;
    var dayRow = btn.closest('.recurring-day-row');
    if (!dayRow) return;
    var isOn = btn.getAttribute('aria-pressed') === 'true';
    var turnOn = !isOn;

    btn.setAttribute('aria-pressed', String(turnOn));
    if (turnOn) {
      btn.classList.remove('bg-gray-300');
      btn.classList.add('bg-blue-500');
      btn.querySelector('span').style.transform = '';
    } else {
      btn.classList.remove('bg-blue-500');
      btn.classList.add('bg-gray-300');
      btn.querySelector('span').style.transform = 'translateX(-16px)';
    }

    dayRow.querySelectorAll('.recurring-time-select, .recurring-type-select').forEach(function (el) {
      el.disabled = !turnOn;
    });
    dayRow.querySelectorAll('.recurring-timeslot').forEach(function (row) {
      row.style.opacity = turnOn ? '' : '0.45';
    });
  });

  // ── Recurring Slots: add timeslot row ────────────────────
  document.body.addEventListener('click', function (e) {
    var addBtn = e.target.closest('.recurring-add-btn');
    if (!addBtn) return;
    var dayRow = addBtn.closest('.recurring-day-row');
    if (!dayRow) return;

    var timeslots = dayRow.querySelectorAll('.recurring-timeslot');
    if (timeslots.length >= 3) return;

    // Clone the last timeslot row
    var lastSlot = timeslots[timeslots.length - 1];
    var clone = lastSlot.cloneNode(true);

    // Reset selects to day defaults
    var dayDefaultStart = dayRow.dataset.defaultStart;
    var dayDefaultEnd = dayRow.dataset.defaultEnd;
    var startSel = clone.querySelectorAll('.recurring-time-select')[0];
    var endSel = clone.querySelectorAll('.recurring-time-select')[1];
    if (startSel && dayDefaultStart) startSel.value = dayDefaultStart;
    if (endSel && dayDefaultEnd) endSel.value = dayDefaultEnd;

    // Remove toggle from cloned row (only first row has it)
    var toggleInClone = clone.querySelector('.recurring-day-toggle');
    if (toggleInClone) toggleInClone.closest('div').innerHTML = '';

    // Remove day label from cloned row
    var labelInClone = clone.querySelector('.recurring-day-label');
    if (labelInClone) labelInClone.textContent = '';

    // Show remove (×) button; hide add (+) on previous last row
    addBtn.classList.add('hidden');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recurring-remove-btn flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-sm font-bold flex items-center justify-center hover:bg-gray-200 transition';
    removeBtn.textContent = '×';
    addBtn.parentNode.insertBefore(removeBtn, addBtn.nextSibling);

    // On clone: add button only if < 3 total
    var cloneAddBtn = clone.querySelector('.recurring-add-btn');
    if (cloneAddBtn) cloneAddBtn.classList.remove('hidden');

    dayRow.appendChild(clone);

    // Update add button visibility
    var newTimeslots = dayRow.querySelectorAll('.recurring-timeslot');
    if (newTimeslots.length >= 3) {
      var lastAddBtn = dayRow.querySelector('.recurring-timeslot:last-child .recurring-add-btn');
      if (lastAddBtn) lastAddBtn.classList.add('hidden');
    }
  });

  // ── Recurring Slots: remove timeslot row ─────────────────
  document.body.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.recurring-remove-btn');
    if (!removeBtn) return;
    var timeslotRow = removeBtn.closest('.recurring-timeslot');
    var dayRow = timeslotRow && timeslotRow.closest('.recurring-day-row');
    if (!timeslotRow || !dayRow) return;

    timeslotRow.remove();

    // Show add button on new last timeslot
    var remaining = dayRow.querySelectorAll('.recurring-timeslot');
    if (remaining.length < 3) {
      var lastSlot = remaining[remaining.length - 1];
      var addBtn = lastSlot && lastSlot.querySelector('.recurring-add-btn');
      if (addBtn) addBtn.classList.remove('hidden');
    }
  });

  // ── Recurring Slots: JSON submit ─────────────────────────
  var recurringForm = document.getElementById('recurring-slots-form-new');
  if (recurringForm) {
    recurringForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var propertyId = recurringForm.dataset.propertyId;
      var days = [];

      recurringForm.querySelectorAll('.recurring-day-row').forEach(function (dayRow) {
        var toggle = dayRow.querySelector('.recurring-day-toggle');
        if (!toggle || toggle.getAttribute('aria-pressed') !== 'true') return;

        var dow = parseInt(dayRow.dataset.dow, 10);
        var timeslots = [];

        dayRow.querySelectorAll('.recurring-timeslot').forEach(function (tsRow) {
          var selects = tsRow.querySelectorAll('.recurring-time-select');
          var typeSel = tsRow.querySelector('.recurring-type-select');
          var startTime = selects[0] ? selects[0].value : '';
          var endTime = selects[1] ? selects[1].value : '';
          var slotType = typeSel ? typeSel.value : 'single';
          if (startTime && endTime) {
            timeslots.push({ startTime: startTime, endTime: endTime, slotType: slotType });
          }
        });

        if (timeslots.length > 0) {
          days.push({ dayOfWeek: dow, timeslots: timeslots });
        }
      });

      if (days.length === 0) return;

      var resultDiv = document.getElementById('recurring-result');
      if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-gray-400">Creating slots…</p>';

      fetch('/seller/viewings/slots/recurring', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'hx-request': 'true',
        },
        body: JSON.stringify({ propertyId: propertyId, days: days }),
      })
        .then(function (res) { return res.text(); })
        .then(function (html) {
          if (resultDiv) resultDiv.innerHTML = html;
        })
        .catch(function () {
          if (resultDiv) resultDiv.innerHTML = '<p class="text-sm text-red-600">Something went wrong. Please try again.</p>';
        });
    });
  }
```

- [ ] **Step 2: Run all tests to confirm nothing regressed**

```bash
npm test
```
Expected: all passing

- [ ] **Step 3: Manual smoke test**

Start the dev server:
```bash
npm run dev
```

Navigate to `/seller/viewings` → Recurring Slots tab. Verify:
- All 7 days show with correct defaults (Mon–Fri 6pm–8pm, Sat–Sun 1pm–5pm)
- Toggle off a day → row greys out and selects become non-interactive
- Toggle back on → row activates with defaults re-applied
- '+' adds a second timeslot row (up to 3)
- '×' removes extra rows
- Submit with Mon enabled → `#recurring-result` shows "X viewing slot(s) created successfully."
- Expiry nudge banner appears when no slots exist

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat(viewing): add recurring slots JS (toggle, add/remove rows, JSON submit)"
```

---

### Final: run full test suite

- [ ] **Run all tests**

```bash
npm test && npm run test:integration
```
Expected: all passing

- [ ] **Build to verify TypeScript compiles**

```bash
npm run build
```
Expected: no errors
