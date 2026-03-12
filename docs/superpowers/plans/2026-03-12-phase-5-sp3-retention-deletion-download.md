# Phase 5 SP3: Retention Scanner + Hard Delete + Secure Download — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weekly retention scanner cron job that flags expired personal data, the admin deletion queue for reviewing and executing hard deletes, agent anonymisation on departure, and the secure download-and-delete workflow for completed transaction documents.

**Architecture:** Retention job registered in `server.ts` via `registerJob()`. Job calls `compliance.service.scanRetention()`. Admin deletion queue is a page in the admin domain. Hard deletes cascade through `compliance.service.executeHardDelete()` → `compliance.repository.hardDelete()` → Prisma `delete` + `fs.unlink()`. Secure download routes live in `compliance.router.ts`, gated behind agent auth and completed-transaction check. Depends on SP1 and SP2 being complete.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, Jest, Supertest, archiver (npm)

**Spec:** `docs/superpowers/specs/2026-03-12-phase-5-pdpa-compliance-design.md` — SP3 and SP6 sections

---

## File Map

**Create:**
- `src/infra/jobs/retention.job.ts` — weekly cron handler
- `src/views/pages/admin/compliance/deletion-queue.njk` — admin deletion review page
- `src/views/partials/admin/compliance/deletion-row.njk` — HTMX deletion row swap
- `src/views/partials/compliance/download-confirm-modal.njk` — confirmation modal for download-and-delete
- `tests/integration/compliance-sp3.test.ts` — integration tests

**Modify:**
- `src/domains/compliance/compliance.repository.ts` — add hardDelete, findRetentionCandidates
- `src/domains/compliance/compliance.service.ts` — add scanRetention, executeHardDelete, anonymiseAgent
- `src/domains/compliance/__tests__/compliance.service.test.ts` — add SP3 unit tests
- `src/domains/compliance/compliance.router.ts` — add download-and-delete routes
- `src/domains/admin/admin.router.ts` — add GET /admin/compliance/deletion-queue + approve action
- `src/domains/admin/admin.service.ts` — add getDeletionQueue, approveDeletion, anonymiseAgentOnDeparture
- `src/server.ts` — register retention job

---

## Chunk 1: Install archiver Dependency

### Task 1: Add archiver npm package

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install archiver and its types**

```bash
npm install archiver
npm install --save-dev @types/archiver
```

Expected: packages added to `node_modules/`.

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add archiver for zip-based bulk download"
```

---

## Chunk 2: Retention Repository + Service

### Task 2: Add retention scanning and hard delete to compliance.repository.ts

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

- [ ] **Step 1: Append retention scanning queries**

Open `src/domains/compliance/compliance.repository.ts` and append:

```typescript
// ─── Retention Scanning ───────────────────────────────────────────────────────

export async function findLeadsForRetention(cutoffDate: Date) {
  // Leads (no transaction) with no activity since cutoffDate
  return prisma.seller.findMany({
    where: {
      status: { in: ['lead', 'engaged'] },
      transactions: { none: {} },
      updatedAt: { lt: cutoffDate },
    },
    select: { id: true, name: true, updatedAt: true },
  });
}

export async function findServiceWithdrawnForDeletion(cutoffDate: Date) {
  // Sellers with service consent withdrawn > 30 days ago and no transactions
  return prisma.seller.findMany({
    where: {
      consentService: false,
      transactions: { none: {} },
      updatedAt: { lt: cutoffDate },
    },
    select: { id: true, name: true, updatedAt: true },
  });
}

export async function findTransactionsForRetention(cutoffDate: Date) {
  // Completed transactions with completion date > 5 years ago
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { lt: cutoffDate },
    },
    select: { id: true, sellerId: true, completionDate: true },
  });
}

export async function findCddRecordsForRetention(cutoffDate: Date) {
  // CDD records with verifiedAt > 5 years ago and documents still on disk
  return prisma.cddRecord.findMany({
    where: {
      verifiedAt: { lt: cutoffDate },
      documents: { not: '[]' },
    },
    select: { id: true, subjectId: true, documents: true, verifiedAt: true },
  });
}

export async function findConsentRecordsForDeletion(cutoffDate: Date) {
  // Withdrawn consent records older than 1 year post-withdrawal
  return prisma.consentRecord.findMany({
    where: {
      consentWithdrawnAt: { lt: cutoffDate, not: null },
    },
    select: { id: true, subjectId: true, consentWithdrawnAt: true },
  });
}

export async function findExistingDeletionRequest(
  targetType: string,
  targetId: string,
): Promise<{ id: string; status: string } | null> {
  return prisma.dataDeletionRequest.findFirst({
    where: { targetType: targetType as never, targetId },
    select: { id: true, status: true },
  });
}

export async function findPendingDeletionRequests() {
  // Returns all flagged and blocked requests for the admin deletion queue
  return prisma.dataDeletionRequest.findMany({
    where: { status: { in: ['flagged', 'blocked', 'pending_review'] as never[] } },
    orderBy: { flaggedAt: 'asc' },
  });
}

export async function findStaleCorrectionRequests(cutoffDate: Date) {
  return prisma.dataCorrectionRequest.findMany({
    where: {
      status: { in: ['pending', 'in_progress'] },
      createdAt: { lt: cutoffDate },
    },
    select: {
      id: true,
      sellerId: true,
      fieldName: true,
      createdAt: true,
      seller: { select: { agentId: true } },
    },
  });
}

