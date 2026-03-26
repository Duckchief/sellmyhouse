# Phase 2D: Viewing Scheduler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build viewing slot management for sellers and a public booking portal with OTP verification for buyers/agents.

**Architecture:** Monolithic viewing service following existing domain patterns (repository → service → router). OTP stored on Viewing record. Cron jobs for reminders via existing `registerJob()` infrastructure. Six-layer spam protection on public booking route.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), node-cron, bcrypt, HTMX, Nunjucks, Jest

**Spec:** `docs/superpowers/specs/2026-03-11-phase-2d-viewing-scheduler-design.md`

**Run tests after each section:** `npm test && npm run test:integration`

---

## Chunk 1: Schema, Types & Repository

### Task 1: Prisma Schema Changes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `slug` to Property model**

Add after the `status` field on the Property model:

```prisma
  slug            String?        @unique
```

- [ ] **Step 2: Add `viewer` to RecipientType enum**

```prisma
enum RecipientType {
  seller
  agent
  viewer
}
```

- [ ] **Step 3: Add fields to VerifiedViewer model**

Add after `lastBookingAt`:

```prisma
  noShowCount     Int        @default(0) @map("no_show_count")
```

- [ ] **Step 4: Add fields to Viewing model**

Add after `feedback`:

```prisma
  interestRating  Int?       @map("interest_rating")
  otpHash         String?    @map("otp_hash")
  otpExpiresAt    DateTime?  @map("otp_expires_at")
  otpAttempts     Int        @default(0) @map("otp_attempts")
```

- [ ] **Step 5: Run migration**

```bash
npx prisma migrate dev --name add-viewing-scheduler-fields
```

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(viewing): add schema fields for viewing scheduler"
```

---

### Task 2: Update Types

**Files:**
- Modify: `src/domains/viewing/viewing.types.ts`
- Modify: `src/domains/notification/notification.types.ts`

- [ ] **Step 1: Update ViewingFeedbackInput**

In `src/domains/viewing/viewing.types.ts`, change:

```typescript
export interface ViewingFeedbackInput {
  feedback: string;
}
```

To:

```typescript
export interface ViewingFeedbackInput {
  feedback: string;
  interestRating: number; // 1-5
}
```

- [ ] **Step 2: Add BookingResult type**

Add after `ViewingFeedbackInput`:

```typescript
export interface BookingResult {
  viewingId: string;
  status: 'pending_otp' | 'scheduled';
  isReturningViewer: boolean;
  noShowWarning?: { count: number };
}

export interface ViewingStatsResult {
  totalViewings: number;
  upcomingCount: number;
  averageInterestRating: number | null;
  noShowCount: number;
}
```

- [ ] **Step 3: Add new notification template names**

In `src/domains/notification/notification.types.ts`, add to `NotificationTemplateName`:

```typescript
export type NotificationTemplateName =
  | 'welcome_seller'
  | 'viewing_booked'
  | 'viewing_booked_seller'
  | 'viewing_cancelled'
  | 'viewing_reminder'
  | 'viewing_reminder_viewer'
  | 'viewing_feedback_prompt'
  | 'offer_received'
  | 'offer_countered'
  | 'offer_accepted'
  | 'transaction_update'
  | 'document_ready'
  | 'invoice_uploaded'
  | 'agreement_sent'
  | 'financial_report_ready'
  | 'generic';
```

Also update the `RecipientType` type alias if it exists separately from the Prisma enum:

```typescript
export type RecipientType = 'seller' | 'agent' | 'viewer';
```

- [ ] **Step 4: Add notification templates**

In `src/domains/notification/notification.service.ts`, add to the TEMPLATES object:

```typescript
  viewing_booked_seller: 'New viewing booked for {{address}} on {{date}} at {{time}}. Viewer: {{viewerName}} ({{viewerType}}).{{noShowWarning}}',
  viewing_reminder_viewer: 'Reminder: Your viewing at {{address}} is at {{time}} today.',
  viewing_feedback_prompt: 'How did the viewing go for {{address}} on {{date}}? Please log your feedback.',
```

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/viewing.types.ts src/domains/notification/
git commit -m "feat(viewing): update types and notification templates for viewing scheduler"
```

---

### Task 3: Repository Layer

**Files:**
- Create: `src/domains/viewing/viewing.repository.ts`
- Create: `src/domains/viewing/__tests__/viewing.repository.test.ts`

- [ ] **Step 1: Write repository tests**

Create `src/domains/viewing/__tests__/viewing.repository.test.ts`:

```typescript
import * as viewingRepo from '../viewing.repository';
import { prisma } from '@/infra/database/prisma';
import type { Prisma } from '@prisma/client';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    viewingSlot: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    viewing: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    verifiedViewer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

const mockedPrisma = jest.mocked(prisma);

describe('viewing.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createSlot', () => {
    it('creates a viewing slot', async () => {
      const slotData = {
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-01'),
        startTime: '10:00',
        endTime: '10:15',
        durationMinutes: 15,
        slotType: 'single' as const,
        maxViewers: 1,
      };

      mockedPrisma.viewingSlot.create.mockResolvedValue({
        ...slotData,
        currentBookings: 0,
        status: 'available',
        createdAt: new Date(),
      } as never);

      const result = await viewingRepo.createSlot(slotData);

      expect(mockedPrisma.viewingSlot.create).toHaveBeenCalledWith({
        data: slotData,
      });
      expect(result.status).toBe('available');
    });
  });

  describe('createManySlots', () => {
    it('creates multiple slots', async () => {
      const slots = [
        { id: 'slot-1', propertyId: 'prop-1', date: new Date(), startTime: '10:00', endTime: '10:15', durationMinutes: 15, slotType: 'single' as const, maxViewers: 1 },
        { id: 'slot-2', propertyId: 'prop-1', date: new Date(), startTime: '10:15', endTime: '10:30', durationMinutes: 15, slotType: 'single' as const, maxViewers: 1 },
      ];

      mockedPrisma.viewingSlot.createMany.mockResolvedValue({ count: 2 });

      const result = await viewingRepo.createManySlots(slots);

      expect(result.count).toBe(2);
    });
  });

  describe('findVerifiedViewerByPhone', () => {
    it('finds viewer by phone', async () => {
      mockedPrisma.verifiedViewer.findUnique.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        name: 'John',
        noShowCount: 0,
      } as never);

      const result = await viewingRepo.findVerifiedViewerByPhone('91234567');

      expect(result?.phone).toBe('91234567');
    });

    it('returns null when not found', async () => {
      mockedPrisma.verifiedViewer.findUnique.mockResolvedValue(null);

      const result = await viewingRepo.findVerifiedViewerByPhone('99999999');

      expect(result).toBeNull();
    });
  });

  describe('incrementNoShow', () => {
    it('increments no-show count', async () => {
      mockedPrisma.verifiedViewer.update.mockResolvedValue({
        id: 'viewer-1',
        noShowCount: 3,
      } as never);

      await viewingRepo.incrementNoShow('viewer-1');

      expect(mockedPrisma.verifiedViewer.update).toHaveBeenCalledWith({
        where: { id: 'viewer-1' },
        data: { noShowCount: { increment: 1 } },
      });
    });
  });

  describe('findSlotsByPropertyAndDateRange', () => {
    it('finds slots within date range', async () => {
      mockedPrisma.viewingSlot.findMany.mockResolvedValue([
        { id: 'slot-1', date: new Date('2026-04-01'), status: 'available' },
      ] as never);

      const result = await viewingRepo.findSlotsByPropertyAndDateRange(
        'prop-1',
        new Date('2026-04-01'),
        new Date('2026-04-07'),
      );

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith({
        where: {
          propertyId: 'prop-1',
          date: { gte: new Date('2026-04-01'), lte: new Date('2026-04-07') },
        },
        include: { viewings: { include: { verifiedViewer: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('updateViewingStatus', () => {
    it('updates viewing status', async () => {
      mockedPrisma.viewing.update.mockResolvedValue({
        id: 'viewing-1',
        status: 'completed',
        completedAt: new Date(),
      } as never);

      await viewingRepo.updateViewingStatus('viewing-1', {
        status: 'completed',
        completedAt: new Date(),
      });

      expect(mockedPrisma.viewing.update).toHaveBeenCalledWith({
        where: { id: 'viewing-1' },
        data: expect.objectContaining({ status: 'completed' }),
      });
    });
  });

  describe('getViewingStats', () => {
    it('returns aggregated stats', async () => {
      mockedPrisma.viewing.count.mockResolvedValueOnce(10); // total
      mockedPrisma.viewing.count.mockResolvedValueOnce(3); // upcoming
      mockedPrisma.viewing.count.mockResolvedValueOnce(1); // no-shows
      mockedPrisma.$queryRaw.mockResolvedValue([{ avg: 3.5 }]);

      const result = await viewingRepo.getViewingStats('prop-1');

      expect(result.totalViewings).toBe(10);
      expect(result.upcomingCount).toBe(3);
      expect(result.noShowCount).toBe(1);
      expect(result.averageInterestRating).toBe(3.5);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="viewing.repository" --verbose
```

