# Recurring Schedule Design

## Goal

Replace the current recurring slot pre-generation model with a config-based recurring schedule. The seller defines a weekly pattern once; available time windows are computed on-the-fly at query time. `ViewingSlot` rows are only created when a buyer actually books, not upfront.

## Background

The current system materialises individual `ViewingSlot` rows for every recurring time window (15-minute sub-slots across a 1-month horizon). With a full 7-day schedule this generates ~300 rows upfront, exceeding the `MAX_ACTIVE_SLOTS = 200` guard. The root problem is generating rows for slots that will mostly never be booked.

## Architecture

### Core principle

Store recurring config once (`RecurringSchedule`). Generate virtual slot windows at query time. Materialise a `ViewingSlot` row only when a buyer books a recurring slot (materialize-on-booking).

Manual one-off slots continue to use `ViewingSlot` rows directly, unchanged.

---

## Data Model

### New table: `RecurringSchedule`

```prisma
model RecurringSchedule {
  id         String   @id @default(cuid())
  propertyId String   @unique
  days       Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  property Property @relation(fields: [propertyId], references: [id])

  @@map("recurring_schedules")
}
```

- One row per property (`@unique` on `propertyId`)
- `days` stores a `RecurringDayConfig[]` JSON array (same structure the form produces):

```typescript
[
  {
    dayOfWeek: 1, // 0=Sunday … 6=Saturday
    timeslots: [
      { startTime: "18:00", endTime: "20:00", slotType: "single" }
    ]
  }
]
```

Each `VirtualSlot` produced from the schedule carries `slotType` and derived `maxViewers` (via `calcOpenHouseMaxViewers` for group slots, 1 for single). These fields are passed to the buyer booking page so it can display capacity correctly for both virtual and materialised slots.

### Changes to `ViewingSlot`

**New field:** `source  SlotSource  @default(manual)`

```prisma
enum SlotSource {
  manual
  recurring
}
```

Existing rows default to `manual`. Rows materialised from the schedule get `recurring`.

**New unique constraint:**

```prisma
@@unique([propertyId, date, startTime, endTime])
```

Required for `INSERT ... ON CONFLICT DO NOTHING` in the booking flow. **Migration note:** Before adding this constraint, the migration must deduplicate any existing rows sharing the same `(propertyId, date, startTime, endTime)`. The deduplication step keeps the row with the lowest `ctid` and deletes others:

```sql
DELETE FROM viewing_slots
WHERE id NOT IN (
  SELECT DISTINCT ON (property_id, date, start_time, end_time) id
  FROM viewing_slots
  ORDER BY property_id, date, start_time, end_time, ctid
);
ALTER TABLE viewing_slots
  ADD CONSTRAINT viewing_slots_property_date_start_end_unique
  UNIQUE (property_id, date, start_time, end_time);
```

### `MAX_ACTIVE_SLOTS` scope

`MAX_ACTIVE_SLOTS` is removed **only from the recurring code path** (`createRecurringSlots`, which is being deleted). It is **retained** in `createSlot` and `createBulkSlots` for manual and bulk slot creation.

### Removed

- `findLastUpcomingSlot` repository function
- `getLastUpcomingSlotDate` service function
- `lastSlotDate` / `daysUntilExpiry` from dashboard render context

---