// ─── Hard Delete ─────────────────────────────────────────────────────────────

export async function hardDeleteSeller(sellerId: string): Promise<void> {
  // Cascades to related personal data entities via Prisma cascades defined in schema
  await prisma.seller.delete({ where: { id: sellerId } });
}

export async function hardDeleteCddDocuments(
  cddRecordId: string,
  documentPaths: string[],
): Promise<void> {
  // Removes document file paths from the JSON array — marks them as deleted
  const deletedAt = new Date().toISOString();
  const updatedDocs = documentPaths.map((path) => ({
    deletedFromServer: true,
    deletedAt,
    originalPath: path,
  }));
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: updatedDocs },
  });
}

export async function hardDeleteConsentRecord(consentRecordId: string): Promise<void> {
  await prisma.consentRecord.delete({ where: { id: consentRecordId } });
}

export async function hardDeleteTransaction(transactionId: string): Promise<void> {
  // Cascades to OTP, CommissionInvoice, EstateAgencyAgreement via Prisma schema cascades
  await prisma.transaction.delete({ where: { id: transactionId } });
}

// ─── Agent Anonymisation ──────────────────────────────────────────────────────

export async function anonymiseAgent(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      name: `Former Agent ${agentId}`,
      email: `anonymised-${agentId}@deleted.local`,
      phone: null,
    },
  });
}

export async function findAgentById(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts
git commit -m "feat(compliance): add retention scanning and hard delete repository methods"
```

---

### Task 3: Add scanRetention, executeHardDelete, anonymiseAgent to compliance.service.ts

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Open `src/domains/compliance/__tests__/compliance.service.test.ts` and add:

```typescript
describe('scanRetention', () => {
  beforeEach(() => {
    mockRepo.findLeadsForRetention.mockResolvedValue([]);
    mockRepo.findServiceWithdrawnForDeletion.mockResolvedValue([]);
    mockRepo.findTransactionsForRetention.mockResolvedValue([]);
    mockRepo.findCddRecordsForRetention.mockResolvedValue([]);
    mockRepo.findConsentRecordsForDeletion.mockResolvedValue([]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue(null);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);
  });

  it('flags leads inactive for 12+ months', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    mockRepo.findLeadsForRetention.mockResolvedValue([
      { id: 'seller1', name: 'Old Lead', updatedAt: oldDate },
    ]);

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'lead',
        targetId: 'seller1',
        retentionRule: 'lead_12_month',
        status: 'flagged',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('does NOT flag leads that already have a deletion request', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    mockRepo.findLeadsForRetention.mockResolvedValue([
      { id: 'seller1', name: 'Old Lead', updatedAt: oldDate },
    ]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue({ id: 'existing', status: 'flagged' });

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).not.toHaveBeenCalled();
    expect(result.flaggedCount).toBe(0);
  });

  it('flags transaction records older than 5 years', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 6);
    mockRepo.findTransactionsForRetention.mockResolvedValue([
      { id: 'tx1', sellerId: 'seller1', completionDate: oldDate },
    ]);

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'transaction',
        targetId: 'tx1',
        retentionRule: 'transaction_5_year',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });
});

describe('executeHardDelete', () => {
  it('throws if deletion request is not found', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue(null);
    await expect(
      complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' }),
    ).rejects.toThrow('not found');
  });

  it('throws ComplianceError if deletion request is blocked', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'blocked',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: 'aml_cft_5_year',
      details: {},
    } as never);

    await expect(
      complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' }),
    ).rejects.toThrow('ComplianceError');
  });
});