Expected: FAIL — `viewing.repository` module not found.

- [ ] **Step 3: Write repository implementation**

Create `src/domains/viewing/viewing.repository.ts`:

```typescript
import { prisma } from '@/infra/database/prisma';
import type { Prisma, SlotType } from '@prisma/client';

// ─── Slots ───────────────────────────────────────────────

export async function createSlot(data: {
  id: string;
  propertyId: string;
  date: Date;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  slotType: SlotType;
  maxViewers: number;
}) {
  return prisma.viewingSlot.create({ data });
}

export async function createManySlots(
  data: {
    id: string;
    propertyId: string;
    date: Date;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    slotType: SlotType;
    maxViewers: number;
  }[],
) {
  return prisma.viewingSlot.createMany({ data });
}

export async function findSlotById(id: string) {
  return prisma.viewingSlot.findUnique({
    where: { id },
    include: { viewings: { include: { verifiedViewer: true } }, property: true },
  });
}

export async function findSlotsByPropertyAndDateRange(
  propertyId: string,
  startDate: Date,
  endDate: Date,
) {
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      date: { gte: startDate, lte: endDate },
    },
    include: { viewings: { include: { verifiedViewer: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

export async function updateSlotStatus(
  id: string,
  data: { status?: string; currentBookings?: number },
) {
  return prisma.viewingSlot.update({ where: { id }, data });
}

export async function cancelSlotAndViewings(slotId: string) {
  return prisma.$transaction(async (tx) => {
    // Cancel all viewings for this slot
    await tx.viewing.updateMany({
      where: { viewingSlotId: slotId, status: { notIn: ['cancelled'] } },
      data: { status: 'cancelled' },
    });

    // Cancel the slot and reset bookings
    return tx.viewingSlot.update({
      where: { id: slotId },
      data: { status: 'cancelled', currentBookings: 0 },
    });
  });
}

// ─── Bookings ────────────────────────────────────────────

export async function createViewingWithLock(data: {
  id: string;
  propertyId: string;
  viewingSlotId: string;
  verifiedViewerId: string;
  cancelToken: string;
  status: string;
  scheduledAt: Date;
  otpHash?: string;
  otpExpiresAt?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    // Lock the slot row to prevent concurrent bookings
    const [slot] = await tx.$queryRaw<
      { id: string; current_bookings: number; max_viewers: number; slot_type: string; status: string }[]
    >`SELECT id, current_bookings, max_viewers, slot_type, status FROM viewing_slots WHERE id = ${data.viewingSlotId} FOR UPDATE`;

    if (!slot) throw new Error('Slot not found');
    if (slot.status === 'cancelled') throw new Error('Slot is cancelled');
    if (slot.status === 'full') throw new Error('Slot is full');
    if (slot.slot_type === 'single' && slot.current_bookings >= 1) throw new Error('Slot is full');
    if (slot.current_bookings >= slot.max_viewers) throw new Error('Slot is full');

    // Create the viewing
    const viewing = await tx.viewing.create({ data });

    // Increment bookings and update status
    const newBookings = slot.current_bookings + 1;
    let newStatus = 'booked';
    if (slot.slot_type === 'single') {
      newStatus = 'booked';
    } else if (newBookings >= slot.max_viewers) {
      newStatus = 'full';
    }

    await tx.viewingSlot.update({
      where: { id: data.viewingSlotId },
      data: { currentBookings: { increment: 1 }, status: newStatus },
    });

    return viewing;
  });
}

export async function findViewingById(id: string) {
  return prisma.viewing.findUnique({
    where: { id },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function findViewingByCancelToken(cancelToken: string) {
  return prisma.viewing.findUnique({
    where: { cancelToken },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function updateViewingStatus(
  id: string,
  data: {
    status?: string;
    completedAt?: Date;
    feedback?: string;
    interestRating?: number;
    otpHash?: string;
    otpExpiresAt?: Date;
    otpAttempts?: number;
  },
) {
  return prisma.viewing.update({ where: { id }, data });
}

export async function findViewingsBySlot(slotId: string) {
  return prisma.viewing.findMany({
    where: { viewingSlotId: slotId, status: { notIn: ['cancelled'] } },
    include: { verifiedViewer: true },
  });
}

export async function findDuplicateBooking(phone: string, slotId: string) {
  return prisma.viewing.findFirst({
    where: {
      viewingSlotId: slotId,
      verifiedViewer: { phone },
      status: { notIn: ['cancelled'] },
    },
  });
}

export async function countBookingsToday(phone: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return prisma.viewing.count({
    where: {
      verifiedViewer: { phone },
      createdAt: { gte: today, lt: tomorrow },
      status: { notIn: ['cancelled'] },
    },
  });
}

// ─── Viewers ─────────────────────────────────────────────

export async function findVerifiedViewerByPhone(phone: string) {
  return prisma.verifiedViewer.findUnique({ where: { phone } });
}

export async function createVerifiedViewer(data: {
  id: string;
  name: string;
  phone: string;
  viewerType: 'buyer' | 'agent';
  agentName?: string;
  agentCeaReg?: string;
  agentAgencyName?: string;
  consentService: boolean;
}) {
  return prisma.verifiedViewer.create({ data });
}

export async function incrementNoShow(viewerId: string) {
  return prisma.verifiedViewer.update({
    where: { id: viewerId },
    data: { noShowCount: { increment: 1 } },
  });
}

export async function incrementBookings(viewerId: string) {
  return prisma.verifiedViewer.update({
    where: { id: viewerId },
    data: {
      totalBookings: { increment: 1 },
      lastBookingAt: new Date(),
    },
  });
}

// ─── Queries ─────────────────────────────────────────────

export async function findUpcomingViewingsForProperty(propertyId: string) {
  return prisma.viewing.findMany({
    where: {
      propertyId,
      status: 'scheduled',
      scheduledAt: { gte: new Date() },
    },
    include: { viewingSlot: true, verifiedViewer: true },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function getViewingStats(propertyId: string) {
  const totalViewings = await prisma.viewing.count({
    where: { propertyId, status: { notIn: ['cancelled', 'pending_otp'] } },
  });

  const upcomingCount = await prisma.viewing.count({
    where: { propertyId, status: 'scheduled', scheduledAt: { gte: new Date() } },
  });

  const noShowCount = await prisma.viewing.count({
    where: { propertyId, status: 'no_show' },
  });

  const avgRating = await prisma.$queryRaw<{ avg: number | null }[]>`
    SELECT AVG(interest_rating)::float as avg
    FROM viewings
    WHERE property_id = ${propertyId}
      AND interest_rating IS NOT NULL
  `;

  return {
    totalViewings,
    upcomingCount,
    noShowCount,
    averageInterestRating: avgRating[0]?.avg ?? null,
  };
}

export async function findViewingsNeedingReminder(fromMinutes: number, toMinutes: number) {
  const now = new Date();
  const from = new Date(now.getTime() + fromMinutes * 60000);
  const to = new Date(now.getTime() + toMinutes * 60000);

  return prisma.viewing.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { gte: from, lte: to },
    },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function findTodaysViewingsGroupedBySeller() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return prisma.viewing.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      viewingSlot: true,
      verifiedViewer: true,
      property: { include: { seller: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function findViewingsNeedingFeedbackPrompt() {
  // Use slot end time (not completedAt) per spec
  // Find completed viewings whose slot ended >1hr ago without feedback
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  return prisma.$queryRaw`
    SELECT v.*, vs.date, vs.end_time, vs.start_time,
           p.seller_id, p.town, p.street
    FROM viewings v
    JOIN viewing_slots vs ON v.viewing_slot_id = vs.id
    JOIN properties p ON v.property_id = p.id
    WHERE v.status = 'completed'
      AND v.feedback IS NULL
      AND (vs.date + vs.end_time::time) < ${oneHourAgoIso}::timestamptz
  `;
}

export async function findPropertyById(id: string) {
  return prisma.property.findUnique({ where: { id } });
}

export async function findPropertyBySlug(slug: string) {
  return prisma.property.findFirst({
    where: { slug, status: 'listed' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="viewing.repository" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/
git commit -m "feat(viewing): add repository layer with tests"
```

---

## Chunk 2: Validator

### Task 4: Validator Layer

**Files:**
- Create: `src/domains/viewing/viewing.validator.ts`
- Create: `src/domains/viewing/__tests__/viewing.validator.test.ts`

- [ ] **Step 1: Write validator tests**

Create `src/domains/viewing/__tests__/viewing.validator.test.ts`:

```typescript
import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from '../viewing.validator';
import { ValidationError } from '@/domains/shared/errors';

describe('viewing.validator', () => {
  describe('validateCreateSlot', () => {
    const validInput = {
      propertyId: 'prop-1',
      date: '2026-04-15',
      startTime: '10:00',
      endTime: '10:15',
    };

    it('accepts valid input with defaults', () => {
      const result = validateCreateSlot(validInput);
      expect(result.propertyId).toBe('prop-1');
      expect(result.slotType).toBe('single');
      expect(result.maxViewers).toBe(1);
    });

    it('accepts group slot with maxViewers', () => {
      const result = validateCreateSlot({
        ...validInput,
        slotType: 'group',
        maxViewers: '5',
      });
      expect(result.slotType).toBe('group');
      expect(result.maxViewers).toBe(5);
    });

    it('rejects past date', () => {
      expect(() =>
        validateCreateSlot({ ...validInput, date: '2020-01-01' }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid time format', () => {
      expect(() =>
        validateCreateSlot({ ...validInput, startTime: '25:00' }),
      ).toThrow(ValidationError);
    });

    it('rejects end time before start time', () => {
      expect(() =>
        validateCreateSlot({ ...validInput, startTime: '10:00', endTime: '09:00' }),
      ).toThrow(ValidationError);
    });

    it('requires maxViewers for group slots', () => {
      expect(() =>
        validateCreateSlot({ ...validInput, slotType: 'group' }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateCreateBulkSlots', () => {
    const validInput = {
      propertyId: 'prop-1',
      startDate: '2026-04-01',
      endDate: '2026-04-28',
      dayOfWeek: '6',
      startTime: '10:00',
      endTime: '12:00',
      slotDurationMinutes: '15',
    };

    it('accepts valid bulk input', () => {
      const result = validateCreateBulkSlots(validInput);
      expect(result.dayOfWeek).toBe(6);
      expect(result.slotDurationMinutes).toBe(15);
    });

    it('rejects endDate before startDate', () => {
      expect(() =>
        validateCreateBulkSlots({ ...validInput, endDate: '2026-03-01' }),
      ).toThrow(ValidationError);
    });

    it('rejects range exceeding 8 weeks', () => {
      expect(() =>
        validateCreateBulkSlots({ ...validInput, endDate: '2026-07-01' }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid dayOfWeek', () => {
      expect(() =>
        validateCreateBulkSlots({ ...validInput, dayOfWeek: '7' }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateBookingForm', () => {
    const validInput = {
      name: 'John Doe',
      phone: '91234567',
      viewerType: 'buyer',
      consentService: 'true',
      slotId: 'slot-1',
      formLoadedAt: String(Date.now() - 10000),
    };

    it('accepts valid buyer input', () => {
      const result = validateBookingForm(validInput);
      expect(result.name).toBe('John Doe');
      expect(result.viewerType).toBe('buyer');
    });

    it('accepts valid agent input', () => {
      const result = validateBookingForm({
        ...validInput,
        viewerType: 'agent',
        agentName: 'Jane Agent',
        agentCeaReg: 'R123456A',
        agentAgencyName: 'PropCo',
      });
      expect(result.viewerType).toBe('agent');
      expect(result.agentName).toBe('Jane Agent');
    });

    it('rejects invalid SG phone', () => {
      expect(() =>
        validateBookingForm({ ...validInput, phone: '12345678' }),
      ).toThrow(ValidationError);
    });

    it('rejects phone not starting with 8 or 9', () => {
      expect(() =>
        validateBookingForm({ ...validInput, phone: '71234567' }),
      ).toThrow(ValidationError);
    });

    it('requires agent fields when viewerType is agent', () => {
      expect(() =>
        validateBookingForm({ ...validInput, viewerType: 'agent' }),
      ).toThrow(ValidationError);
    });

    it('requires consent', () => {
      expect(() =>
        validateBookingForm({ ...validInput, consentService: 'false' }),
      ).toThrow(ValidationError);
    });

    it('rejects missing name', () => {
      expect(() =>
        validateBookingForm({ ...validInput, name: '' }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateOtp', () => {
    it('accepts valid OTP', () => {
      const result = validateOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });
      expect(result.otp).toBe('123456');
    });

    it('rejects non-6-digit OTP', () => {
      expect(() => validateOtp({ phone: '91234567', otp: '12345', bookingId: 'v-1' })).toThrow(
        ValidationError,
      );
    });

    it('rejects missing bookingId', () => {
      expect(() => validateOtp({ phone: '91234567', otp: '123456' })).toThrow(ValidationError);
    });
  });

  describe('validateFeedback', () => {
    it('accepts valid feedback with rating', () => {
      const result = validateFeedback({ feedback: 'Good viewing', interestRating: '4' });
      expect(result.feedback).toBe('Good viewing');
      expect(result.interestRating).toBe(4);
    });

    it('rejects rating outside 1-5', () => {
      expect(() => validateFeedback({ feedback: 'Ok', interestRating: '6' })).toThrow(
        ValidationError,
      );
    });

    it('rejects rating of 0', () => {
      expect(() => validateFeedback({ feedback: 'Ok', interestRating: '0' })).toThrow(
        ValidationError,
      );
    });

    it('rejects feedback over 1000 chars', () => {
      expect(() =>
        validateFeedback({ feedback: 'a'.repeat(1001), interestRating: '3' }),
      ).toThrow(ValidationError);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="viewing.validator" --verbose
```

Expected: FAIL — `viewing.validator` module not found.

- [ ] **Step 3: Write validator implementation**

Create `src/domains/viewing/viewing.validator.ts`:

```typescript
import { ValidationError } from '@/domains/shared/errors';
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
} from './viewing.types';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const SG_PHONE_REGEX = /^[89]\d{7}$/;
const MAX_BULK_WEEKS = 8;

export function validateCreateSlot(body: Record<string, unknown>): CreateSlotInput {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ValidationError('Property ID is required');

  const dateStr = String(body.date || '');
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new ValidationError('Invalid date');
  if (date < new Date(new Date().toDateString())) throw new ValidationError('Date must be in the future');

  const startTime = String(body.startTime || '');
  if (!TIME_REGEX.test(startTime)) throw new ValidationError('Start time must be HH:MM format');

  const endTime = String(body.endTime || '');
  if (!TIME_REGEX.test(endTime)) throw new ValidationError('End time must be HH:MM format');

  if (endTime <= startTime) throw new ValidationError('End time must be after start time');

  const slotType = (String(body.slotType || 'single')) as 'single' | 'group';
  if (!['single', 'group'].includes(slotType)) throw new ValidationError('Invalid slot type');

  let maxViewers = 1;
  if (slotType === 'group') {
    maxViewers = Number(body.maxViewers);
    if (!body.maxViewers || isNaN(maxViewers) || maxViewers < 2) {
      throw new ValidationError('Group slots require maxViewers >= 2');
    }
  }

  const durationMinutes = Number(body.durationMinutes) || undefined;

  return { propertyId, date, startTime, endTime, durationMinutes, slotType, maxViewers };
}

export function validateCreateBulkSlots(body: Record<string, unknown>): CreateBulkSlotsInput {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ValidationError('Property ID is required');

  const startDate = new Date(String(body.startDate || ''));
  if (isNaN(startDate.getTime())) throw new ValidationError('Invalid start date');
  if (startDate < new Date(new Date().toDateString())) throw new ValidationError('Start date must be in the future');

  const endDate = new Date(String(body.endDate || ''));
  if (isNaN(endDate.getTime())) throw new ValidationError('Invalid end date');
  if (endDate <= startDate) throw new ValidationError('End date must be after start date');

  const diffWeeks = (endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
  if (diffWeeks > MAX_BULK_WEEKS) throw new ValidationError(`Date range cannot exceed ${MAX_BULK_WEEKS} weeks`);

  const dayOfWeek = Number(body.dayOfWeek);
  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ValidationError('Day of week must be 0 (Sunday) to 6 (Saturday)');
  }

  const startTime = String(body.startTime || '');
  if (!TIME_REGEX.test(startTime)) throw new ValidationError('Start time must be HH:MM format');

  const endTime = String(body.endTime || '');
  if (!TIME_REGEX.test(endTime)) throw new ValidationError('End time must be HH:MM format');

  if (endTime <= startTime) throw new ValidationError('End time must be after start time');

  const slotDurationMinutes = Number(body.slotDurationMinutes);
  if (isNaN(slotDurationMinutes) || slotDurationMinutes < 5 || slotDurationMinutes > 120) {
    throw new ValidationError('Slot duration must be between 5 and 120 minutes');
  }

  const slotType = (String(body.slotType || 'single')) as 'single' | 'group';
  if (!['single', 'group'].includes(slotType)) throw new ValidationError('Invalid slot type');

  let maxViewers = 1;
  if (slotType === 'group') {
    maxViewers = Number(body.maxViewers);
    if (!body.maxViewers || isNaN(maxViewers) || maxViewers < 2) {
      throw new ValidationError('Group slots require maxViewers >= 2');
    }
  }

  return { propertyId, startDate, endDate, dayOfWeek, startTime, endTime, slotDurationMinutes, slotType, maxViewers };
}

export function validateBookingForm(body: Record<string, unknown>): BookingFormInput {
  const name = String(body.name || '').trim();
  if (!name) throw new ValidationError('Name is required');

  const phone = String(body.phone || '').replace(/\s/g, '');
  if (!SG_PHONE_REGEX.test(phone)) {
    throw new ValidationError('Please enter a valid Singapore mobile number (8 digits starting with 8 or 9)');
  }

  const viewerType = String(body.viewerType || '') as 'buyer' | 'agent';
  if (!['buyer', 'agent'].includes(viewerType)) throw new ValidationError('Viewer type must be buyer or agent');

  let agentName: string | undefined;
  let agentCeaReg: string | undefined;
  let agentAgencyName: string | undefined;

  if (viewerType === 'agent') {
    agentName = String(body.agentName || '').trim();
    agentCeaReg = String(body.agentCeaReg || '').trim();
    agentAgencyName = String(body.agentAgencyName || '').trim();
    if (!agentName || !agentCeaReg || !agentAgencyName) {
      throw new ValidationError('Agent name, CEA registration, and agency name are required for agent viewers');
    }
  }

  const consentService = body.consentService === true || body.consentService === 'true';
  if (!consentService) throw new ValidationError('Service consent is required to book a viewing');

  const slotId = String(body.slotId || '');
  if (!slotId) throw new ValidationError('Slot ID is required');

  const website = body.website ? String(body.website) : undefined;
  const formLoadedAt = body.formLoadedAt ? Number(body.formLoadedAt) : undefined;

  return { name, phone, viewerType, agentName, agentCeaReg, agentAgencyName, consentService, slotId, website, formLoadedAt };
}

export function validateOtp(body: Record<string, unknown>): VerifyOtpInput {
  const phone = String(body.phone || '').replace(/\s/g, '');
  if (!SG_PHONE_REGEX.test(phone)) throw new ValidationError('Invalid phone number');

  const otp = String(body.otp || '');
  if (!/^\d{6}$/.test(otp)) throw new ValidationError('OTP must be 6 digits');

  const bookingId = String(body.bookingId || '');
  if (!bookingId) throw new ValidationError('Booking ID is required');

  return { phone, otp, bookingId };
}

export function validateFeedback(body: Record<string, unknown>): ViewingFeedbackInput {
  const feedback = String(body.feedback || '').trim();
  if (!feedback) throw new ValidationError('Feedback is required');
  if (feedback.length > 1000) throw new ValidationError('Feedback must be 1000 characters or less');

  const interestRating = Number(body.interestRating);
  if (isNaN(interestRating) || interestRating < 1 || interestRating > 5 || !Number.isInteger(interestRating)) {
    throw new ValidationError('Interest rating must be an integer between 1 and 5');
  }

  return { feedback, interestRating };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="viewing.validator" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/
git commit -m "feat(viewing): add validator layer with tests"
```