## Schedule CRUD

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/seller/viewings/schedule` | Upsert recurring schedule for property |
| DELETE | `/seller/viewings/schedule` | Delete recurring schedule |

### Behaviour

- **Save (upsert):** Resolves `propertyId` from the seller's active property (via `req.user`), not from the request body. Validates `days` using `validateCreateRecurringSlots` (the `propertyId` field of that validator's input is supplied server-side, not from the client). Overwrites the existing `RecurringSchedule` row. Returns the saved schedule.
- **Delete:** Removes the `RecurringSchedule` row. Already-materialised `ViewingSlot` rows with `source = 'recurring'` are unaffected — they remain and must be cancelled manually if needed.
- **GET `/seller/viewings`:** Loads the existing schedule (if any) and passes it to the template. The Recurring Slots tab pre-populates the 7-day grid from the saved schedule. If no schedule exists, the form shows the default values (Mon–Fri 18:00–20:00, Sat–Sun 13:00–17:00).

### Property lifecycle

When a property is cancelled or falls through (`cancelSlotsForPropertyCascade`), `deleteRecurringSchedule` is also called for that property. This prevents a stale schedule from generating virtual windows if the property is somehow revisited. Already-materialised `ViewingSlot` rows are cancelled via the existing cascade.

### UI changes

- "Create Recurring Slots" button → "Save Schedule"
- "Creates slots for 1 month from today" helper text → removed
- Expiry nudge banner in `viewings.njk` → removed

---

## Availability Computation

### `generateRecurringWindowsForRange(schedule, startDate, endDate): VirtualSlot[]`

Pure function (no DB access). Lives in a dedicated file: `src/domains/viewing/recurring.utils.ts`. Given a `RecurringSchedule` and a date range:

1. Iterate each date in the range
2. Find matching `days` entry by `dayOfWeek`
3. For each matching timeslot:
   - If `slotType === 'group'`: yield one window spanning `startTime`–`endTime`, with `maxViewers` from `calcOpenHouseMaxViewers`
   - If `slotType === 'single'`: yield 15-minute sub-windows, each with `maxViewers: 1`
4. Return `VirtualSlot[]` — each with a deterministic ID: `rec:{date}:{startTime}:{endTime}`, and fields: `date`, `startTime`, `endTime`, `slotType`, `maxViewers`

Tests live in `src/domains/viewing/__tests__/recurring.utils.test.ts`.

### Seller calendar: `getMonthSlotMeta`

1. Load `RecurringSchedule` for property
2. Call `generateRecurringWindowsForRange` for the month
3. Load actual `ViewingSlot` rows for the month (manual + materialised recurring)
4. Merge: for each virtual window, check if a matching `ViewingSlot` exists by `(date, startTime, endTime)`. If it does, use its status. If not, treat as `available`.
5. Return `Record<YYYY-MM-DD, { available: number; full: number }>` — unchanged shape.

Manual `ViewingSlot` rows with no matching virtual window are included as-is.

### Seller date sidebar: `getSlotsForDate`

Same merge logic scoped to a single date. The merged slot list (virtual + real) is passed to `findNextAvailableGap` so that the "Add Slot" form pre-fill correctly accounts for recurring windows even before they are materialised.

### Public booking page: `/view/:propertySlug`

Same merge logic scoped to next 30 days. Returns a unified slot list mixing manual `ViewingSlot` rows and virtual recurring windows. Virtual slots carry the `rec:` deterministic ID along with `slotType` and `maxViewers` so the buyer UI can display capacity correctly.

**Precedence rule:** If a manual `ViewingSlot` exists for the same `(date, startTime, endTime)` as a virtual recurring window, the manual slot takes precedence and the virtual window is suppressed.

---

## Booking Flow

### Manual slot (ID is a UUID)

Unchanged. The existing `createViewingWithLock` flow handles it entirely.

### Recurring slot (ID starts with `rec:`)

1. Parse ID → extract `date`, `startTime`, `endTime`
2. Load `RecurringSchedule` for property; verify the requested window exists in the schedule (prevents arbitrary slot fabrication)
3. Materialise the slot using a raw SQL upsert (**Prisma does not support `ON CONFLICT DO NOTHING` via ORM API; this step requires `prisma.$executeRaw`**). Column names use snake_case as stored in PostgreSQL:
   ```sql
   INSERT INTO viewing_slots (id, property_id, date, start_time, end_time,
     duration_minutes, slot_type, max_viewers, current_bookings, status, source, created_at)
   VALUES (...)
   ON CONFLICT (property_id, date, start_time, end_time) DO NOTHING
   ```
4. `SELECT ... FOR UPDATE` — acquire row-level lock on the now-existing row (standard Prisma query)
5. Perform `findDuplicateBooking` check using the materialised slot's UUID (not the `rec:` ID) — this sequencing is required because the UUID only exists after step 3
6. Continue with existing `createViewingWithLock` logic — capacity check, `currentBookings` increment, status transitions (`available → booked → full`), OTP, notifications — all unchanged

### Concurrency safety

Two buyers racing to book the same virtual slot:
- Both execute `INSERT ON CONFLICT` — one inserts, one skips
- Both execute `SELECT FOR UPDATE` — the lock serialises them
- The second buyer sees `currentBookings` already incremented and either gets a "slot full" error or proceeds if capacity allows (group slots)

---

## Files Affected

### New
- `prisma/migrations/YYYYMMDDHHMMSS_recurring_schedule/migration.sql`
- `src/domains/viewing/recurring.utils.ts` — `generateRecurringWindowsForRange` pure function
- `src/domains/viewing/__tests__/recurring.utils.test.ts`

### Modified
- `prisma/schema.prisma` — add `RecurringSchedule`, `SlotSource` enum, `ViewingSlot.source`, unique constraint
- `src/domains/viewing/viewing.types.ts` — add `VirtualSlot`, `SlotSource` types; add `RecurringScheduleRow`
- `src/domains/viewing/viewing.repository.ts` — add `findRecurringSchedule`, `upsertRecurringSchedule`, `deleteRecurringSchedule`; update `cancelSlotsForPropertyCascade` to also delete schedule; update slot queries to include `source`
- `src/domains/viewing/viewing.service.ts` — rewrite `getMonthSlotMeta`, `getSlotsForDate` to merge virtual + real; add `saveSchedule`, `deleteSchedule`; update `initiateBooking` to handle `rec:` IDs; remove `createRecurringSlots`, `getLastUpcomingSlotDate`
- `src/domains/viewing/viewing.validator.ts` — `validateCreateRecurringSlots` reused; `propertyId` supplied server-side by router, not from client body
- `src/domains/viewing/viewing.router.ts` — add `POST/DELETE /seller/viewings/schedule`; remove `POST /seller/viewings/slots/recurring`; load schedule in GET `/seller/viewings`; remove expiry fields
- `src/views/pages/seller/viewings.njk` — remove expiry nudge banner
- `src/views/partials/seller/viewings-dashboard.njk` — pre-populate recurring form from saved schedule; update submit button label
- `public/js/app.js` — update fetch target to `/seller/viewings/schedule`; remove expiry-related JS

### Removed logic (not files)
- `createRecurringSlots` service function
- `getLastUpcomingSlotDate` service function
- `findLastUpcomingSlot` repository function
- `MAX_ACTIVE_SLOTS` guard in `createRecurringSlots` only (retained in `createSlot` and `createBulkSlots`)

---

## Testing

- `generateRecurringWindowsForRange` — unit tests in `recurring.utils.test.ts`: correct windows per day, 15-min subdivision, group slot spanning, correct `slotType`/`maxViewers` on virtual slots, edge cases (empty schedule, date range boundaries, SGT midnight)
- `getMonthSlotMeta` — unit tests: virtual-only month, manual-only month, mixed (virtual suppressed by manual), materialised recurring overlay
- `getSlotsForDate` — unit test: virtual windows fed into `findNextAvailableGap` correctly
- Booking flow — integration tests: book virtual slot (materialises row), concurrent booking race (lock serialises correctly), invalid `rec:` ID rejected, `findDuplicateBooking` uses materialised UUID not `rec:` ID, valid UUID slot unchanged
- Schedule CRUD — integration tests: upsert creates/overwrites, delete removes config without affecting materialised rows, cascade cancel also deletes schedule
