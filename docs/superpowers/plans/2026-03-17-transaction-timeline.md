# Transaction Timeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 6-step property-status timeline with an 11-step timeline (19 steps for admin) covering the full seller journey from compliance through completion, with timestamps on every milestone.

**Architecture:** A single `getTimelineMilestones(data: TimelineInput, role)` function in `seller.service.ts` builds the milestone list from a rich data object. Agent and admin routes each assemble a `TimelineInput` from their available services, then call this function. Templates render dates and a new N/A visual state for Counterparty CDD.

**Tech Stack:** TypeScript, Nunjucks, Prisma, Express, Jest

**Spec:** `docs/superpowers/specs/2026-03-17-transaction-timeline-design.md`

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/domains/seller/seller.types.ts` | Add `notApplicable` to TimelineMilestone; add TimelineInput interface |
| Modify | `src/domains/seller/seller.service.ts` | Refactor `getTimelineMilestones` with new signature and logic |
| Create | `src/domains/seller/seller.service.test.ts` | Unit tests for `getTimelineMilestones` |
| Modify | `src/domains/viewing/viewing.repository.ts` | Add `findFirstViewingDateForProperty` query |
| Modify | `src/domains/viewing/viewing.service.ts` | Add exported wrapper for first viewing date |
| Modify | `src/domains/agent/agent.service.ts` | Replace `getTimeline` with async `getTimelineInput` |
| Modify | `src/domains/agent/agent.router.ts` | Update seller detail route to call `getTimelineInput` |
| Modify | `src/domains/admin/admin.service.ts` | Assemble `TimelineInput` and pass `role: 'admin'` |
| Modify | `src/views/partials/agent/seller-timeline.njk` | Add date display and N/A visual state |
| Modify | `src/views/partials/seller/timeline.njk` | Add N/A visual state (date display already present) |

---

## Chunk 1: Types, Viewing Query, Core Logic

### Task 1: Update seller.types.ts

**Files:**
- Modify: `src/domains/seller/seller.types.ts`

Current `TimelineMilestone` (lines 90–95):
```typescript
export interface TimelineMilestone {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date: Date | null;
  description: string;
}
```

- [ ] **Step 1: Add `notApplicable` and `TimelineInput` to seller.types.ts**

Replace the `TimelineMilestone` interface and add `TimelineInput` after it:

```typescript
export interface TimelineMilestone {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date: Date | null;
  description: string;
  notApplicable: boolean;
}