---

## Chunk 3: Service Layer — Slot Management & Booking Flow

### Task 5: Service Layer

**Files:**
- Create: `src/domains/viewing/viewing.service.ts`
- Create: `src/domains/viewing/__tests__/viewing.service.test.ts`

- [ ] **Step 1: Write service tests**

Create `src/domains/viewing/__tests__/viewing.service.test.ts`:

```typescript
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import * as viewingService from '../viewing.service';
import * as viewingRepo from '../viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import { NotFoundError, ValidationError, ConflictError } from '@/domains/shared/errors';
import { OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS, MIN_FORM_SUBMIT_SECONDS, BOOKINGS_PER_PHONE_PER_DAY } from '../viewing.types';

jest.mock('../viewing.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/settings.service');
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-id-123' }));
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-otp'),
  compare: jest.fn().mockResolvedValue(true),
}));

const mockedRepo = jest.mocked(viewingRepo);
const mockedAudit = jest.mocked(auditService);
const mockedNotification = jest.mocked(notificationService);
const mockedSettings = jest.mocked(settingsService);

describe('viewing.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSettings.getNumber.mockResolvedValue(15);
  });

  // ─── Slot Management ───────────────────────────────────

  describe('createSlot', () => {
    it('creates a single slot with defaults', async () => {
      mockedRepo.createSlot.mockResolvedValue({
        id: 'test-id-123',
        propertyId: 'prop-1',
        status: 'available',
      } as never);

      const result = await viewingService.createSlot({
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
        endTime: '10:15',
      }, 'seller-1');

      expect(mockedRepo.createSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyId: 'prop-1',
          slotType: 'single',
          maxViewers: 1,
          durationMinutes: 15,
        }),
      );
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'viewing.slot_created' }),
      );
    });
  });

  describe('createBulkSlots', () => {
    it('generates correct number of slots for weekly recurring', async () => {
      mockedRepo.createManySlots.mockResolvedValue({ count: 8 });

      // 4 Saturdays, 2-hour window with 15-min slots = 4 * 8 = 32 slots
      const result = await viewingService.createBulkSlots({
        propertyId: 'prop-1',
        startDate: new Date('2026-04-04'), // Saturday
        endDate: new Date('2026-04-25'),   // 4th Saturday
        dayOfWeek: 6,
        startTime: '10:00',
        endTime: '12:00',
        slotDurationMinutes: 15,
      }, 'seller-1');

      const callArg = mockedRepo.createManySlots.mock.calls[0][0];
      expect(callArg.length).toBe(32); // 4 Saturdays * 8 slots each
      expect(mockedAudit.log).toHaveBeenCalled();
    });
  });

  describe('cancelSlot', () => {
    it('cancels slot and notifies all viewers', async () => {
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        status: 'booked',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);

      mockedRepo.findViewingsBySlot.mockResolvedValue([
        { id: 'v-1', verifiedViewer: { id: 'viewer-1', phone: '91234567' } },
        { id: 'v-2', verifiedViewer: { id: 'viewer-2', phone: '81234567' } },
      ] as never);

      mockedRepo.cancelSlotAndViewings.mockResolvedValue({ id: 'slot-1' } as never);

      await viewingService.cancelSlot('slot-1', 'seller-1');

      expect(mockedRepo.cancelSlotAndViewings).toHaveBeenCalledWith('slot-1');
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'viewing.slot_cancelled' }),
      );
    });

    it('throws NotFoundError for nonexistent slot', async () => {
      mockedRepo.findSlotById.mockResolvedValue(null);

      await expect(viewingService.cancelSlot('bad-id', 'seller-1')).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if seller does not own property', async () => {
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        property: { sellerId: 'other-seller' },
      } as never);

      await expect(viewingService.cancelSlot('slot-1', 'seller-1')).rejects.toThrow();
    });
  });

  // ─── Booking Flow ──────────────────────────────────────

  describe('initiateBooking', () => {
    const validInput = {
      name: 'John Doe',
      phone: '91234567',
      viewerType: 'buyer' as const,
      consentService: true,
      slotId: 'slot-1',
      formLoadedAt: Date.now() - 10000,
    };

    it('rejects honeypot-filled form silently', async () => {
      const result = await viewingService.initiateBooking(
        { ...validInput, website: 'spam.com' },
        '127.0.0.1',
      );

      expect(result).toEqual({ spam: true });
      expect(mockedRepo.createViewingWithLock).not.toHaveBeenCalled();
    });

    it('rejects too-fast submission silently', async () => {
      const result = await viewingService.initiateBooking(
        { ...validInput, formLoadedAt: Date.now() - 1000 },
        '127.0.0.1',
      );

      expect(result).toEqual({ spam: true });
    });

    it('rejects duplicate booking', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        viewingService.initiateBooking(validInput, '127.0.0.1'),
      ).rejects.toThrow(ConflictError);
    });

    it('rejects when daily booking limit exceeded', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(BOOKINGS_PER_PHONE_PER_DAY);

      await expect(
        viewingService.initiateBooking(validInput, '127.0.0.1'),
      ).rejects.toThrow(ValidationError);
    });

    it('creates booking with OTP for new viewer', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null);
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'test-id-123',
        phone: '91234567',
        noShowCount: 0,
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'pending_otp',
      } as never);

      const result = await viewingService.initiateBooking(validInput, '127.0.0.1');

      expect(result).toEqual(expect.objectContaining({
        viewingId: 'test-id-123',
        status: 'pending_otp',
        isReturningViewer: false,
      }));
      expect(mockedNotification.send).toHaveBeenCalled(); // OTP sent
    });

    it('skips OTP for returning verified viewer', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        phoneVerifiedAt: new Date(),
        noShowCount: 0,
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'scheduled',
      } as never);
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'test-id-123',
        property: { sellerId: 'seller-1', town: 'Bishan' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { name: 'John', viewerType: 'buyer' },
      } as never);

      const result = await viewingService.initiateBooking(validInput, '127.0.0.1');

      expect(result).toEqual(expect.objectContaining({
        status: 'scheduled',
        isReturningViewer: true,
      }));
      expect(mockedRepo.incrementBookings).toHaveBeenCalledWith('viewer-1');
    });

    it('includes no-show warning for viewer with history', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        phoneVerifiedAt: new Date(),
        noShowCount: 2,
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'scheduled',
      } as never);
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'test-id-123',
        property: { sellerId: 'seller-1', town: 'Bishan' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { name: 'John', viewerType: 'buyer', noShowCount: 2 },
      } as never);

      const result = await viewingService.initiateBooking(validInput, '127.0.0.1');

      expect(result.noShowWarning).toEqual({ count: 2 });
    });
  });

  // ─── OTP Verification ─────────────────────────────────

  describe('verifyOtp', () => {
    it('verifies valid OTP and transitions to scheduled', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: 0,
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1', town: 'Bishan' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { id: 'viewer-1', name: 'John', viewerType: 'buyer' },
      } as never);

      await viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'scheduled' });
      expect(mockedRepo.incrementBookings).toHaveBeenCalledWith('viewer-1');
    });

    it('rejects expired OTP', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() - 1000), // expired
        otpAttempts: 0,
      } as never);

      await expect(
        viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects after max attempts', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: OTP_MAX_ATTEMPTS,
      } as never);

      await expect(
        viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // ─── Cancellation ──────────────────────────────────────

  describe('cancelViewing', () => {
    it('cancels viewing and decrements slot bookings', async () => {
      mockedRepo.findViewingByCancelToken.mockResolvedValue({
        id: 'v-1',
        viewingSlotId: 'slot-1',
        status: 'scheduled',
        viewingSlot: { id: 'slot-1', currentBookings: 1, maxViewers: 1, slotType: 'single' },
        property: { sellerId: 'seller-1', town: 'Bishan' },
        verifiedViewer: { name: 'John' },
      } as never);

      await viewingService.cancelViewing('v-1', 'cancel-token-123');

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'cancelled' });
      expect(mockedRepo.updateSlotStatus).toHaveBeenCalledWith('slot-1', {
        currentBookings: 0,
        status: 'available',
      });
      expect(mockedNotification.send).toHaveBeenCalled();
    });

    it('throws if viewing already cancelled', async () => {
      mockedRepo.findViewingByCancelToken.mockResolvedValue({
        id: 'v-1',
        status: 'cancelled',
      } as never);

      await expect(
        viewingService.cancelViewing('v-1', 'cancel-token'),
      ).rejects.toThrow(ValidationError);
    });
  });

  // ─── Post-Viewing ─────────────────────────────────────

  describe('submitFeedback', () => {
    it('saves feedback and rating', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'completed',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.submitFeedback('v-1', 'seller-1', {
        feedback: 'Good viewing',
        interestRating: 4,
      });

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', {
        feedback: 'Good viewing',
        interestRating: 4,
      });
    });

    it('throws if seller does not own property', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'completed',
        property: { sellerId: 'other-seller' },
      } as never);

      await expect(
        viewingService.submitFeedback('v-1', 'seller-1', { feedback: 'Ok', interestRating: 3 }),
      ).rejects.toThrow();
    });
  });

  describe('markNoShow', () => {
    it('transitions to no_show and increments viewer count', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'scheduled',
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.markNoShow('v-1', 'seller-1');

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'no_show' });
      expect(mockedRepo.incrementNoShow).toHaveBeenCalledWith('viewer-1');
    });
  });

  describe('markCompleted', () => {
    it('transitions to completed', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'scheduled',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.markCompleted('v-1', 'seller-1');

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', {
        status: 'completed',
        completedAt: expect.any(Date),
      });
    });
  });

  // ─── Reminders ─────────────────────────────────────────

  describe('sendMorningReminders', () => {
    it('groups viewings by seller and sends one notification each', async () => {
      mockedRepo.findTodaysViewingsGroupedBySeller.mockResolvedValue([
        {
          id: 'v-1',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '10:00' },
          verifiedViewer: { name: 'John' },
        },
        {
          id: 'v-2',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '11:00' },
          verifiedViewer: { name: 'Jane' },
        },
        {
          id: 'v-3',
          property: { sellerId: 'seller-2', town: 'Tampines', street: 'Tampines St 42' },
          viewingSlot: { startTime: '14:00' },
          verifiedViewer: { name: 'Bob' },
        },
      ] as never);

      await viewingService.sendMorningReminders();

      // 2 sellers = 2 notifications
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendOneHourReminders', () => {
    it('sends individual reminders to viewers and sellers', async () => {
      mockedRepo.findViewingsNeedingReminder.mockResolvedValue([
        {
          id: 'v-1',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '10:00', date: new Date() },
          verifiedViewer: { id: 'viewer-1', name: 'John' },
        },
      ] as never);

      await viewingService.sendOneHourReminders();

      // 1 viewing = 2 notifications (viewer + seller)
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Stats ─────────────────────────────────────────────

  describe('getViewingStats', () => {
    it('returns aggregated stats', async () => {
      mockedRepo.getViewingStats.mockResolvedValue({
        totalViewings: 10,
        upcomingCount: 3,
        noShowCount: 1,
        averageInterestRating: 3.5,
      });

      const result = await viewingService.getViewingStats('prop-1', 'seller-1');

      expect(result.totalViewings).toBe(10);
      expect(result.averageInterestRating).toBe(3.5);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="viewing.service" --verbose
```