describe('anonymiseAgent', () => {
  it('calls repository anonymiseAgent and logs audit event', async () => {
    mockRepo.findAgentById.mockResolvedValue({
      id: 'agent1',
      name: 'John Tan',
      email: 'john@test.com',
      phone: '+65912345678',
      isActive: false,
    });
    mockRepo.anonymiseAgent.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.anonymiseAgent({ agentId: 'agent1', requestedByAgentId: 'admin1' });

    expect(mockRepo.anonymiseAgent).toHaveBeenCalledWith('agent1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.anonymised', entityId: 'agent1' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -15
```

Expected: FAIL — functions not found.

- [ ] **Step 3: Add SP3 functions to compliance.service.ts**

Open `src/domains/compliance/compliance.service.ts` and add this import at the top:

```typescript
import fs from 'fs/promises';
import { ComplianceError, NotFoundError } from '../shared/errors';
```

Then append these functions at the end of the file:

```typescript
// ─── Retention Scanning ───────────────────────────────────────────────────────

export interface ScanRetentionResult {
  flaggedCount: number;
  skippedCount: number; // Already has a deletion request
}

export async function scanRetention(): Promise<ScanRetentionResult> {
  const now = new Date();
  let flaggedCount = 0;
  let skippedCount = 0;

  async function flagIfNew(
    targetType: string,
    targetId: string,
    reason: string,
    retentionRule: string,
    status: 'flagged' | 'blocked',
    details: Record<string, unknown>,
  ) {
    const existing = await complianceRepo.findExistingDeletionRequest(targetType, targetId);
    if (existing) {
      skippedCount++;
      return;
    }
    await complianceRepo.createDeletionRequest({
      targetType,
      targetId,
      reason,
      retentionRule,
      status,
      details,
    });
    flaggedCount++;
  }

  // 1. Leads inactive for 12+ months
  const leadCutoff = new Date(now);
  leadCutoff.setMonth(leadCutoff.getMonth() - 12);
  const staleLeads = await complianceRepo.findLeadsForRetention(leadCutoff);
  for (const lead of staleLeads) {
    await flagIfNew(
      'lead',
      lead.id,
      'Lead inactive for 12+ months',
      'lead_12_month',
      'flagged',
      { sellerName: lead.name, lastActivity: lead.updatedAt },
    );
  }

  // 2. Service consent withdrawn 30+ days ago, no transactions
  const withdrawalCutoff = new Date(now);
  withdrawalCutoff.setDate(withdrawalCutoff.getDate() - 30);
  const withdrawnSellers = await complianceRepo.findServiceWithdrawnForDeletion(withdrawalCutoff);
  for (const seller of withdrawnSellers) {
    await flagIfNew(
      'lead',
      seller.id,
      'Service consent withdrawn > 30 days ago',
      '30_day_grace_expired',
      'flagged',
      { sellerName: seller.name },
    );
  }

  // 3. Transaction records 5+ years post-completion
  const txCutoff = new Date(now);
  txCutoff.setFullYear(txCutoff.getFullYear() - 5);
  const oldTransactions = await complianceRepo.findTransactionsForRetention(txCutoff);
  for (const tx of oldTransactions) {
    await flagIfNew(
      'transaction',
      tx.id,
      'Transaction record > 5 years post-completion',
      'transaction_5_year',
      'flagged',
      { sellerId: tx.sellerId, completionDate: tx.completionDate },
    );
  }

  // 4. CDD documents 5+ years since verification
  const cddCutoff = new Date(now);
  cddCutoff.setFullYear(cddCutoff.getFullYear() - 5);
  const oldCddRecords = await complianceRepo.findCddRecordsForRetention(cddCutoff);
  for (const cdd of oldCddRecords) {
    await flagIfNew(
      'cdd_documents',
      cdd.id,
      'CDD documents > 5 years old',
      'cdd_5_year',
      'flagged',
      { subjectId: cdd.subjectId, verifiedAt: cdd.verifiedAt },
    );
  }

  // 5. Withdrawn consent records 1+ year post-withdrawal
  const consentCutoff = new Date(now);
  consentCutoff.setFullYear(consentCutoff.getFullYear() - 1);
  const oldConsentRecords = await complianceRepo.findConsentRecordsForDeletion(consentCutoff);
  for (const record of oldConsentRecords) {
    await flagIfNew(
      'consent_record',
      record.id,
      'Consent record withdrawn > 1 year ago',
      'consent_1_year_post_withdrawal',
      'flagged',
      { subjectId: record.subjectId, withdrawnAt: record.consentWithdrawnAt },
    );
  }

  // 6. DataCorrectionRequests unprocessed for 30+ days — alert agent (not deletion)
  const correctionCutoff = new Date(now);
  correctionCutoff.setDate(correctionCutoff.getDate() - 30);
  const staleCorrections = await complianceRepo.findStaleCorrectionRequests(correctionCutoff);
  for (const req of staleCorrections) {
    // Create an in-app notification to the assigned agent (not a DataDeletionRequest)
    // Agents are notified via audit log as a lightweight alert mechanism for now
    await auditService.log({
      action: 'compliance.correction_request_overdue',
      entityType: 'data_correction_request',
      entityId: req.id,
      details: {
        sellerId: req.sellerId,
        fieldName: req.fieldName,
        daysOverdue: Math.floor((now.getTime() - req.createdAt.getTime()) / 86400000),
        assignedAgentId: req.seller?.agentId,
      },
    });
  }

  return { flaggedCount, skippedCount };
}

// ─── Hard Delete ─────────────────────────────────────────────────────────────

export async function executeHardDelete(input: {
  requestId: string;
  agentId: string;
  reviewNotes?: string;
}): Promise<void> {
  const request = await complianceRepo.findDeletionRequest(input.requestId);
  if (!request) throw new NotFoundError('DataDeletionRequest', input.requestId);

  if (request.status === 'blocked') {
    const details = request.details as Record<string, unknown> | null;
    const retentionEnd = details?.retentionEndDate
      ? ` Retention ends: ${details.retentionEndDate}`
      : '';
    throw new ComplianceError(
      `Cannot delete: AML/CFT retention requirement applies.${retentionEnd}`,
    );
  }

  if (request.status !== 'flagged' && request.status !== 'pending_review') {
    throw new ComplianceError(`Deletion request is not in a reviewable state: ${request.status}`);
  }

  const details = request.details as Record<string, unknown> | null;

  // Capture entity snapshot for audit log BEFORE deletion
  const auditSnapshot = {
    targetType: request.targetType,
    targetId: request.targetId,
    retentionRule: request.retentionRule,
    approvedByAgentId: input.agentId,
    details,
  };

  // Execute the deletion based on target type
  switch (request.targetType) {
    case 'lead':
    case 'seller':
      await complianceRepo.hardDeleteSeller(request.targetId);
      break;

    case 'cdd_documents': {
      // Get document paths before deleting
      const cddDetails = details as { documents?: string[] } | null;
      const paths = cddDetails?.documents ?? [];
      for (const filePath of paths) {
        try {
          await fs.unlink(filePath);
        } catch {
          // File may already be gone — log and continue
        }
      }
      await complianceRepo.hardDeleteCddDocuments(request.targetId, paths);
      break;
    }

    case 'consent_record':
      await complianceRepo.hardDeleteConsentRecord(request.targetId);
      break;

    case 'transaction':
      // 5-year retention has expired. Hard-delete cascades via Prisma schema (OTP, CommissionInvoice, etc.)
      // Audit logs referencing this transaction ID remain intact (audit logs are never deleted).
      await complianceRepo.hardDeleteTransaction(request.targetId);
      break;

    default:
      throw new ComplianceError(`Unknown target type for deletion: ${request.targetType}`);
  }

  // Mark the deletion request as executed
  await complianceRepo.updateDeletionRequest(input.requestId, {
    status: 'executed',
    reviewedByAgentId: input.agentId,
    reviewedAt: new Date(),
    reviewNotes: input.reviewNotes,
    executedAt: new Date(),
  });

  // Self-contained audit log — does not rely on deleted entity being queryable
  await auditService.log({
    action: 'data.hard_deleted',
    entityType: request.targetType,
    entityId: request.targetId,
    details: auditSnapshot,
    agentId: input.agentId,
  });
}

// ─── Agent Anonymisation ──────────────────────────────────────────────────────

export async function anonymiseAgent(input: {
  agentId: string;
  requestedByAgentId: string;
}): Promise<void> {
  const agent = await complianceRepo.findAgentById(input.agentId);
  if (!agent) throw new NotFoundError('Agent', input.agentId);

  // Capture pre-anonymisation snapshot for audit
  const snapshot = {
    originalName: agent.name,
    originalEmail: agent.email,
    originalPhone: agent.phone,
    anonymisedBy: input.requestedByAgentId,
  };

  await complianceRepo.anonymiseAgent(input.agentId);

  await auditService.log({
    action: 'agent.anonymised',
    entityType: 'agent',
    entityId: input.agentId,
    details: snapshot,
    agentId: input.requestedByAgentId,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="compliance.service" 2>&1 | tail -20
```

Expected: all tests PASS. If `ComplianceError` is thrown but caught as generic Error, check that the test uses `rejects.toThrow` with the class name string rather than the class itself (Jest string matching works for class name).

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts \
        src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat(compliance): add retention scanner, hard delete, and agent anonymisation"
```

---

### Task 4: Create retention.job.ts and register in server.ts

**Files:**
- Create: `src/infra/jobs/retention.job.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the retention job**

```typescript
// src/infra/jobs/retention.job.ts
import { logger } from '../logger';
import { scanRetention } from '../../domains/compliance/compliance.service';

export async function runRetentionScan(): Promise<void> {
  logger.info('Retention scan starting');
  const result = await scanRetention();
  logger.info(
    { flaggedCount: result.flaggedCount, skippedCount: result.skippedCount },
    'Retention scan complete',
  );
}
```

- [ ] **Step 2: Register the job in server.ts**

Open `src/server.ts`. Add the import at the **top** of the file alongside the other imports (not inside a function):

```typescript
import { runRetentionScan } from './infra/jobs/retention.job';
```

Then, after the existing `registerJob` calls, add:

```typescript
// Register retention job (Saturday midnight SGT, configurable via SystemSetting 'retention_schedule')
registerJob(
  'retention-scan',
  '0 0 * * 6', // Saturday midnight
  runRetentionScan,
  'Asia/Singapore',
);
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infra/jobs/retention.job.ts src/server.ts
git commit -m "feat(jobs): register weekly retention scan cron job"
```

---

## Chunk 3: Admin Deletion Queue

### Task 5: Add deletion queue to admin domain

**Files:**
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/domains/admin/admin.router.ts`
- Create: `src/views/pages/admin/compliance/deletion-queue.njk`
- Create: `src/views/partials/admin/compliance/deletion-row.njk`

- [ ] **Step 1: Add getDeletionQueue and approveDeletion to admin.service.ts**

Open `src/domains/admin/admin.service.ts`. Add the import (services only — no direct repo imports per CLAUDE.md cross-domain rule):

```typescript
import * as complianceService from '../compliance/compliance.service';
```

Add a `getDeletionQueue` function to `compliance.service.ts` first (append at end of that file):

```typescript
// In compliance.service.ts
export async function getDeletionQueue() {
  return complianceRepo.findPendingDeletionRequests();
}
```

Then in `admin.service.ts` append these functions:

```typescript
export async function getDeletionQueue() {
  return complianceService.getDeletionQueue();
}

export async function approveDeletion(
  requestId: string,
  adminId: string,
  reviewNotes?: string,
): Promise<void> {
  await complianceService.executeHardDelete({ requestId, agentId: adminId, reviewNotes });
}

export async function anonymiseAgentOnDeparture(
  agentId: string,
  adminId: string,
): Promise<void> {
  await complianceService.anonymiseAgent({ agentId, requestedByAgentId: adminId });
}
```

- [ ] **Step 2: Add deletion queue routes to admin.router.ts**

Open `src/domains/admin/admin.router.ts`. Add after the existing admin routes:

```typescript
// GET /admin/compliance/deletion-queue — Review retention-flagged records
adminRouter.get(
  '/admin/compliance/deletion-queue',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requests = await adminService.getDeletionQueue();

      if (req.headers['hx-request']) {
        // For HTMX refresh of just the queue list
        return res.render('partials/admin/compliance/deletion-queue-list', { requests });
      }

      return res.render('pages/admin/compliance/deletion-queue', {
        requests,
        title: 'Data Deletion Queue',
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /admin/compliance/deletion-queue/:requestId/approve — Execute hard delete
adminRouter.post(
  '/admin/compliance/deletion-queue/:requestId/approve',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = (req.user as { id: string }).id;
      const { requestId } = req.params;
      const { reviewNotes } = req.body as { reviewNotes?: string };

      await adminService.approveDeletion(requestId, adminId, reviewNotes);

      if (req.headers['hx-request']) {
        return res.render('partials/admin/compliance/deletion-row', {
          executed: true,
          requestId,
        });
      }

      return res.redirect('/admin/compliance/deletion-queue');
    } catch (err) {
      return next(err);
    }
  },
);

// POST /admin/agents/:agentId/anonymise — Anonymise departing agent
adminRouter.post(
  '/admin/agents/:agentId/anonymise',
  ...adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = (req.user as { id: string }).id;
      const { agentId } = req.params;

      await adminService.anonymiseAgentOnDeparture(agentId, adminId);

      if (req.headers['hx-request']) {
        return res.json({ success: true });
      }

      return res.redirect('/admin/team');
    } catch (err) {
      return next(err);
    }
  },
);
```

Note: `adminAuth` is already defined in `admin.router.ts` as `const adminAuth = [requireAuth(), requireRole('admin'), requireTwoFactor()]` — use `...adminAuth`.

- [ ] **Step 3: Create the deletion queue views**

```html
{# src/views/pages/admin/compliance/deletion-queue.njk #}
{% extends "layouts/admin.njk" %}

{% block content %}
<div class="max-w-5xl mx-auto px-4 py-8">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">{{ "Data Deletion Queue" | t }}</h1>
    <span class="px-3 py-1 bg-amber-100 text-amber-800 text-sm font-medium rounded-full">
      {{ requests | length }} {{ "pending" | t }}
    </span>
  </div>

  <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
    <p class="text-sm text-amber-800">
      <strong>{{ "Review required." | t }}</strong>
      {{ "These records have been flagged by the automated retention scanner. Verify there is no legal exception before approving deletion. Blocked records cannot be deleted until the retention period ends." | t }}
    </p>
  </div>

  {% if requests | length == 0 %}
    <div class="text-center py-12 text-gray-500">
      <p>{{ "No records pending review." | t }}</p>
    </div>
  {% else %}
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Type" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Retention Rule" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Flagged" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Status" | t }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Action" | t }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200" id="deletion-queue-rows">
          {% for req in requests %}
          <tr id="deletion-row-{{ req.id }}">
            <td class="px-6 py-4 text-sm font-mono text-gray-700">{{ req.targetType }}</td>
            <td class="px-6 py-4 text-sm text-gray-700">{{ req.retentionRule }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ req.flaggedAt | date("DD MMM YYYY") }}</td>
            <td class="px-6 py-4">
              <span class="px-2 py-1 text-xs rounded-full
                {% if req.status == 'blocked' %}bg-red-100 text-red-700
                {% else %}bg-amber-100 text-amber-700{% endif %}">
                {{ req.status }}
              </span>
            </td>
            <td class="px-6 py-4">
              {% if req.status == 'blocked' %}
                <span class="text-xs text-gray-400">{{ "Retention active" | t }}</span>
              {% else %}
                <button
                  hx-post="/admin/compliance/deletion-queue/{{ req.id }}/approve"
                  hx-confirm="{{ 'This will permanently delete personal data. This cannot be undone. Confirm?' | t }}"
                  hx-target="#deletion-row-{{ req.id }}"
                  hx-swap="outerHTML"
                  class="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                  {{ "Approve Deletion" | t }}
                </button>
              {% endif %}
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  {% endif %}
</div>
{% endblock %}
```

```html
{# src/views/partials/admin/compliance/deletion-row.njk #}
<tr id="deletion-row-{{ requestId }}"
    class="{% if executed %}bg-green-50{% else %}bg-red-50{% endif %}">
  <td colspan="5" class="px-6 py-4 text-sm text-center
    {% if executed %}text-green-700{% else %}text-red-700{% endif %}">
  {% if executed %}
    {{ "Deletion executed. Data has been permanently removed." | t }}
  {% else %}
    {{ "Failed to execute deletion." | t }}
  {% endif %}
  </td>
</tr>
```

- [ ] **Step 4: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domains/admin/admin.service.ts \
        src/domains/admin/admin.router.ts \
        src/views/pages/admin/compliance/ \
        src/views/partials/admin/compliance/
git commit -m "feat(admin): add data deletion queue and agent anonymisation routes"
```

---

## Chunk 4: Secure Download & Delete

### Task 6: Add secure download-and-delete routes to compliance.router.ts

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`
- Modify: `src/domains/compliance/compliance.repository.ts`
- Create: `src/views/partials/compliance/download-confirm-modal.njk`

- [ ] **Step 1: Add document resolution queries to compliance.repository.ts**

Open `src/domains/compliance/compliance.repository.ts` and append:

```typescript
// ─── Secure Document Access ───────────────────────────────────────────────────

export async function findTransactionDocuments(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      status: true,
      sellerId: true,
      seller: { select: { agentId: true } },
      otps: {
        select: {
          id: true,
          scannedCopyPath: true,
          scannedCopyDeletedAt: true,
        },
      },
      commissionInvoice: {
        select: {
          id: true,
          invoiceFilePath: true,
          invoiceDeletedAt: true,
        },
      },
    },
  });
  return tx;
}

export async function findCddRecordsByTransaction(transactionId: string) {
  // CDD records are linked to seller, not directly to transaction
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { sellerId: true },
  });
  if (!tx) return [];
  return prisma.cddRecord.findMany({
    where: { subjectId: tx.sellerId, subjectType: 'seller' },
    select: { id: true, documents: true },
  });
}

export async function markOtpScannedCopyDeleted(otpId: string): Promise<void> {
  await prisma.otp.update({
    where: { id: otpId },
    data: { scannedCopyPath: null, scannedCopyDeletedAt: new Date() },
  });
}

export async function markInvoiceDeleted(invoiceId: string): Promise<void> {
  await prisma.commissionInvoice.update({
    where: { id: invoiceId },
    data: { invoiceFilePath: null, invoiceDeletedAt: new Date() },
  });
}
```

- [ ] **Step 2: Add download-and-delete routes to compliance.router.ts**

Open `src/domains/compliance/compliance.router.ts`. Add these imports at the top:

Add these imports at the **top** of `compliance.router.ts` alongside the existing imports (never inside a function):

```typescript
import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { logger } from '@/infra/logger';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
```

Then append these routes:

```typescript
// ─── Secure Download & Delete ─────────────────────────────────────────────────

// 2FA required — these routes permanently delete files from the server
const AGENT_TRANS_AUTH = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];

// POST /agent/transactions/:transactionId/documents/:docId/download-and-delete
// Downloads a single sensitive document then hard-deletes it from server
complianceRouter.post(
  '/agent/transactions/:transactionId/documents/:docId/download-and-delete',
  ...AGENT_TRANS_AUTH,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId, docId } = req.params;
      const { offlineRetentionConfirmed, canProduceConfirmed, docType } = req.body as {
        offlineRetentionConfirmed?: boolean;
        canProduceConfirmed?: boolean;
        docType: string;
      };

      if (!offlineRetentionConfirmed || !canProduceConfirmed) {
        return next(new ValidationError('Both confirmation checkboxes must be ticked'));
      }

      const txDocs = await complianceRepo.findTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(
          new ForbiddenError('Documents can only be downloaded from completed transactions'),
        );
      }

      // Ownership check: agent must own the seller, or requester must be admin
      const userRole = (req.user as { id: string; role: string }).role;
      if (userRole !== 'admin' && txDocs.seller.agentId !== agentId) {
        return next(new ForbiddenError('You do not own this transaction'));
      }

      // Resolve file path based on docType
      let filePath: string | null = null;
      let docRecordId: string | null = null;

      if (docType === 'otp' && txDocs.otps[0]?.scannedCopyPath) {
        filePath = txDocs.otps[0].scannedCopyPath;
        docRecordId = txDocs.otps[0].id;
      } else if (docType === 'invoice' && txDocs.commissionInvoice?.invoiceFilePath) {
        filePath = txDocs.commissionInvoice.invoiceFilePath;
        docRecordId = txDocs.commissionInvoice.id;
      }

      if (!filePath) {
        return next(new NotFoundError('Document', docId));
      }

      // Validate file exists before starting download
      try {
        await fs.access(filePath);
      } catch {
        return next(new NotFoundError('File on server', docId));
      }

      const fileName = path.basename(filePath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');

      const agentId = (req.user as { id: string }).id;

      // Stream file — delete only on successful finish
      res.sendFile(path.resolve(filePath), async (err) => {
        if (err) {
          // Stream failed — do NOT delete the file
          return;
        }

        // Stream complete — delete file and update DB record
        try {
          await fs.unlink(filePath as string);

          if (docType === 'otp' && docRecordId) {
            await complianceRepo.markOtpScannedCopyDeleted(docRecordId);
          } else if (docType === 'invoice' && docRecordId) {
            await complianceRepo.markInvoiceDeleted(docRecordId);
          }

          await auditService.log({
            action: 'documents.downloaded_and_deleted',
            entityType: 'transaction',
            entityId: transactionId,
            details: {
              files: [fileName],
              downloadedBy: agentId,
              offlineRetentionConfirmed: true,
              reason: 'server data minimisation',
              docType,
            },
            agentId,
          });
        } catch (deleteErr) {
          // Log deletion failure — file may need manual cleanup
          // logger is imported statically at the top of the router file (see imports block below)
          logger.error({ deleteErr, filePath, transactionId }, 'Failed to delete file post-download');
        }
      });
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/transactions/:transactionId/documents/download-all-and-delete
// Downloads all sensitive documents as a zip then hard-deletes them
complianceRouter.post(
  '/agent/transactions/:transactionId/documents/download-all-and-delete',
  ...AGENT_TRANS_AUTH,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = req.params;
      const { offlineRetentionConfirmed, canProduceConfirmed } = req.body as {
        offlineRetentionConfirmed?: boolean;
        canProduceConfirmed?: boolean;
      };

      if (!offlineRetentionConfirmed || !canProduceConfirmed) {
        return next(new ValidationError('Both confirmation checkboxes must be ticked'));
      }

      const txDocs = await complianceRepo.findTransactionDocuments(transactionId);
      if (!txDocs) return next(new NotFoundError('Transaction', transactionId));

      if (txDocs.status !== 'completed') {
        return next(
          new ForbiddenError('Documents can only be downloaded from completed transactions'),
        );
      }

      // Collect all file paths
      const filesToProcess: { filePath: string; docType: string; recordId: string }[] = [];

      if (txDocs.otps[0]?.scannedCopyPath) {
        filesToProcess.push({
          filePath: txDocs.otps[0].scannedCopyPath,
          docType: 'otp',
          recordId: txDocs.otps[0].id,
        });
      }
      if (txDocs.commissionInvoice?.invoiceFilePath) {
        filesToProcess.push({
          filePath: txDocs.commissionInvoice.invoiceFilePath,
          docType: 'invoice',
          recordId: txDocs.commissionInvoice.id,
        });
      }

      // Validate ALL files exist before starting the download
      const missingFiles: string[] = [];
      for (const doc of filesToProcess) {
        try {
          await fs.access(doc.filePath);
        } catch {
          missingFiles.push(path.basename(doc.filePath));
        }
      }
      if (missingFiles.length > 0) {
        return next(
          new ValidationError(
            `Cannot proceed: the following files are missing from server: ${missingFiles.join(', ')}`,
          ),
        );
      }

      if (filesToProcess.length === 0) {
        return next(new ValidationError('No sensitive documents found for this transaction'));
      }

      const agentId = (req.user as { id: string }).id;

      // Stream zip
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transaction-${transactionId}-documents.zip"`,
      );

      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('error', (archiveErr) => {
        return next(archiveErr);
      });

      archive.pipe(res);

      for (const doc of filesToProcess) {
        archive.file(doc.filePath, { name: path.basename(doc.filePath) });
      }

      await archive.finalize();

      // Archive has finalized — now delete all files (best-effort)
      const fileNames: string[] = [];
      for (const doc of filesToProcess) {
        fileNames.push(path.basename(doc.filePath));
        try {
          await fs.unlink(doc.filePath);
          if (doc.docType === 'otp') {
            await complianceRepo.markOtpScannedCopyDeleted(doc.recordId);
          } else if (doc.docType === 'invoice') {
            await complianceRepo.markInvoiceDeleted(doc.recordId);
          }
        } catch (deleteErr) {
          // logger is imported statically at the top of the router file (see imports block below)
          logger.error({ deleteErr, filePath: doc.filePath }, 'Failed to delete file post-bulk-download');
        }
      }

      await auditService.log({
        action: 'documents.downloaded_and_deleted',
        entityType: 'transaction',
        entityId: transactionId,
        details: {
          files: fileNames,
          downloadedBy: agentId,
          offlineRetentionConfirmed: true,
          reason: 'server data minimisation',
          bulk: true,
        },
        agentId,
      });
    } catch (err) {
      return next(err);
    }
  },
);
```

Also add these imports to the top of the router file:

```typescript
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors';
import * as complianceRepo from './compliance.repository';
import * as auditService from '../shared/audit.service';
```

- [ ] **Step 3: Create the download confirmation modal partial**

```html
{# src/views/partials/compliance/download-confirm-modal.njk #}
<div id="download-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
  <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
    <div class="flex items-center gap-3 mb-4">
      <span class="text-amber-500 text-2xl">⚠️</span>
      <h3 class="text-lg font-semibold text-gray-900">{{ "Download & Permanently Delete" | t }}</h3>
    </div>

    <p class="text-sm text-gray-600 mb-4">
      {{ "You are about to download and permanently delete these documents from the server. This action cannot be undone." | t }}
    </p>

    <p class="text-sm text-gray-600 mb-4">
      {{ "These documents are required to be retained for 5 years under AML/CFT regulations. By proceeding, you confirm that:" | t }}
    </p>

    <form id="download-confirm-form"
          hx-post="/agent/transactions/{{ transactionId }}/documents/download-all-and-delete"
          hx-target="#download-modal"
          hx-swap="outerHTML">

      <div class="space-y-3 mb-6">
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="offlineRetentionConfirmed" value="true" required
                 id="confirm-offline"
                 class="mt-0.5 rounded border-gray-300 text-blue-600"
                 onchange="checkBothBoxes()">
          <span class="text-sm text-gray-700">{{ "I have stored these documents securely offline" | t }}</span>
        </label>

        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="canProduceConfirmed" value="true" required
                 id="confirm-produce"
                 class="mt-0.5 rounded border-gray-300 text-blue-600"
                 onchange="checkBothBoxes()">
          <span class="text-sm text-gray-700">{{ "I can produce these documents if requested by authorities" | t }}</span>
        </label>
      </div>

      <div class="flex gap-3 justify-end">
        <button type="button"
                onclick="document.getElementById('download-modal').remove()"
                class="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
          {{ "Cancel" | t }}
        </button>
        <button type="submit"
                id="download-submit-btn"
                disabled
                class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {{ "Download & Delete" | t }}
        </button>
      </div>
    </form>
  </div>
</div>
<script>
function checkBothBoxes() {
  const both = document.getElementById('confirm-offline').checked
             && document.getElementById('confirm-produce').checked;
  document.getElementById('download-submit-btn').disabled = !both;
}
</script>
```

- [ ] **Step 4: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts \
        src/domains/compliance/compliance.router.ts \
        src/views/partials/compliance/download-confirm-modal.njk
git commit -m "feat(compliance): add secure download-and-delete routes and modal"
```

---

## Chunk 5: Integration Tests

### Task 7: Write SP3 integration tests

**Files:**
- Create: `tests/integration/compliance-sp3.test.ts`

- [ ] **Step 1: Write the integration tests**

```typescript
// tests/integration/compliance-sp3.test.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import * as complianceService from '@/domains/compliance/compliance.service';

async function createTestSeller(overrides: Record<string, unknown> = {}) {
  return prisma.seller.create({
    data: {
      id: createId(),
      name: 'Test Seller',
      phone: `+6591${Math.floor(Math.random() * 900000 + 100000)}`,
      consentService: true,
      consentMarketing: true,
      ...overrides,
    },
  });
}

async function createTestAgent() {
  return prisma.agent.create({
    data: {
      id: createId(),
      name: 'Test Agent',
      email: `agent-${createId()}@test.com`,
      phone: `+6598${Math.floor(Math.random() * 900000 + 100000)}`,
      ceaRegNo: `R${createId().slice(0, 7)}`,
      passwordHash: 'hash',
      role: 'agent',
    },
  });
}

describe('Compliance SP3 — Retention + Deletion + Anonymisation (integration)', () => {
  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.dataDeletionRequest.deleteMany();
    await prisma.consentRecord.deleteMany();
    // Cascade: transactions → otps, etc.
    await prisma.transaction.deleteMany();
    await prisma.property.deleteMany();
    await prisma.seller.deleteMany();
    await prisma.agent.deleteMany();
  });

  describe('scanRetention — leads', () => {
    it('flags stale lead (inactive 13 months)', async () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 13);
      const seller = await createTestSeller({ status: 'lead' });

      // Force updatedAt to old date
      await prisma.seller.update({
        where: { id: seller.id },
        data: { updatedAt: oldDate },
      });

      const result = await complianceService.scanRetention();
      expect(result.flaggedCount).toBeGreaterThanOrEqual(1);

      const request = await prisma.dataDeletionRequest.findFirst({
        where: { targetId: seller.id, targetType: 'lead' },
      });
      expect(request?.status).toBe('flagged');
      expect(request?.retentionRule).toBe('lead_12_month');
    });

    it('does not flag lead active 6 months ago', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);
      const seller = await createTestSeller({ status: 'lead' });

      await prisma.seller.update({
        where: { id: seller.id },
        data: { updatedAt: recentDate },
      });

      await complianceService.scanRetention();

      // No new deletion requests for this seller
      const request = await prisma.dataDeletionRequest.findFirst({
        where: { targetId: seller.id },
      });
      expect(request).toBeNull();
    });
  });

  describe('executeHardDelete', () => {
    it('deletes seller record and its data after admin approval', async () => {
      const seller = await createTestSeller({ status: 'lead' });
      const agent = await createTestAgent();

      const deletionRequest = await prisma.dataDeletionRequest.create({
        data: {
          id: createId(),
          targetType: 'lead',
          targetId: seller.id,
          reason: 'Test deletion',
          retentionRule: 'lead_12_month',
          status: 'flagged',
          details: { sellerName: seller.name },
        },
      });

      await complianceService.executeHardDelete({
        requestId: deletionRequest.id,
        agentId: agent.id,
        reviewNotes: 'Confirmed no retention obligation',
      });

      // Seller is gone
      const deleted = await prisma.seller.findUnique({ where: { id: seller.id } });
      expect(deleted).toBeNull();

      // Audit log persists
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'data.hard_deleted', entityId: seller.id },
      });
      expect(auditLog).not.toBeNull();

      // Deletion request marked executed
      const executed = await prisma.dataDeletionRequest.findUnique({
        where: { id: deletionRequest.id },
      });
      expect(executed?.status).toBe('executed');
    });

    it('throws ComplianceError for blocked deletion request', async () => {
      const seller = await createTestSeller();
      const agent = await createTestAgent();

      const blockedRequest = await prisma.dataDeletionRequest.create({
        data: {
          id: createId(),
          targetType: 'lead',
          targetId: seller.id,
          reason: 'Service consent withdrawn',
          retentionRule: 'aml_cft_5_year',
          status: 'blocked',
          details: { retentionEndDate: new Date(Date.now() + 1e9).toISOString() },
        },
      });

      await expect(
        complianceService.executeHardDelete({
          requestId: blockedRequest.id,
          agentId: agent.id,
        }),
      ).rejects.toThrow('AML/CFT retention requirement');
    });
  });

  describe('anonymiseAgent', () => {
    it('replaces agent PII with anonymised values', async () => {
      const agent = await createTestAgent();
      const admin = await createTestAgent();

      await complianceService.anonymiseAgent({
        agentId: agent.id,
        requestedByAgentId: admin.id,
      });

      const anonymised = await prisma.agent.findUnique({ where: { id: agent.id } });
      expect(anonymised?.name).toBe(`Former Agent ${agent.id}`);
      expect(anonymised?.email).toBe(`anonymised-${agent.id}@deleted.local`);
      expect(anonymised?.phone).toBeNull();

      // Agent record still exists (for audit log referential integrity)
      expect(anonymised).not.toBeNull();

      // Audit log created
      const log = await prisma.auditLog.findFirst({
        where: { action: 'agent.anonymised', entityId: agent.id },
      });
      expect(log).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run docker:test:db && npm run test:integration -- --testPathPattern="compliance-sp3" 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/compliance-sp3.test.ts
git commit -m "test(compliance): add SP3 integration tests for retention, deletion, anonymisation"
```

---

## SP3 Complete — Phase 5 Complete

Run the full test suite one final time to confirm all Phase 5 work is solid:

```bash
npm test && npm run test:integration 2>&1 | tail -20
```

Expected: all unit and integration tests PASS.

Phase 5 deliverables:
- ✅ SP1: Compliance domain + consent withdrawal + DNC gate wired into notification service
- ✅ SP2: Seller "My Data" page + correction requests + NRIC helpers
- ✅ SP3: Retention scanner + admin deletion queue + agent anonymisation + secure download-and-delete
