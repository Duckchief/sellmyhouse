# Hide Agent-Internal Timeline Stages from Seller — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide "Counterparty CDD" and "OTP Review" milestones from the seller dashboard timeline.

**Architecture:** Widen the `role` parameter on `getTimelineMilestones()` to include `'seller'`, skip the two agent-internal milestones when role is seller, and pass `'seller'` from the seller router.

**Tech Stack:** TypeScript, Jest

---

### Task 1: Write failing tests for seller role

**Files:**
- Modify: `src/domains/seller/seller.service.test.ts`

**Step 1: Write the failing tests**

Add a new `describe` block after the existing `admin role` block:

```typescript
describe('seller role', () => {
  it('returns 9 milestones (excludes Counterparty CDD and OTP Review)', () => {
    const milestones = getTimelineMilestones(emptyInput, 'seller');
    expect(milestones).toHaveLength(9);
  });

  it('does not include Counterparty CDD milestone', () => {
    const milestones = getTimelineMilestones(emptyInput, 'seller');
    const labels = milestones.map((m) => m.label);
    expect(labels).not.toContain('Counterparty CDD');
  });

  it('does not include OTP Review milestone', () => {
    const milestones = getTimelineMilestones(emptyInput, 'seller');
    const labels = milestones.map((m) => m.label);
    expect(labels).not.toContain('OTP Review');
  });

  it('still includes all other milestones in correct order', () => {
    const milestones = getTimelineMilestones(emptyInput, 'seller');
    const labels = milestones.map((m) => m.label);
    expect(labels).toEqual([
      'Seller CDD Done',
      'Estate Agency Agreement Signed',
      'Property Listed',
      'Viewings',
      'Offer Received',
      'OTP Issued',
      'OTP Exercised',
      'HDB Resale Submission',
      'Completion',
    ]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/seller/seller.service.test.ts --verbose`
Expected: FAIL — TypeScript error on `'seller'` not assignable to `'agent' | 'admin'`

---

### Task 2: Widen role type and filter milestones

**Files:**
- Modify: `src/domains/seller/seller.service.ts:241` — change role type
- Modify: `src/domains/seller/seller.service.ts:342-361` — wrap in role guard

**Step 1: Update the role parameter type**

In `seller.service.ts` line 241, change:
```typescript
role: 'agent' | 'admin',
```
to:
```typescript
role: 'agent' | 'admin' | 'seller',
```

**Step 2: Guard the Counterparty CDD milestone**

Wrap the Counterparty CDD block (lines 342-352) in a role check:

```typescript
// 6. Counterparty CDD (agent/admin only — not shown to sellers)
if (role !== 'seller') {
  raw.push({
    label: 'Counterparty CDD',
    description: data.isCoBroke
      ? 'Not required — co-broke transaction'
      : 'Due diligence completed on buyer',
    completed: !data.isCoBroke && !!data.counterpartyCddRecord,
    date: data.isCoBroke ? null : (data.counterpartyCddRecord?.createdAt ?? null),
    notApplicable: data.isCoBroke,
  });
}
```

**Step 3: Guard the OTP Review milestone**

Wrap the OTP Review block (lines 354-361) in a role check:

```typescript
// 7. OTP Review (agent/admin only — not shown to sellers)
if (role !== 'seller') {
  raw.push({
    label: 'OTP Review',
    description: 'Agent reviews OTP terms before issuing to buyer',
    completed: !!data.otp?.agentReviewedAt,
    date: data.otp?.agentReviewedAt ?? null,
    notApplicable: false,
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/domains/seller/seller.service.test.ts --verbose`
Expected: ALL PASS (including existing agent/admin tests unchanged)

**Step 5: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/seller.service.test.ts
git commit -m "feat(timeline): hide Counterparty CDD and OTP Review from seller role"
```

---

### Task 3: Update seller router to pass 'seller' role

**Files:**
- Modify: `src/domains/seller/seller.router.ts:78`

**Step 1: Change the role argument**

In `seller.router.ts` line 78, change:
```typescript
const milestones = sellerService.getTimelineMilestones(timelineInput, 'agent');
```
to:
```typescript
const milestones = sellerService.getTimelineMilestones(timelineInput, 'seller');
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/domains/seller/seller.router.ts
git commit -m "feat(timeline): seller dashboard uses seller role for timeline"
```