Expected: FAIL — `viewing.service` module not found.

- [ ] **Step 3: Write service implementation**

Create `src/domains/viewing/viewing.service.ts`:

```typescript
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';
import * as viewingRepo from './viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '@/domains/shared/errors';
import {
  computeSlotStatus,
  canTransitionViewing,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  MIN_FORM_SUBMIT_SECONDS,
  BOOKINGS_PER_PHONE_PER_DAY,
  DEFAULT_SLOT_DURATION_MINUTES,
} from './viewing.types';
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
  BookingResult,
} from './viewing.types';

// ─── Slot Management ─────────────────────────────────────

export async function createSlot(input: CreateSlotInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  const durationMinutes =
    input.durationMinutes ??
    (await settingsService.getNumber('viewing_slot_duration', DEFAULT_SLOT_DURATION_MINUTES));

  const slot = await viewingRepo.createSlot({
    id: createId(),
    propertyId: input.propertyId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    durationMinutes,
    slotType: input.slotType ?? 'single',
    maxViewers: input.maxViewers ?? 1,
  });

  await auditService.log({
    action: 'viewing.slot_created',
    entityType: 'viewing_slot',
    entityId: slot.id,
    details: { propertyId: input.propertyId, sellerId },
  });

  return slot;
}

export async function createBulkSlots(input: CreateBulkSlotsInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  const slots: {
    id: string;
    propertyId: string;
    date: Date;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    slotType: 'single' | 'group';
    maxViewers: number;
  }[] = [];

  const current = new Date(input.startDate);
  const end = new Date(input.endDate);

  while (current <= end) {
    if (current.getDay() === input.dayOfWeek) {
      // Generate time slots within the window
      const [startH, startM] = input.startTime.split(':').map(Number);
      const [endH, endM] = input.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      for (let t = startMinutes; t + input.slotDurationMinutes <= endMinutes; t += input.slotDurationMinutes) {
        const slotStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        const slotEnd = `${String(Math.floor((t + input.slotDurationMinutes) / 60)).padStart(2, '0')}:${String((t + input.slotDurationMinutes) % 60).padStart(2, '0')}`;

        slots.push({
          id: createId(),
          propertyId: input.propertyId,
          date: new Date(current),
          startTime: slotStart,
          endTime: slotEnd,
          durationMinutes: input.slotDurationMinutes,
          slotType: input.slotType ?? 'single',
          maxViewers: input.maxViewers ?? 1,
        });
      }
    }
    current.setDate(current.getDate() + 1);
  }

  const result = await viewingRepo.createManySlots(slots);

  await auditService.log({
    action: 'viewing.bulk_slots_created',
    entityType: 'viewing_slot',
    entityId: input.propertyId,
    details: { count: slots.length, sellerId },
  });

  return { count: slots.length, slots };
}

export async function cancelSlot(slotId: string, sellerId: string) {
  const slot = await viewingRepo.findSlotById(slotId);
  if (!slot) throw new NotFoundError('ViewingSlot', slotId);
  if ((slot as { property: { sellerId: string } }).property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }

  // Get viewers to notify before cancelling
  const viewings = await viewingRepo.findViewingsBySlot(slotId);

  await viewingRepo.cancelSlotAndViewings(slotId);

  // Notify all viewers
  const property = (slot as { property: { town: string; street: string } }).property;
  for (const viewing of viewings) {
    const viewer = (viewing as { verifiedViewer: { id: string } }).verifiedViewer;
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewer.id,
        templateName: 'viewing_cancelled',
        templateData: {
          address: `${property.town} ${property.street}`,
          date: `${slot.date.toISOString().split('T')[0]} ${slot.startTime}`,
        },
      },
      'system',
    );
  }

  await auditService.log({
    action: 'viewing.slot_cancelled',
    entityType: 'viewing_slot',
    entityId: slotId,
    details: { sellerId, cancelledViewings: viewings.length },
  });
}

// ─── Booking Flow ────────────────────────────────────────

export async function initiateBooking(
  input: BookingFormInput,
  ip: string,
): Promise<BookingResult | { spam: true }> {
  // Spam check 1: Honeypot
  if (input.website) return { spam: true };

  // Spam check 2: Time-based
  if (input.formLoadedAt) {
    const elapsed = (Date.now() - input.formLoadedAt) / 1000;
    if (elapsed < MIN_FORM_SUBMIT_SECONDS) return { spam: true };
  }

  // Spam check 3: Duplicate detection
  const duplicate = await viewingRepo.findDuplicateBooking(input.phone, input.slotId);
  if (duplicate) throw new ConflictError('You have already booked this slot');

  // Spam check 4: Daily booking limit
  const todayCount = await viewingRepo.countBookingsToday(input.phone);
  if (todayCount >= BOOKINGS_PER_PHONE_PER_DAY) {
    throw new ValidationError('Maximum booking limit reached for today. Please try again tomorrow.');
  }

  // Find or create verified viewer
  let viewer = await viewingRepo.findVerifiedViewerByPhone(input.phone);
  const isReturningViewer = !!(viewer?.phoneVerifiedAt);

  if (!viewer) {
    viewer = await viewingRepo.createVerifiedViewer({
      id: createId(),
      name: input.name,
      phone: input.phone,
      viewerType: input.viewerType,
      agentName: input.agentName,
      agentCeaReg: input.agentCeaReg,
      agentAgencyName: input.agentAgencyName,
      consentService: input.consentService,
    });
  }

  const noShowWarning = (viewer as { noShowCount?: number }).noShowCount && (viewer as { noShowCount: number }).noShowCount > 0
    ? { count: (viewer as { noShowCount: number }).noShowCount }
    : undefined;

  // Determine status based on returning viewer
  const status = isReturningViewer ? 'scheduled' : 'pending_otp';

  // Generate OTP for new viewers
  let otpHash: string | undefined;
  let otpExpiresAt: Date | undefined;

  if (!isReturningViewer) {
    const otp = generateOtp();
    otpHash = await bcrypt.hash(otp, 10);
    otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Send OTP via WhatsApp
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewer.id,
        templateName: 'generic',
        templateData: {
          message: `Your SellMyHouse viewing verification code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
        },
        preferredChannel: 'whatsapp',
      },
      'system',
    );
  }

  const cancelToken = crypto.randomBytes(32).toString('hex');

  // Look up slot to get propertyId and compute scheduledAt
  const slot = await viewingRepo.findSlotById(input.slotId);
  if (!slot) throw new NotFoundError('ViewingSlot', input.slotId);

  const slotData = slot as { id: string; propertyId: string; date: Date; startTime: string };
  const [h, m] = slotData.startTime.split(':').map(Number);
  const scheduledAt = new Date(slotData.date);
  scheduledAt.setHours(h, m, 0, 0);

  // Create viewing with row-level lock on slot
  const viewing = await viewingRepo.createViewingWithLock({
    id: createId(),
    propertyId: slotData.propertyId,
    viewingSlotId: input.slotId,
    verifiedViewerId: viewer.id,
    cancelToken,
    status,
    scheduledAt,
    otpHash,
    otpExpiresAt,
  });

  if (isReturningViewer) {
    await viewingRepo.incrementBookings(viewer.id);

    // Notify seller about booking
    const fullViewing = await viewingRepo.findViewingById(viewing.id);
    if (fullViewing) {
      const property = (fullViewing as { property: { sellerId: string; town: string; street: string } }).property;
      const slot = (fullViewing as { viewingSlot: { date: Date; startTime: string } }).viewingSlot;
      const vw = (fullViewing as { verifiedViewer: { name: string; viewerType: string } }).verifiedViewer;

      const noShowNote = noShowWarning
        ? ` Warning: This viewer has ${noShowWarning.count} previous no-show(s).`
        : '';

      await notificationService.send(
        {
          recipientType: 'seller',
          recipientId: property.sellerId,
          templateName: 'viewing_booked_seller',
          templateData: {
            address: `${property.town} ${property.street}`,
            date: slot.date.toISOString().split('T')[0],
            time: slot.startTime,
            viewerName: vw.name,
            viewerType: vw.viewerType,
            noShowWarning: noShowNote,
          },
        },
        'system',
      );

      // Booking confirmation to viewer
      await notificationService.send(
        {
          recipientType: 'viewer',
          recipientId: viewer.id,
          templateName: 'viewing_booked',
          templateData: {
            address: `${property.town} ${property.street}`,
            date: `${slot.date.toISOString().split('T')[0]} ${slot.startTime}`,
          },
          preferredChannel: 'whatsapp',
        },
        'system',
      );
    }
  }

  await auditService.log({
    action: 'viewing.booking_initiated',
    entityType: 'viewing',
    entityId: viewing.id,
    details: { slotId: input.slotId, isReturningViewer, viewerId: viewer.id },
  });

  return {
    viewingId: viewing.id,
    status: status as 'pending_otp' | 'scheduled',
    isReturningViewer,
    noShowWarning,
  };
}

