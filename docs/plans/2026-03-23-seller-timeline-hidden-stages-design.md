# Hide Agent-Internal Timeline Stages from Seller

**Date:** 2026-03-23
**Status:** Approved

## Problem

The seller dashboard timeline ("Your Timeline") shows stages that are only relevant to agents: "Counterparty CDD" and "OTP Review". These are internal compliance/workflow steps that are meaningless to sellers and may cause confusion.

## Design

### Change 1: Widen the role parameter

`getTimelineMilestones()` in `seller.service.ts` currently accepts `role: 'agent' | 'admin'`. Widen to `'agent' | 'admin' | 'seller'`.

### Change 2: Skip agent-internal milestones for seller role

When `role === 'seller'`, do not push:
- "Counterparty CDD" (buyer due diligence — agent-only concern)
- "OTP Review" (agent reviews OTP terms — agent-only concern)

This follows the existing pattern where admin-only sub-steps are gated by `role === 'admin'`.

### Change 3: Seller router passes 'seller' role

`seller.router.ts` currently passes `'agent'` to `getTimelineMilestones()`. Change to `'seller'`.

### Change 4: Tests

- Add test cases for `role: 'seller'` confirming the two milestones are excluded
- Verify existing agent/admin tests still pass

## What doesn't change

- Agent and admin timelines unaffected
- Template (`timeline.njk`) unchanged — receives fewer milestones
- No database or migration changes