export interface TimelineInput {
  sellerCddRecord:       { createdAt: Date } | null;
  eaa:                   { videoCallConfirmedAt: Date | null; signedCopyPath: string | null } | null;
  property:              { status: string; listedAt: Date | null } | null;
  firstViewingAt:        Date | null;
  acceptedOffer:         { createdAt: Date } | null;
  counterpartyCddRecord: { createdAt: Date } | null;
  isCoBroke:             boolean;
  otp: {
    status:          string;
    agentReviewedAt: Date | null;
    issuedAt:        Date | null;
    exercisedAt:     Date | null;
  } | null;
  transaction: {
    status:               string;
    hdbApplicationStatus: string;
    hdbAppSubmittedAt:    Date | null;
    hdbAppApprovedAt:     Date | null;
    hdbAppointmentDate:   Date | null;
    completionDate:       Date | null;
  } | null;
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only in seller.service.ts (because `getTimelineMilestones` signature hasn't changed yet) — that's fine.

- [ ] **Step 3: Commit**

```bash
git add src/domains/seller/seller.types.ts
git commit -m "feat(timeline): add TimelineInput interface and notApplicable to TimelineMilestone"
```

---

### Task 2: Add findFirstViewingDateForProperty to viewing domain

**Files:**
- Modify: `src/domains/viewing/viewing.repository.ts`
- Modify: `src/domains/viewing/viewing.service.ts`
- Modify: `src/domains/viewing/__tests__/viewing.service.test.ts` (or create if doesn't exist at that path — check with glob)

- [ ] **Step 1: Write the failing test**

Find the test file: check `src/domains/viewing/__tests__/` for existing test files. Add this test to the viewing service test file (or create a new describe block in the appropriate file):

> **ViewingStatus enum values** in this codebase: `pending_otp | scheduled | completed | cancelled | no_show`. The "confirmed" state is called `'scheduled'` — use `['scheduled', 'completed']`.

```typescript
describe('findFirstViewingDateForProperty', () => {
  it('returns the earliest scheduled date for scheduled/completed viewings', async () => {
    const mockDate = new Date('2026-01-15T10:00:00Z');
    jest.mocked(prisma.viewing.findFirst).mockResolvedValue({
      scheduledAt: mockDate,
    } as any);

    const result = await viewingService.findFirstViewingDateForProperty('prop-1');

    expect(prisma.viewing.findFirst).toHaveBeenCalledWith({
      where: {
        propertyId: 'prop-1',
        status: { in: ['scheduled', 'completed'] },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    });
    expect(result).toEqual(mockDate);
  });

  it('returns null when no viewings exist', async () => {
    jest.mocked(prisma.viewing.findFirst).mockResolvedValue(null);
    const result = await viewingService.findFirstViewingDateForProperty('prop-1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx jest --testPathPattern="viewing" --testNamePattern="findFirstViewingDateForProperty" 2>&1 | tail -20
```

Expected: FAIL — `findFirstViewingDateForProperty` is not defined.

- [ ] **Step 3: Add repository query to viewing.repository.ts**

At the end of the file, add:

```typescript
export async function findFirstViewingDateForProperty(propertyId: string): Promise<Date | null> {
  const viewing = await prisma.viewing.findFirst({
    where: {
      propertyId,
      status: { in: ['scheduled', 'completed'] },
    },
    orderBy: { scheduledAt: 'asc' },
    select: { scheduledAt: true },
  });
  return viewing?.scheduledAt ?? null;
}
```

- [ ] **Step 4: Add service wrapper to viewing.service.ts**

At the end of the exported functions, add:

```typescript
export async function findFirstViewingDateForProperty(propertyId: string): Promise<Date | null> {
  return viewingRepo.findFirstViewingDateForProperty(propertyId);
}
```

> Check what the repo import alias is at the top of viewing.service.ts (likely `import * as viewingRepo from './viewing.repository'`).

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx jest --testPathPattern="viewing" --testNamePattern="findFirstViewingDateForProperty" 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/viewing/viewing.repository.ts src/domains/viewing/viewing.service.ts src/domains/viewing/__tests__/
git commit -m "feat(timeline): add findFirstViewingDateForProperty to viewing service"
```

---

### Task 3: Refactor getTimelineMilestones in seller.service.ts

**Files:**
- Modify: `src/domains/seller/seller.service.ts` (lines 179–228 — the current function)
- Create: `src/domains/seller/seller.service.test.ts`

The current function signature is:
```typescript
export function getTimelineMilestones(
  propertyStatus: string | null,
  _transactionStatus: string | null,
): TimelineMilestone[]
```

**OTP status order** (from `transaction.types.ts` `OTP_TRANSITIONS`):
`prepared → sent_to_seller → signed_by_seller → returned → issued_to_buyer → exercised`

**HDB status order** (from `HdbApplicationStatus` enum):
`not_started → application_submitted → approval_in_principle → approval_granted → resale_checklist_submitted → hdb_appointment_booked → completed`

- [ ] **Step 1: Write failing tests**

Create `src/domains/seller/seller.service.test.ts`:

```typescript
import { getTimelineMilestones } from './seller.service';
import type { TimelineInput } from './seller.types';

const emptyInput: TimelineInput = {
  sellerCddRecord: null,
  eaa: null,
  property: null,
  firstViewingAt: null,
  acceptedOffer: null,
  counterpartyCddRecord: null,
  isCoBroke: false,
  otp: null,
  transaction: null,
};

describe('getTimelineMilestones', () => {
  describe('agent role — 11 milestones', () => {
    it('returns 11 milestones for agent role', () => {
      const milestones = getTimelineMilestones(emptyInput, 'agent');
      expect(milestones).toHaveLength(11);
    });

    it('all milestones are upcoming when no data', () => {
      const milestones = getTimelineMilestones(emptyInput, 'agent');
      expect(milestones[0].status).toBe('current'); // first non-completed is current
      expect(milestones.slice(1).every((m) => m.status === 'upcoming')).toBe(true);
    });

    it('marks seller CDD as completed with date when record exists', () => {
      const date = new Date('2026-01-10');
      const milestones = getTimelineMilestones(
        { ...emptyInput, sellerCddRecord: { createdAt: date } },
        'agent',
      );
      expect(milestones[0].label).toBe('Seller CDD Done');
      expect(milestones[0].status).toBe('completed');
      expect(milestones[0].date).toEqual(date);
    });

    it('marks EAA signed with videoCallConfirmedAt date', () => {
      const date = new Date('2026-01-12');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          sellerCddRecord: { createdAt: new Date() },
          eaa: { videoCallConfirmedAt: date, signedCopyPath: '/uploads/eaa.pdf' },
        },
        'agent',
      );
      expect(milestones[1].label).toBe('Estate Agency Agreement Signed');
      expect(milestones[1].status).toBe('completed');
      expect(milestones[1].date).toEqual(date);
    });

    it('marks Viewings current while listed, completed when property reaches offer_received', () => {
      const listedInput = {
        ...emptyInput,
        sellerCddRecord: { createdAt: new Date() },
        eaa: { videoCallConfirmedAt: new Date(), signedCopyPath: '/eaa.pdf' },
        property: { status: 'listed', listedAt: new Date() },
      };
      const milestonesListed = getTimelineMilestones(listedInput, 'agent');
      const viewings = milestonesListed.find((m) => m.label === 'Viewings')!;
      expect(viewings.status).toBe('current');

      const offerInput = {
        ...listedInput,
        property: { status: 'offer_received', listedAt: new Date() },
      };
      const milestonesOffer = getTimelineMilestones(offerInput, 'agent');
      const viewingsOffer = milestonesOffer.find((m) => m.label === 'Viewings')!;
      expect(viewingsOffer.status).toBe('completed');
    });

    it('marks counterparty CDD as not_applicable when isCoBroke', () => {
      const milestones = getTimelineMilestones(
        { ...emptyInput, isCoBroke: true },
        'agent',
      );
      const cdd = milestones.find((m) => m.label === 'Counterparty CDD')!;
      expect(cdd.notApplicable).toBe(true);
      expect(cdd.status).toBe('upcoming'); // N/A milestones are never 'current'
    });

    it('does not make counterparty CDD the current milestone when N/A', () => {
      // When isCoBroke, the milestone after counterparty CDD (OTP Review) should be current
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          sellerCddRecord: { createdAt: new Date() },
          eaa: { videoCallConfirmedAt: new Date(), signedCopyPath: '/eaa.pdf' },
          property: { status: 'listed', listedAt: new Date() },
          acceptedOffer: { createdAt: new Date() },
          isCoBroke: true,
        },
        'agent',
      );
      const cdd = milestones.find((m) => m.label === 'Counterparty CDD')!;
      const otpReview = milestones.find((m) => m.label === 'OTP Review')!;
      expect(cdd.notApplicable).toBe(true);
      expect(otpReview.status).toBe('current');
    });

    it('populates OTP milestones with correct dates', () => {
      const reviewed = new Date('2026-02-01');
      const issued = new Date('2026-02-02');
      const exercised = new Date('2026-02-10');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'exercised', agentReviewedAt: reviewed, issuedAt: issued, exercisedAt: exercised },
        },
        'agent',
      );
      const otpReview = milestones.find((m) => m.label === 'OTP Review')!;
      const otpIssued = milestones.find((m) => m.label === 'OTP Issued')!;
      const otpExercised = milestones.find((m) => m.label === 'OTP Exercised')!;
      expect(otpReview.status).toBe('completed');
      expect(otpReview.date).toEqual(reviewed);
      expect(otpIssued.status).toBe('completed');
      expect(otpIssued.date).toEqual(issued);
      expect(otpExercised.status).toBe('completed');
      expect(otpExercised.date).toEqual(exercised);
    });

    it('marks HDB Resale Submission completed when status is not not_started', () => {
      const submitted = new Date('2026-02-20');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          transaction: {
            status: 'option_exercised',
            hdbApplicationStatus: 'application_submitted',
            hdbAppSubmittedAt: submitted,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'agent',
      );
      const hdb = milestones.find((m) => m.label === 'HDB Resale Submission')!;
      expect(hdb.status).toBe('completed');
      expect(hdb.date).toEqual(submitted);
    });

    it('marks Completion completed with completionDate', () => {
      const completionDate = new Date('2026-03-15');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          transaction: {
            status: 'completed',
            hdbApplicationStatus: 'completed',
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate,
          },
        },
        'agent',
      );
      const completion = milestones.find((m) => m.label === 'Completion')!;
      expect(completion.status).toBe('completed');
      expect(completion.date).toEqual(completionDate);
    });
  });

  describe('admin role — 19 milestones', () => {
    it('returns 19 milestones for admin role when otp and transaction exist', () => {
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'prepared', agentReviewedAt: null, issuedAt: null, exercisedAt: null },
          transaction: {
            status: 'option_issued',
            hdbApplicationStatus: 'not_started',
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      expect(milestones).toHaveLength(19);
    });

    it('returns 11 milestones for admin when no otp and no transaction', () => {
      const milestones = getTimelineMilestones(emptyInput, 'admin');
      expect(milestones).toHaveLength(11);
    });

    it('OTP sub-steps are completed based on OTP status order', () => {
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'returned', agentReviewedAt: null, issuedAt: null, exercisedAt: null },
          transaction: {
            status: 'option_issued',
            hdbApplicationStatus: 'not_started',
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      const prepared = milestones.find((m) => m.label === 'OTP Prepared')!;
      const sentToSeller = milestones.find((m) => m.label === 'OTP Sent to Seller')!;
      const signedBySeller = milestones.find((m) => m.label === 'OTP Signed by Seller')!;
      const returnedToAgent = milestones.find((m) => m.label === 'OTP Returned to Agent')!;
      expect(prepared.status).toBe('completed');
      expect(sentToSeller.status).toBe('completed');
      expect(signedBySeller.status).toBe('completed');
      // 'OTP Returned to Agent' is completed when status ≥ 'issued_to_buyer'.
      // With status='returned', that condition is false → it becomes 'current' (first incomplete milestone).
      expect(returnedToAgent.status).toBe('current');
    });

    it('HDB sub-steps are completed based on HDB status order', () => {
      const approved = new Date('2026-03-01');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'exercised', agentReviewedAt: new Date(), issuedAt: new Date(), exercisedAt: new Date() },
          transaction: {
            status: 'completing',
            hdbApplicationStatus: 'approval_granted',
            hdbAppSubmittedAt: new Date(),
            hdbAppApprovedAt: approved,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      const aip = milestones.find((m) => m.label === 'HDB Approval in Principle')!;
      const ag = milestones.find((m) => m.label === 'HDB Approval Granted')!;
      const rc = milestones.find((m) => m.label === 'Resale Checklist Submitted')!;
      const appt = milestones.find((m) => m.label === 'HDB Appointment Booked')!;
      expect(aip.status).toBe('completed');
      expect(ag.status).toBe('completed');
      expect(ag.date).toEqual(approved);
      expect(rc.status).toBe('current');
      expect(appt.status).toBe('upcoming');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx jest --testPathPattern="seller.service.test" 2>&1 | tail -30
```

Expected: FAIL — old function signature doesn't match.

- [ ] **Step 3: Implement the new getTimelineMilestones in seller.service.ts**

Replace the existing `getTimelineMilestones` function (lines 179–228) with:

```typescript
const OTP_STATUS_ORDER = [
  'prepared',
  'sent_to_seller',
  'signed_by_seller',
  'returned',
  'issued_to_buyer',
  'exercised',
] as const;

const HDB_STATUS_ORDER = [
  'not_started',
  'application_submitted',
  'approval_in_principle',
  'approval_granted',
  'resale_checklist_submitted',
  'hdb_appointment_booked',
  'completed',
] as const;

function otpStatusGte(current: string, target: string): boolean {
  return OTP_STATUS_ORDER.indexOf(current as (typeof OTP_STATUS_ORDER)[number]) >=
    OTP_STATUS_ORDER.indexOf(target as (typeof OTP_STATUS_ORDER)[number]);
}

function hdbStatusGte(current: string, target: string): boolean {
  return HDB_STATUS_ORDER.indexOf(current as (typeof HDB_STATUS_ORDER)[number]) >=
    HDB_STATUS_ORDER.indexOf(target as (typeof HDB_STATUS_ORDER)[number]);
}

type RawMilestone = Omit<TimelineMilestone, 'status'> & { completed: boolean };

export function getTimelineMilestones(
  data: TimelineInput,
  role: 'agent' | 'admin',
): TimelineMilestone[] {
  const raw: RawMilestone[] = [];

  // 1. Seller CDD Done
  raw.push({
    label: 'Seller CDD Done',
    description: 'Customer due diligence completed for seller',
    completed: !!data.sellerCddRecord,
    date: data.sellerCddRecord?.createdAt ?? null,
    notApplicable: false,
  });

  // 2. Estate Agency Agreement Signed
  raw.push({
    label: 'Estate Agency Agreement Signed',
    description: 'Agency agreement executed with video call explanation',
    completed: !!data.eaa?.signedCopyPath,
    date: data.eaa?.videoCallConfirmedAt ?? null,
    notApplicable: false,
  });

  // 3. Property Listed
  raw.push({
    label: 'Property Listed',
    description: 'Property is live on the market',
    completed: !!data.property && data.property.status !== 'draft',
    date: data.property?.listedAt ?? null,
    notApplicable: false,
  });

  // 4. Viewings — current while listed, completed when property reaches offer_received or beyond
  const PROPERTY_STATUS_ORDER = [
    'draft', 'listed', 'offer_received', 'under_option', 'completing', 'completed', 'withdrawn',
  ];
  const propertyStatusIndex = data.property
    ? PROPERTY_STATUS_ORDER.indexOf(data.property.status)
    : -1;
  const offerReceivedIndex = PROPERTY_STATUS_ORDER.indexOf('offer_received');
  const viewingsCompleted = propertyStatusIndex >= offerReceivedIndex && propertyStatusIndex !== -1;

  raw.push({
    label: 'Viewings',
    description: 'Buyers view your home',
    completed: viewingsCompleted,
    date: data.firstViewingAt ?? null,
    notApplicable: false,
  });

  // 5. Offer Received
  const hasOffer = !!data.acceptedOffer || !!data.transaction;
  raw.push({
    label: 'Offer Received',
    description: 'A buyer has made an accepted offer',
    completed: hasOffer,
    date: data.acceptedOffer?.createdAt ?? null,
    notApplicable: false,
  });

  // Admin-only: OTP sub-steps (between Offer Received and Counterparty CDD)
  if (role === 'admin' && data.otp) {
    const otpStatus = data.otp.status;
    raw.push({
      label: 'OTP Prepared',
      description: 'Option to Purchase prepared by agent',
      completed: otpStatusGte(otpStatus, 'sent_to_seller'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Sent to Seller',
      description: 'OTP sent to seller for signing',
      completed: otpStatusGte(otpStatus, 'signed_by_seller'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Signed by Seller',
      description: 'OTP signed by seller and returned to agent',
      completed: otpStatusGte(otpStatus, 'returned'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Returned to Agent',
      description: 'OTP returned to agent for review before issuing',
      completed: otpStatusGte(otpStatus, 'issued_to_buyer'),
      date: null,
      notApplicable: false,
    });
  }

  // 6. Counterparty CDD
  raw.push({
    label: 'Counterparty CDD',
    description: data.isCoBroke
      ? 'Not required — co-broke transaction'
      : 'Due diligence completed on buyer',
    completed: !data.isCoBroke && !!data.counterpartyCddRecord,
    date: data.isCoBroke ? null : (data.counterpartyCddRecord?.createdAt ?? null),
    notApplicable: data.isCoBroke,
  });

  // 7. OTP Review
  raw.push({
    label: 'OTP Review',
    description: 'Agent reviews OTP terms before issuing to buyer',
    completed: !!data.otp?.agentReviewedAt,
    date: data.otp?.agentReviewedAt ?? null,
    notApplicable: false,
  });

  // 8. OTP Issued
  raw.push({
    label: 'OTP Issued',
    description: 'Option to Purchase issued to buyer',
    completed: !!data.otp?.issuedAt,
    date: data.otp?.issuedAt ?? null,
    notApplicable: false,
  });

  // 9. OTP Exercised
  raw.push({
    label: 'OTP Exercised',
    description: 'Buyer has exercised the Option to Purchase',
    completed: !!data.otp?.exercisedAt,
    date: data.otp?.exercisedAt ?? null,
    notApplicable: false,
  });

  // 10. HDB Resale Submission
  const hdbStatus = data.transaction?.hdbApplicationStatus ?? 'not_started';
  raw.push({
    label: 'HDB Resale Submission',
    description: 'Buyer and seller submit documents via HDB portal',
    completed: hdbStatus !== 'not_started',
    date: data.transaction?.hdbAppSubmittedAt ?? null,
    notApplicable: false,
  });

  // Admin-only: HDB sub-steps (between HDB Resale Submission and Completion)
  if (role === 'admin' && data.transaction) {
    const hdb = data.transaction.hdbApplicationStatus;
    raw.push({
      label: 'HDB Approval in Principle',
      description: 'HDB grants approval in principle',
      completed: hdbStatusGte(hdb, 'approval_in_principle'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'HDB Approval Granted',
      description: 'HDB grants full approval for resale',
      completed: hdbStatusGte(hdb, 'approval_granted'),
      date: data.transaction.hdbAppApprovedAt ?? null,
      notApplicable: false,
    });
    raw.push({
      label: 'Resale Checklist Submitted',
      description: 'Resale checklist submitted to HDB',
      completed: hdbStatusGte(hdb, 'resale_checklist_submitted'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'HDB Appointment Booked',
      description: 'Final HDB completion appointment scheduled',
      completed: hdbStatusGte(hdb, 'hdb_appointment_booked'),
      date: data.transaction.hdbAppointmentDate ?? null,
      notApplicable: false,
    });
  }

  // 11. Completion
  raw.push({
    label: 'Completion',
    description: 'Sale completed successfully',
    completed: data.transaction?.status === 'completed',
    date: data.transaction?.completionDate ?? null,
    notApplicable: false,
  });

  // Assign statuses: first non-completed non-N/A milestone = 'current'
  let currentSet = false;
  return raw.map((m): TimelineMilestone => {
    if (m.notApplicable) {
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'upcoming' };
    }
    if (m.completed) {
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'completed' };
    }
    if (!currentSet) {
      currentSet = true;
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'current' };
    }
    const { completed: _, ...rest } = m;
    return { ...rest, status: 'upcoming' };
  });
}
```

Also add `TimelineInput` to the imports from `./seller.types` at the top of seller.service.ts.

- [ ] **Step 4: Run the new tests**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx jest --testPathPattern="seller.service.test" 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass. If callers of the old signature break (agent.service.ts, admin.service.ts), that's expected — they'll be fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/seller.service.test.ts
git commit -m "feat(timeline): refactor getTimelineMilestones with 11-step timeline and admin sub-steps"
```

---

## Chunk 2: Callers and Templates

### Task 4: Update agent.service.ts

**Files:**
- Modify: `src/domains/agent/agent.service.ts`

Current `getTimeline` (lines 161–166) is a thin synchronous wrapper. Replace it with an async `getTimelineInput` that fetches all required data.

Imports needed at top of agent.service.ts (add if not present):
- `import * as complianceService from '../compliance/compliance.service';`
- `import * as transactionService from '../transaction/transaction.service';`
- `import * as viewingService from '../viewing/viewing.service';`
- `import type { TimelineInput } from '../seller/seller.types';`

- [ ] **Step 1: Replace `getTimeline` with `getTimelineInput`**

Replace the `getTimeline` function (lines 161–166) with:

```typescript
export async function getTimelineInput(
  sellerId: string,
  agentId?: string,
): Promise<TimelineInput> {
  const [seller, compliance, transaction, cddRecord, eaa] = await Promise.all([
    agentRepo.getSellerDetail(sellerId, agentId),
    agentRepo.getComplianceStatus(sellerId, agentId),
    transactionService.findTransactionBySellerId(sellerId),
    complianceService.findLatestSellerCddRecord(sellerId),
    complianceService.findEaaBySellerId(sellerId),
  ]);

  const property = seller?.properties[0] ?? null;

  const [firstViewingAt, otp] = await Promise.all([
    property ? viewingService.findFirstViewingDateForProperty(property.id) : Promise.resolve(null),
    transaction ? transactionService.findOtpByTransactionId(transaction.id) : Promise.resolve(null),
  ]);

  const counterpartyCddRecord =
    compliance.counterpartyCdd?.transactionId && !compliance.counterpartyCdd.isCoBroke
      ? await complianceService.findCddRecordByTransactionAndSubjectType(
          compliance.counterpartyCdd.transactionId,
          'counterparty',
        )
      : null;

  return {
    sellerCddRecord: cddRecord ? { createdAt: cddRecord.createdAt } : null,
    eaa: eaa
      ? { videoCallConfirmedAt: eaa.videoCallConfirmedAt ?? null, signedCopyPath: eaa.signedCopyPath ?? null }
      : null,
    property: property ? { status: property.status, listedAt: null } : null,
    firstViewingAt,
    acceptedOffer: transaction ? { createdAt: transaction.createdAt } : null,
    counterpartyCddRecord: counterpartyCddRecord
      ? { createdAt: counterpartyCddRecord.createdAt }
      : null,
    isCoBroke: compliance.counterpartyCdd?.isCoBroke ?? false,
    otp: otp
      ? {
          status: otp.status,
          agentReviewedAt: otp.agentReviewedAt ?? null,
          issuedAt: otp.issuedAt ?? null,
          exercisedAt: otp.exercisedAt ?? null,
        }
      : null,
    transaction: transaction
      ? {
          status: transaction.status,
          hdbApplicationStatus: transaction.hdbApplicationStatus,
          hdbAppSubmittedAt: transaction.hdbAppSubmittedAt ?? null,
          hdbAppApprovedAt: transaction.hdbAppApprovedAt ?? null,
          hdbAppointmentDate: transaction.hdbAppointmentDate ?? null,
          completionDate: transaction.completionDate ?? null,
        }
      : null,
  };
}
```

> **Note on `property.listedAt`:** Check if the Property Prisma model has a `listedAt` field. If yes, use `property.listedAt ?? null`. If not, use `null` — the milestone date for "Property Listed" will just be absent.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1 | grep "agent.service" | head -20
```

Fix any type errors. Common issues: `findEaaBySellerId` may return `null | Eaa` — check the actual return type and adjust field access accordingly.

- [ ] **Step 3: Run tests**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass. The agent.router.ts still calls `getTimeline` so it will have a TypeScript error but tests may still pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/agent/agent.service.ts
git commit -m "feat(timeline): replace getTimeline with async getTimelineInput in agent service"
```

---

### Task 5: Update agent.router.ts

**Files:**
- Modify: `src/domains/agent/agent.router.ts` (lines 124–154)

Current code around line 139:
```typescript
const milestones = agentService.getTimeline(seller.property?.status ?? null, null);
```

Imports needed at top of agent.router.ts (add if not present):
```typescript
import { getTimelineMilestones } from '../seller/seller.service';
```

- [ ] **Step 1: Update the seller detail route**

Replace the milestone computation (line ~139) with:

```typescript
const timelineInput = await agentService.getTimelineInput(sellerId, agentId);
const milestones = getTimelineMilestones(timelineInput, 'agent');
```

Remove the old `const milestones = agentService.getTimeline(...)` line.

Ensure the route handler is `async` (it should already be since it uses `await`).

- [ ] **Step 2: Update agent router test mocks**

The existing `src/domains/agent/__tests__/agent.router.test.ts` mocks `mockService.getTimeline`. After renaming the function, those mocks will fail. Find and update them:

```bash
grep -n "getTimeline" src/domains/agent/__tests__/agent.router.test.ts
```

For each occurrence of `mockService.getTimeline`, replace with `mockService.getTimelineInput`. The mock return value should be a `TimelineInput` object (all fields null/false), and the test should also mock `getTimelineMilestones` from `'../seller/seller.service'` to return `[]`. Example:

```typescript
// In the mock setup:
jest.mock('../seller/seller.service', () => ({
  getTimelineMilestones: jest.fn().mockReturnValue([]),
}));

// Replace getTimeline mock:
mockService.getTimelineInput = jest.fn().mockResolvedValue({
  sellerCddRecord: null, eaa: null, property: null,
  firstViewingAt: null, acceptedOffer: null, counterpartyCddRecord: null,
  isCoBroke: false, otp: null, transaction: null,
});
```

Adjust to match the exact mock style used in the existing test file.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1 | grep "agent.router" | head -20
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/agent/agent.router.ts src/domains/agent/__tests__/agent.router.test.ts
git commit -m "feat(timeline): update agent seller detail route to use getTimelineInput"
```

---

### Task 6: Update admin.service.ts

**Files:**
- Modify: `src/domains/admin/admin.service.ts` (lines 560–623)

The current `getAdminSellerDetail` calls `getTimelineMilestones(property?.status ?? null, transaction?.status ?? null)`.

Imports needed at top (add if not present):
```typescript
import * as viewingService from '../viewing/viewing.service';
import * as offerService from '../offer/offer.service';
import type { TimelineInput } from '../seller/seller.types';
```

- [ ] **Step 1: Update getAdminSellerDetail to assemble TimelineInput**

In the `getAdminSellerDetail` function, extend the `Promise.all` to fetch additional data:

Replace:
```typescript
const [cdd, auditLog, notificationsResult] = await Promise.all([
  complianceService.findLatestSellerCddRecord(id),
  auditRepo.findByEntity('seller', id),
  agentService.getNotificationHistory(id),
]);
```

With:
```typescript
const [cdd, auditLog, notificationsResult, eaa, transaction] = await Promise.all([
  complianceService.findLatestSellerCddRecord(id),
  auditRepo.findByEntity('seller', id),
  agentService.getNotificationHistory(id),
  complianceService.findEaaBySellerId(id),
  transactionService.findTransactionBySellerId(id),
]);
```

Then after resolving `property`:
```typescript
const property = raw.properties[0] ?? null;
// existing: const transaction = raw.transactions[0] ?? null;
// Remove the line above — use the transaction fetched in Promise.all

const [firstViewingAt, otp, counterpartyCddRecord] = await Promise.all([
  property ? viewingService.findFirstViewingDateForProperty(property.id) : Promise.resolve(null),
  transaction ? transactionService.findOtpByTransactionId(transaction.id) : Promise.resolve(null),
  transaction
    ? complianceService.findCddRecordByTransactionAndSubjectType(transaction.id, 'counterparty')
    : Promise.resolve(null),
]);

// isCoBroke: CddRecord does NOT have this field — fetch from the Offer model via transaction.offerId.
// Add import at top: `import * as offerService from '../offer/offer.service';`
// Then:
const acceptedOffer = transaction?.offerId
  ? await offerService.findOffer(transaction.offerId)
  : null;
const isCoBroke = acceptedOffer?.isCoBroke ?? false;

const timelineInput: TimelineInput = {
  sellerCddRecord: cdd ? { createdAt: cdd.createdAt } : null,
  eaa: eaa
    ? { videoCallConfirmedAt: eaa.videoCallConfirmedAt ?? null, signedCopyPath: eaa.signedCopyPath ?? null }
    : null,
  property: property ? { status: property.status, listedAt: null } : null,
  firstViewingAt,
  acceptedOffer: acceptedOffer ? { createdAt: acceptedOffer.createdAt } : (transaction ? { createdAt: transaction.createdAt } : null),
  counterpartyCddRecord: counterpartyCddRecord && !isCoBroke
    ? { createdAt: counterpartyCddRecord.createdAt }
    : null,
  isCoBroke,
  otp: otp
    ? {
        status: otp.status,
        agentReviewedAt: otp.agentReviewedAt ?? null,
        issuedAt: otp.issuedAt ?? null,
        exercisedAt: otp.exercisedAt ?? null,
      }
    : null,
  transaction: transaction
    ? {
        status: transaction.status,
        hdbApplicationStatus: transaction.hdbApplicationStatus,
        hdbAppSubmittedAt: transaction.hdbAppSubmittedAt ?? null,
        hdbAppApprovedAt: transaction.hdbAppApprovedAt ?? null,
        hdbAppointmentDate: transaction.hdbAppointmentDate ?? null,
        completionDate: transaction.completionDate ?? null,
      }
    : null,
};

const milestones = getTimelineMilestones(timelineInput, 'admin');
```

> **Note on `isCoBroke`:** Check what fields `findCddRecordByTransactionAndSubjectType` returns. If `isCoBroke` is on the CddRecord model, use it. Otherwise check `raw.transactions[0]` — if the Transaction model has `isCoBroke`, use that.

- [ ] **Step 2: Remove the old transaction local variable and fix the return shape**

The old `const transaction = raw.transactions[0] ?? null;` line should be removed since `transaction` now comes from `findTransactionBySellerId`.

**Important:** `findTransactionBySellerId` does not include the `otp` relation (no `include` in the query), so `transaction.otp` will be `undefined`. The `AdminSellerDetail` return object currently reads `otpStatus: transaction.otp?.status ?? null`. Replace this with the separately-fetched `otp` variable:

```typescript
transaction: transaction
  ? {
      id: transaction.id,
      status: transaction.status,
      offerId: transaction.offerId,
      agreedPrice: transaction.agreedPrice.toNumber(),
      hdbApplicationStatus: transaction.hdbApplicationStatus,
      otpStatus: otp?.status ?? null,   // use separately-fetched otp, not transaction.otp
      createdAt: transaction.createdAt,
    }
  : null,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1 | grep "admin.service" | head -20
```

Fix any type errors.

- [ ] **Step 4: Run tests**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.service.ts
git commit -m "feat(timeline): update admin service to assemble TimelineInput with full data"
```

---

### Task 7: Update templates

**Files:**
- Modify: `src/views/partials/agent/seller-timeline.njk`
- Modify: `src/views/partials/seller/timeline.njk`

**agent/seller-timeline.njk** — current content (18 lines):
```html
<div class="bg-white rounded-lg shadow p-6">
  <h3 class="text-lg font-semibold mb-4">{{ "Transaction Timeline" | t }}</h3>
  <div class="space-y-4">
    {% for milestone in milestones %}
    <div class="flex items-start gap-3">
      <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0
        {% if milestone.status == 'completed' %}bg-green-500
        {% elif milestone.status == 'current' %}bg-blue-500
        {% else %}bg-gray-300{% endif %}"></div>
      <div>
        <div class="text-sm font-medium {% if milestone.status == 'upcoming' %}text-gray-400{% endif %}">{{ milestone.label | t }}</div>
        <div class="text-xs text-gray-500">{{ milestone.description | t }}</div>
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

**seller/timeline.njk** — already renders `milestone.date` when present. Needs N/A state only.

- [ ] **Step 1: Update agent/seller-timeline.njk**

Replace the entire file with:

```html
<div class="bg-white rounded-lg shadow p-6">
  <h3 class="text-lg font-semibold mb-4">{{ "Transaction Timeline" | t }}</h3>
  <div class="space-y-4">
    {% for milestone in milestones %}
    <div class="flex items-start gap-3">
      {% if milestone.notApplicable %}
        <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0 bg-gray-200"></div>
      {% elif milestone.status == 'completed' %}
        <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0 bg-green-500"></div>
      {% elif milestone.status == 'current' %}
        <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0 bg-blue-500"></div>
      {% else %}
        <div class="mt-1 w-3 h-3 rounded-full flex-shrink-0 bg-gray-300"></div>
      {% endif %}
      <div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium
            {% if milestone.notApplicable or milestone.status == 'upcoming' %}text-gray-400{% endif %}">
            {{ milestone.label | t }}
          </span>
          {% if milestone.notApplicable %}
            <span class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">N/A</span>
          {% endif %}
        </div>
        <div class="text-xs text-gray-500">{{ milestone.description | t }}</div>
        {% if milestone.date %}
          <div class="text-xs text-gray-400 mt-0.5">{{ milestone.date | date('DD MMM YYYY') }}</div>
        {% endif %}
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

> **Note on date filter:** Check how dates are formatted in other Nunjucks templates in the project. The existing `seller/timeline.njk` uses `{{ milestone.date | date }}` — use the same filter syntax for consistency.

- [ ] **Step 2: Update seller/timeline.njk — add N/A state**

In the existing seller timeline template, the status dot section currently handles `completed`, `current`, and `upcoming`. Add the `notApplicable` case:

Replace the dot div block with:

```html
<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs
  {% if milestone.notApplicable %}bg-gray-100 text-gray-300
  {% elif milestone.status == 'completed' %}bg-green-100 text-green-700
  {% elif milestone.status == 'current' %}bg-blue-100 text-blue-700 ring-2 ring-blue-500
  {% else %}bg-gray-100 text-gray-400{% endif %}">
  {% if milestone.status == 'completed' %}&#10003;
  {% elif milestone.notApplicable %}&ndash;
  {% else %}&middot;{% endif %}
</div>
```

And add the N/A badge after the label:

```html
<p class="text-sm font-medium {% if milestone.notApplicable or milestone.status == 'upcoming' %}text-gray-400{% else %}text-gray-900{% endif %}">
  {{ milestone.label | t }}
  {% if milestone.notApplicable %}
    <span class="ml-1 text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">N/A</span>
  {% endif %}
</p>
```

- [ ] **Step 3: Check the date filter syntax**

Run a quick grep to confirm date filter format used elsewhere:

```bash
grep -r "| date" src/views/ | head -10
```

Adjust the date filter in both templates to match the project's convention.

- [ ] **Step 4: Run tests**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/agent/seller-timeline.njk src/views/partials/seller/timeline.njk
git commit -m "feat(timeline): add date display and N/A state to timeline templates"
```

---

### Task 8: Full TypeScript check and manual verification

- [ ] **Step 1: Full TypeScript compile check**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 3: Start dev server and manually verify**

```bash
cd /Users/david/Documents/AI/sellmyhouse-v2 && npm run dev
```

Navigate to:
- `/agent/sellers/:id` — verify 11-step timeline with dates renders correctly
- `/admin/sellers/:id` — verify 19-step timeline (with OTP and HDB sub-steps) renders correctly
- For a co-broke transaction: verify Counterparty CDD shows as N/A with grey styling

- [ ] **Step 4: Final commit (if any template tweaks were needed)**

```bash
git add -p
git commit -m "fix(timeline): template adjustments from manual verification"
```