export async function verifyOtp(input: VerifyOtpInput) {
  const viewing = await viewingRepo.findViewingById(input.bookingId);
  if (!viewing) throw new NotFoundError('Viewing', input.bookingId);

  const v = viewing as {
    id: string;
    status: string;
    otpHash: string | null;
    otpExpiresAt: Date | null;
    otpAttempts: number;
    verifiedViewerId: string;
    property: { sellerId: string; town: string; street: string };
    viewingSlot: { date: Date; startTime: string };
    verifiedViewer: { id: string; name: string; viewerType: string };
  };

  if (v.status !== 'pending_otp') {
    throw new ValidationError('This booking is not awaiting OTP verification');
  }

  if (v.otpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new ValidationError('Maximum OTP attempts exceeded. Please request a new booking.');
  }

  if (!v.otpExpiresAt || v.otpExpiresAt < new Date()) {
    throw new ValidationError('OTP has expired. Please request a new booking.');
  }

  const isValid = await bcrypt.compare(input.otp, v.otpHash!);

  if (!isValid) {
    await viewingRepo.updateViewingStatus(v.id, { otpAttempts: v.otpAttempts + 1 });
    throw new ValidationError('Invalid OTP');
  }

  // OTP valid — transition to scheduled
  await viewingRepo.updateViewingStatus(v.id, { status: 'scheduled' });
  await viewingRepo.incrementBookings(v.verifiedViewerId);

  // Notify seller
  const noShowCount = (v.verifiedViewer as { noShowCount?: number }).noShowCount ?? 0;
  const noShowNote = noShowCount > 0 ? ` Warning: This viewer has ${noShowCount} previous no-show(s).` : '';

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: v.property.sellerId,
      templateName: 'viewing_booked_seller',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: v.viewingSlot.date.toISOString().split('T')[0],
        time: v.viewingSlot.startTime,
        viewerName: v.verifiedViewer.name,
        viewerType: v.verifiedViewer.viewerType,
        noShowWarning: noShowNote,
      },
    },
    'system',
  );

  // Send booking confirmation to viewer
  await notificationService.send(
    {
      recipientType: 'viewer',
      recipientId: v.verifiedViewerId,
      templateName: 'viewing_booked',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: `${v.viewingSlot.date.toISOString().split('T')[0]} ${v.viewingSlot.startTime}`,
      },
      preferredChannel: 'whatsapp',
    },
    'system',
  );

  await auditService.log({
    action: 'viewing.otp_verified',
    entityType: 'viewing',
    entityId: v.id,
    details: { viewerId: v.verifiedViewerId },
  });
}

// ─── Cancellation ────────────────────────────────────────

export async function cancelViewing(viewingId: string, cancelToken: string) {
  const viewing = await viewingRepo.findViewingByCancelToken(cancelToken);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as {
    id: string;
    status: string;
    viewingSlotId: string;
    viewingSlot: { id: string; currentBookings: number; maxViewers: number; slotType: string };
    property: { sellerId: string; town: string; street: string };
    verifiedViewer: { name: string };
  };

  if (v.status === 'cancelled' || v.status === 'completed' || v.status === 'no_show') {
    throw new ValidationError('This viewing cannot be cancelled');
  }

  await viewingRepo.updateViewingStatus(v.id, { status: 'cancelled' });

  // Decrement slot bookings and recalculate status
  const newBookings = Math.max(0, v.viewingSlot.currentBookings - 1);
  const newStatus = computeSlotStatus(newBookings, v.viewingSlot.maxViewers, v.viewingSlot.slotType);
  await viewingRepo.updateSlotStatus(v.viewingSlotId, {
    currentBookings: newBookings,
    status: newStatus,
  });

  // Notify seller
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: v.property.sellerId,
      templateName: 'viewing_cancelled',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: `cancelled by ${v.verifiedViewer.name}`,
      },
    },
    'system',
  );

  await auditService.log({
    action: 'viewing.cancelled',
    entityType: 'viewing',
    entityId: v.id,
    details: { cancelledBy: 'viewer' },
  });
}

// ─── Post-Viewing ────────────────────────────────────────

export async function submitFeedback(
  viewingId: string,
  sellerId: string,
  input: ViewingFeedbackInput,
) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }

  await viewingRepo.updateViewingStatus(viewingId, {
    feedback: input.feedback,
    interestRating: input.interestRating,
  });

  await auditService.log({
    action: 'viewing.feedback_submitted',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId, interestRating: input.interestRating },
  });
}

export async function markNoShow(viewingId: string, sellerId: string) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { status: string; verifiedViewerId: string; property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
  if (!canTransitionViewing(v.status, 'no_show')) {
    throw new ValidationError(`Cannot mark as no-show from status: ${v.status}`);
  }

  await viewingRepo.updateViewingStatus(viewingId, { status: 'no_show' });
  await viewingRepo.incrementNoShow(v.verifiedViewerId);

  await auditService.log({
    action: 'viewing.marked_no_show',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId, viewerId: v.verifiedViewerId },
  });
}

export async function markCompleted(viewingId: string, sellerId: string) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { status: string; property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
  if (!canTransitionViewing(v.status, 'completed')) {
    throw new ValidationError(`Cannot mark as completed from status: ${v.status}`);
  }

  await viewingRepo.updateViewingStatus(viewingId, {
    status: 'completed',
    completedAt: new Date(),
  });

  await auditService.log({
    action: 'viewing.marked_completed',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId },
  });
}

// ─── Reminders ───────────────────────────────────────────

export async function sendMorningReminders() {
  const viewings = await viewingRepo.findTodaysViewingsGroupedBySeller();

  // Group by seller
  const bySeller = new Map<string, typeof viewings>();
  for (const v of viewings) {
    const sellerId = (v as { property: { sellerId: string } }).property.sellerId;
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(v);
  }

  for (const [sellerId, sellerViewings] of bySeller) {
    const lines = sellerViewings.map((v) => {
      const slot = (v as { viewingSlot: { startTime: string } }).viewingSlot;
      const viewer = (v as { verifiedViewer: { name: string } }).verifiedViewer;
      return `${slot.startTime} - ${viewer.name}`;
    });

    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: sellerId,
        templateName: 'viewing_reminder',
        templateData: {
          address: 'your property',
          date: `Today's viewings:\n${lines.join('\n')}`,
        },
      },
      'system',
    );
  }
}

export async function sendOneHourReminders() {
  const viewings = await viewingRepo.findViewingsNeedingReminder(60, 75);

  for (const v of viewings) {
    const viewing = v as {
      property: { sellerId: string; town: string; street: string };
      viewingSlot: { startTime: string; date: Date };
      verifiedViewer: { id: string; name: string };
    };

    // Notify viewer
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewing.verifiedViewer.id,
        templateName: 'viewing_reminder_viewer',
        templateData: {
          address: `${viewing.property.town} ${viewing.property.street}`,
          time: viewing.viewingSlot.startTime,
        },
        preferredChannel: 'whatsapp',
      },
      'system',
    );

    // Notify seller
    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: viewing.property.sellerId,
        templateName: 'viewing_reminder',
        templateData: {
          address: `${viewing.property.town} ${viewing.property.street}`,
          date: `${viewing.viewingSlot.startTime} - ${viewing.verifiedViewer.name}`,
        },
      },
      'system',
    );
  }
}

export async function sendFeedbackPrompts() {
  const viewings = await viewingRepo.findViewingsNeedingFeedbackPrompt();

  for (const v of viewings) {
    const viewing = v as {
      property: { sellerId: string; town: string; street: string };
      viewingSlot: { date: Date };
    };

    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: viewing.property.sellerId,
        templateName: 'viewing_feedback_prompt',
        templateData: {
          address: `${viewing.property.town} ${viewing.property.street}`,
          date: viewing.viewingSlot.date.toISOString().split('T')[0],
        },
      },
      'system',
    );
  }
}

// ─── Stats ───────────────────────────────────────────────

export async function getViewingStats(propertyId: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);
  return viewingRepo.getViewingStats(propertyId);
}

export async function getSellerDashboard(propertyId: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);
  const stats = await viewingRepo.getViewingStats(propertyId);
  const slots = await viewingRepo.findSlotsByPropertyAndDateRange(
    propertyId,
    new Date(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );
  return { stats, slots };
}

export async function getPublicBookingPage(slug: string) {
  const property = await viewingRepo.findPropertyBySlug(slug);
  if (!property) return null;

  const slots = await viewingRepo.findSlotsByPropertyAndDateRange(
    (property as { id: string }).id,
    new Date(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );

  const availableSlots = slots.filter(
    (s) => (s as { status: string }).status === 'available',
  );

  return { property, availableSlots };
}

export async function getViewingByCancelToken(cancelToken: string) {
  return viewingRepo.findViewingByCancelToken(cancelToken);
}

// ─── Helpers ─────────────────────────────────────────────

async function verifyPropertyOwnership(propertyId: string, sellerId: string) {
  const property = await viewingRepo.findPropertyById(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  if ((property as { sellerId: string }).sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="viewing.service" --verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/viewing/
git commit -m "feat(viewing): add service layer with tests"
```

---

## Chunk 4: Router & App Registration

### Task 6: Router Layer

**Files:**
- Create: `src/domains/viewing/viewing.router.ts`
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Write router implementation**

Create `src/domains/viewing/viewing.router.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import * as viewingService from './viewing.service';
import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from './viewing.validator';
import { requireAuth } from '@/infra/http/middleware/require-auth';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { BOOKING_ATTEMPTS_PER_IP_PER_HOUR } from './viewing.types';
import rateLimit from 'express-rate-limit';

export const viewingRouter = Router();

// ─── Rate limiter for public booking ─────────────────────
const bookingRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: BOOKING_ATTEMPTS_PER_IP_PER_HOUR,
  message: { error: 'Too many booking attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Seller Routes ───────────────────────────────────────

viewingRouter.get(
  '/seller/viewings',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const propertyId = req.query.propertyId as string;

      const dashboard = propertyId
        ? await viewingService.getSellerDashboard(propertyId, user.id)
        : { stats: null, slots: [] };

      const { stats, slots } = dashboard;

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewings-dashboard', { stats, slots, propertyId });
      }
      return res.json({ success: true, stats, slots });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/slots',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;

      if (req.body.bulk === 'true' || req.body.bulk === true) {
        const input = validateCreateBulkSlots(req.body);
        const result = await viewingService.createBulkSlots(input, user.id);

        if (req.headers['hx-request']) {
          return res.render('partials/seller/slots-created', { count: result.count });
        }
        return res.status(201).json({ success: true, ...result });
      }

      const input = validateCreateSlot(req.body);
      const slot = await viewingService.createSlot(input, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/slot-row', { slot });
      }
      return res.status(201).json({ success: true, slot });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.delete(
  '/seller/viewings/slots/:id',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.cancelSlot(req.params.id, user.id);

      if (req.headers['hx-request']) {
        return res.send(''); // HTMX removes the element
      }
      return res.json({ success: true, message: 'Slot cancelled' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/feedback',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const input = validateFeedback(req.body);
      await viewingService.submitFeedback(req.params.id, user.id, input);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/feedback-saved', { viewingId: req.params.id });
      }
      return res.json({ success: true, message: 'Feedback saved' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/no-show',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markNoShow(req.params.id, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', { viewingId: req.params.id, status: 'no_show' });
      }
      return res.json({ success: true, message: 'Marked as no-show' });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/seller/viewings/:id/complete',
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await viewingService.markCompleted(req.params.id, user.id);

      if (req.headers['hx-request']) {
        return res.render('partials/seller/viewing-status', { viewingId: req.params.id, status: 'completed' });
      }
      return res.json({ success: true, message: 'Marked as completed' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Public Routes ───────────────────────────────────────

viewingRouter.get(
  '/view/:propertySlug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pageData = await viewingService.getPublicBookingPage(req.params.propertySlug);
      if (!pageData) return res.status(404).render('404');

      return res.render('public/viewing-booking', {
        property: pageData.property,
        slots: pageData.availableSlots,
        formLoadedAt: Date.now(),
      });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/:propertySlug/book',
  bookingRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = validateBookingForm(req.body);
      const result = await viewingService.initiateBooking(input, req.ip || '');

      if ('spam' in result) {
        // Return fake success to avoid giving bots feedback
        if (req.headers['hx-request']) {
          return res.render('partials/public/booking-success');
        }
        return res.json({ success: true, message: 'Booking submitted' });
      }

      if (result.status === 'pending_otp') {
        if (req.headers['hx-request']) {
          return res.render('partials/public/otp-form', { bookingId: result.viewingId, phone: input.phone });
        }
        return res.json({ success: true, requiresOtp: true, bookingId: result.viewingId });
      }

      // Returning viewer — booked immediately
      if (req.headers['hx-request']) {
        return res.render('partials/public/booking-success', { viewingId: result.viewingId });
      }
      return res.json({ success: true, viewingId: result.viewingId });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/:propertySlug/verify-otp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = validateOtp(req.body);
      await viewingService.verifyOtp(input);

      if (req.headers['hx-request']) {
        return res.render('partials/public/booking-success', { bookingId: input.bookingId });
      }
      return res.json({ success: true, message: 'Booking confirmed' });
    } catch (err) {
      next(err);
    }
  },
);

// Cancel confirmation page (GET) and actual cancel (POST)
viewingRouter.get(
  '/view/cancel/:viewingId/:cancelToken',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewing = await viewingService.getViewingByCancelToken(req.params.cancelToken);
      if (!viewing) return res.status(404).render('404');

      return res.render('public/cancel-confirmation', {
        viewing,
        viewingId: req.params.viewingId,
        cancelToken: req.params.cancelToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

viewingRouter.post(
  '/view/cancel/:viewingId/:cancelToken',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await viewingService.cancelViewing(req.params.viewingId, req.params.cancelToken);

      return res.render('public/cancel-success');
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 2: Register router in app.ts**

In `src/infra/http/app.ts`, add import:

```typescript
import { viewingRouter } from '../../domains/viewing/viewing.router';
```

Add after `app.use(financialRouter);`:

```typescript
  app.use(viewingRouter);
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/viewing/viewing.router.ts src/infra/http/app.ts
git commit -m "feat(viewing): add router and register in app"
```

---

### Task 7: Cron Job Registration

**Files:**
- Create: `src/domains/viewing/viewing.jobs.ts`
- Modify: `src/server.ts` (or wherever `startJobs()` is called)

- [ ] **Step 1: Create viewing jobs file**

Create `src/domains/viewing/viewing.jobs.ts`:

```typescript
import { registerJob } from '@/infra/jobs/runner';
import * as viewingService from './viewing.service';

export function registerViewingJobs() {
  registerJob(
    'viewing:morning-reminders',
    '0 9 * * *',
    () => viewingService.sendMorningReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'viewing:one-hour-reminders',
    '*/15 * * * *',
    () => viewingService.sendOneHourReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'viewing:feedback-prompts',
    '*/15 * * * *',
    () => viewingService.sendFeedbackPrompts(),
    'Asia/Singapore',
  );
}
```

- [ ] **Step 2: Register in server startup**

In `src/server.ts`, add import and call `registerViewingJobs()` before `startJobs()`:

```typescript
import { registerViewingJobs } from '@/domains/viewing/viewing.jobs';

// Before startJobs():
registerViewingJobs();
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/viewing/viewing.jobs.ts src/server.ts
git commit -m "feat(viewing): register cron jobs for reminders and feedback prompts"
```

---

## Chunk 5: Integration Tests

### Task 8: Router Integration Tests

**Files:**
- Create: `src/domains/viewing/__tests__/viewing.router.test.ts`

- [ ] **Step 1: Write integration tests**

Create `src/domains/viewing/__tests__/viewing.router.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '@/infra/http/app';
import * as viewingService from '../viewing.service';

jest.mock('../viewing.service');

const mockedService = jest.mocked(viewingService);

// Mock auth middleware
jest.mock('@/infra/http/middleware/require-auth', () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.user = { id: 'seller-1', role: 'seller', email: 'test@test.com', name: 'Test Seller' };
    req.isAuthenticated = () => true;
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireTwoFactor: () => (_req: any, _res: any, next: any) => next(),
  requireOwnership: () => (_req: any, _res: any, next: any) => next(),
}));

const app = createApp();

describe('viewing.router', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── Seller Routes ─────────────────────────────────────

  describe('POST /seller/viewings/slots', () => {
    it('creates a single slot', async () => {
      mockedService.createSlot.mockResolvedValue({
        id: 'slot-1',
        status: 'available',
      } as never);

      const res = await request(app)
        .post('/seller/viewings/slots')
        .send({
          propertyId: 'prop-1',
          date: '2026-04-15',
          startTime: '10:00',
          endTime: '10:15',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('creates bulk slots', async () => {
      mockedService.createBulkSlots.mockResolvedValue({
        count: 32,
        slots: [],
      } as never);

      const res = await request(app)
        .post('/seller/viewings/slots')
        .send({
          bulk: 'true',
          propertyId: 'prop-1',
          startDate: '2026-04-04',
          endDate: '2026-04-25',
          dayOfWeek: '6',
          startTime: '10:00',
          endTime: '12:00',
          slotDurationMinutes: '15',
        });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(32);
    });
  });

  describe('DELETE /seller/viewings/slots/:id', () => {
    it('cancels a slot', async () => {
      mockedService.cancelSlot.mockResolvedValue(undefined);

      const res = await request(app).delete('/seller/viewings/slots/slot-1');

      expect(res.status).toBe(200);
      expect(mockedService.cancelSlot).toHaveBeenCalledWith('slot-1', 'seller-1');
    });
  });

  describe('POST /seller/viewings/:id/feedback', () => {
    it('submits feedback with rating', async () => {
      mockedService.submitFeedback.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/seller/viewings/v-1/feedback')
        .send({ feedback: 'Good viewing', interestRating: '4' });

      expect(res.status).toBe(200);
      expect(mockedService.submitFeedback).toHaveBeenCalledWith(
        'v-1',
        'seller-1',
        { feedback: 'Good viewing', interestRating: 4 },
      );
    });
  });

  describe('POST /seller/viewings/:id/no-show', () => {
    it('marks viewing as no-show', async () => {
      mockedService.markNoShow.mockResolvedValue(undefined);

      const res = await request(app).post('/seller/viewings/v-1/no-show');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /seller/viewings/:id/complete', () => {
    it('marks viewing as completed', async () => {
      mockedService.markCompleted.mockResolvedValue(undefined);

      const res = await request(app).post('/seller/viewings/v-1/complete');

      expect(res.status).toBe(200);
    });
  });

  // ─── Public Routes ─────────────────────────────────────

  describe('GET /view/:propertySlug', () => {
    it('returns 404 for unknown slug', async () => {
      mockedService.getPublicBookingPage.mockResolvedValue(null);

      const res = await request(app).get('/view/nonexistent-slug');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /view/:propertySlug/book', () => {
    it('returns fake success for honeypot-filled form', async () => {
      mockedService.initiateBooking.mockResolvedValue({ spam: true });

      const res = await request(app)
        .post('/view/test-slug/book')
        .send({
          name: 'Bot',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: 'true',
          slotId: 'slot-1',
          website: 'spam.com',
          formLoadedAt: String(Date.now() - 10000),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns OTP form for new viewer', async () => {
      mockedService.initiateBooking.mockResolvedValue({
        viewingId: 'v-1',
        status: 'pending_otp',
        isReturningViewer: false,
      });

      const res = await request(app)
        .post('/view/test-slug/book')
        .send({
          name: 'John',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: 'true',
          slotId: 'slot-1',
          formLoadedAt: String(Date.now() - 10000),
        });

      expect(res.status).toBe(200);
      expect(res.body.requiresOtp).toBe(true);
    });
  });

  describe('POST /view/:propertySlug/verify-otp', () => {
    it('confirms booking after OTP', async () => {
      mockedService.verifyOtp.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/view/test-slug/verify-otp')
        .send({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /view/cancel/:viewingId/:cancelToken', () => {
    it('shows confirmation page', async () => {
      mockedService.getViewingByCancelToken.mockResolvedValue({
        id: 'v-1',
        status: 'scheduled',
      } as never);

      const res = await request(app).get('/view/cancel/v-1/token-123');

      expect(mockedService.getViewingByCancelToken).toHaveBeenCalledWith('token-123');
    });
  });

  describe('POST /view/cancel/:viewingId/:cancelToken', () => {
    it('cancels the viewing', async () => {
      mockedService.cancelViewing.mockResolvedValue(undefined);

      const res = await request(app).post('/view/cancel/v-1/token-123');

      expect(mockedService.cancelViewing).toHaveBeenCalledWith('v-1', 'token-123');
    });
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npm test -- --testPathPattern="viewing" --verbose
```

Expected: PASS (all viewing tests)

- [ ] **Step 3: Run full test suite**

```bash
npm test && npm run test:integration
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/domains/viewing/__tests__/viewing.router.test.ts
git commit -m "feat(viewing): add router integration tests"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Schema migration | `prisma/schema.prisma` |
| 2 | Type updates | `viewing.types.ts`, `notification.types.ts` |
| 3 | Repository + tests | `viewing.repository.ts`, test |
| 4 | Validator + tests | `viewing.validator.ts`, test |
| 5 | Service + tests | `viewing.service.ts`, test |
| 6 | Router + app registration | `viewing.router.ts`, `app.ts` |
| 7 | Cron jobs | `viewing.jobs.ts`, `server.ts` |
| 8 | Router integration tests | test |

**Run after each task:** `npm test && npm run test:integration`
