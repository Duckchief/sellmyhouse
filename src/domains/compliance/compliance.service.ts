// src/domains/compliance/compliance.service.ts
import * as complianceRepo from './compliance.repository';
import * as settingsService from '@/domains/shared/settings.service';
import { localStorage } from '@/infra/storage/local-storage';
import * as auditService from '../shared/audit.service';
import { NotFoundError, ComplianceError } from '../shared/errors';
import { AUTO_APPLY_FIELDS, type CreateCorrectionRequestInput } from './compliance.types';
import type {
  DncChannel,
  MessageType,
  DncAllowedResult,
  WithdrawConsentInput,
  ConsentWithdrawalResult,
} from './compliance.types';

// ─── DNC Gate ────────────────────────────────────────────────────────────────

export async function checkDncAllowed(
  sellerId: string,
  _channel: DncChannel,
  messageType: MessageType,
): Promise<DncAllowedResult> {
  const consent = await complianceRepo.findSellerConsent(sellerId);
  if (!consent) {
    // Seller not found: conservative default — block
    return { allowed: false, reason: 'Seller consent record not found' };
  }

  if (!consent.consentService) {
    return { allowed: false, reason: 'Seller has withdrawn service consent' };
  }

  if (messageType === 'marketing' && !consent.consentMarketing) {
    return { allowed: false, reason: 'Seller has not given marketing consent' };
  }

  // TODO: Integrate Singapore DNC Registry API before enabling
  // outbound marketing at scale. Currently always returns
  // { blocked: false }. Tracked in [your issue tracker].
  return { allowed: true };
}

// ─── Consent Withdrawal ───────────────────────────────────────────────────────

export async function withdrawConsent(
  input: WithdrawConsentInput,
): Promise<ConsentWithdrawalResult> {
  const currentConsent = await complianceRepo.findSellerConsent(input.sellerId);
  if (!currentConsent) {
    throw new NotFoundError('Seller', input.sellerId);
  }

  const now = new Date();

  // Build the new consent record (append-only — never update existing records)
  const newRecord = await complianceRepo.createConsentRecord({
    subjectId: input.sellerId,
    purposeService: input.type === 'service' ? false : currentConsent.consentService,
    purposeMarketing: input.type === 'marketing' ? false : currentConsent.consentMarketing,
    consentWithdrawnAt: now,
    withdrawalChannel: input.channel,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Update the Seller's fast-access consent flag
  if (input.type === 'service') {
    await complianceRepo.updateSellerConsent(input.sellerId, { consentService: false });
  } else {
    await complianceRepo.updateSellerConsent(input.sellerId, { consentMarketing: false });
  }

  // For marketing withdrawal: no deletion request needed
  if (input.type === 'marketing') {
    await auditService.log({
      action: 'consent.withdrawn',
      entityType: 'seller',
      entityId: input.sellerId,
      details: { type: input.type, channel: input.channel, consentRecordId: newRecord.id },
    });
    return { consentRecordId: newRecord.id, deletionBlocked: false };
  }

  // For service withdrawal: check if any transactions exist (AML/CFT override)
  const sellerWithTx = await complianceRepo.findSellerWithTransactions(input.sellerId);
  if (!sellerWithTx) {
    throw new NotFoundError('Seller', input.sellerId);
  }
  const hasAnyTransaction = sellerWithTx.transactions.length > 0;

  if (hasAnyTransaction) {
    // Find the most recent completion date for retention end calculation
    const completedTxDates = sellerWithTx.transactions
      .filter((tx) => tx.completionDate)
      .map((tx) => tx.completionDate as Date)
      .sort((a, b) => b.getTime() - a.getTime());

    const latestCompletion = completedTxDates[0] ?? now;
    const retentionEndDate = new Date(latestCompletion);
    retentionEndDate.setFullYear(retentionEndDate.getFullYear() + 5);

    // DeletionTargetType enum has no 'seller' value; 'lead' is the closest valid type
    const deletionRequest = await complianceRepo.createDeletionRequest({
      targetType: 'lead',
      targetId: input.sellerId,
      reason: 'Service consent withdrawn by seller',
      retentionRule: 'aml_cft_5_year',
      status: 'blocked',
      details: {
        sellerId: input.sellerId,
        withdrawalDate: now.toISOString(),
        retentionEndDate: retentionEndDate.toISOString(),
        transactionCount: sellerWithTx.transactions.length,
      },
    });

    await auditService.log({
      action: 'consent.withdrawn',
      entityType: 'seller',
      entityId: input.sellerId,
      details: { type: input.type, channel: input.channel, consentRecordId: newRecord.id },
    });

    return {
      consentRecordId: newRecord.id,
      deletionRequestId: deletionRequest.id,
      deletionBlocked: true,
      retentionRule: 'aml_cft_5_year',
    };
  }

  // No transactions: flag for 30-day grace deletion
  // DeletionTargetType enum has no 'seller' value; 'lead' is the closest valid type
  const deletionRequest = await complianceRepo.createDeletionRequest({
    targetType: 'lead',
    targetId: input.sellerId,
    reason: 'Service consent withdrawn by seller',
    retentionRule: '30_day_grace',
    status: 'flagged',
    details: {
      sellerId: input.sellerId,
      withdrawalDate: now.toISOString(),
    },
  });

  await auditService.log({
    action: 'consent.withdrawn',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { type: input.type, channel: input.channel, consentRecordId: newRecord.id },
  });

  return {
    consentRecordId: newRecord.id,
    deletionRequestId: deletionRequest.id,
    deletionBlocked: false,
    retentionRule: '30_day_grace',
  };
}

// ─── Correction Requests ──────────────────────────────────────────────────────

export async function createCorrectionRequest(
  input: CreateCorrectionRequestInput & { sellerId: string },
) {
  const request = await complianceRepo.createCorrectionRequest(input);

  await auditService.log({
    action: 'data_correction.requested',
    entityType: 'data_correction_request',
    entityId: request.id,
    details: {
      sellerId: input.sellerId,
      fieldName: input.fieldName,
      requestedValue: input.requestedValue,
    },
  });

  return request;
}

export async function processCorrectionRequest(input: {
  requestId: string;
  agentId: string;
  decision: 'approve' | 'reject';
  processNotes?: string;
}) {
  const request = await complianceRepo.findCorrectionRequest(input.requestId);
  if (!request) throw new NotFoundError('DataCorrectionRequest', input.requestId);

  const now = new Date();
  const newStatus = input.decision === 'approve' ? 'completed' : 'rejected';

  await complianceRepo.updateCorrectionRequest(input.requestId, {
    status: newStatus,
    processedByAgentId: input.agentId,
    processedAt: now,
    processNotes: input.processNotes,
  });

  if (input.decision === 'approve') {
    const isAutoApply = (AUTO_APPLY_FIELDS as readonly string[]).includes(request.fieldName);
    if (isAutoApply) {
      await complianceRepo.updateSellerField(
        request.sellerId,
        request.fieldName,
        request.requestedValue,
      );
    }

    await auditService.log({
      action: 'data_correction.processed',
      entityType: 'data_correction_request',
      entityId: input.requestId,
      details: {
        sellerId: request.sellerId,
        fieldName: request.fieldName,
        requestedValue: request.requestedValue,
        autoApplied: isAutoApply,
        agentId: input.agentId,
      },
    });
  } else {
    await auditService.log({
      action: 'data_correction.rejected',
      entityType: 'data_correction_request',
      entityId: input.requestId,
      details: {
        sellerId: request.sellerId,
        fieldName: request.fieldName,
        processNotes: input.processNotes,
        agentId: input.agentId,
      },
    });
  }
}

// ─── My Data ──────────────────────────────────────────────────────────────────

export async function getMyData(sellerId: string) {
  const data = await complianceRepo.getSellerPersonalData(sellerId);
  if (!data) throw new NotFoundError('Seller', sellerId);

  const { maskNric } = await import('../shared/nric');
  const nricDisplay = data.cddRecords[0]?.nricLast4 ? maskNric(data.cddRecords[0].nricLast4) : null;

  const correctionRequests = await complianceRepo.findCorrectionRequestsBySeller(sellerId);
  const consentHistory = await complianceRepo.findAllConsentRecords(sellerId);

  return {
    seller: {
      id: data.id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      status: data.status,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      notificationPreference: data.notificationPreference,
      createdAt: data.createdAt,
      nricDisplay,
      identityVerified: data.cddRecords[0]?.identityVerified ?? false,
    },
    properties: data.properties,
    consentHistory,
    correctionRequests,
  };
}

export async function generateDataExport(sellerId: string): Promise<Record<string, unknown>> {
  const myData = await getMyData(sellerId);
  return {
    exportedAt: new Date().toISOString(),
    seller: myData.seller,
    properties: myData.properties,
    consentHistory: myData.consentHistory.map((r) => ({
      purposeService: r.purposeService,
      purposeMarketing: r.purposeMarketing,
      consentGivenAt: r.consentGivenAt,
      consentWithdrawnAt: r.consentWithdrawnAt,
    })),
    correctionRequests: myData.correctionRequests.map((r) => ({
      fieldName: r.fieldName,
      requestedValue: r.requestedValue,
      status: r.status,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
    })),
  };
}

// ─── SP3: Retention Scanning ──────────────────────────────────────────────────

export interface ScanRetentionResult {
  flaggedCount: number;
  skippedCount: number;
}

export async function scanRetention(): Promise<ScanRetentionResult> {
  const now = new Date();
  let flaggedCount = 0;
  let skippedCount = 0;

  // Load retention periods from SystemSetting (never hardcode)
  const [
    leadRetentionMonths,
    transactionRetentionYears,
    cddRetentionYears,
    consentPostWithdrawalRetentionYears,
  ] = await Promise.all([
    settingsService.getNumber('lead_retention_months', 12),
    settingsService.getNumber('transaction_retention_years', 5),
    settingsService.getNumber('cdd_retention_years', 5),
    settingsService.getNumber('consent_post_withdrawal_retention_years', 1),
  ]);

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

  // 1. Leads inactive for configured months
  const leadCutoff = new Date(now);
  leadCutoff.setMonth(leadCutoff.getMonth() - leadRetentionMonths);
  const staleLeads = await complianceRepo.findLeadsForRetention(leadCutoff);
  for (const lead of staleLeads) {
    await flagIfNew('lead', lead.id, 'Lead inactive for 12+ months', 'lead_12_month', 'flagged', {
      sellerName: lead.name,
      lastActivity: lead.updatedAt,
    });
  }

  // 2. Service consent withdrawn 30+ days, no transactions
  const withdrawalCutoff = new Date(now);
  withdrawalCutoff.setDate(withdrawalCutoff.getDate() - 30);
  const withdrawnSellers = await complianceRepo.findServiceWithdrawnForDeletion(withdrawalCutoff);
  for (const seller of withdrawnSellers) {
    await flagIfNew(
      'lead',
      seller.id,
      'Service consent withdrawn > 30 days ago',
      '30_day_grace',
      'flagged',
      {
        sellerName: seller.name,
      },
    );
  }

  // 3. Transactions post configured retention period
  const txCutoff = new Date(now);
  txCutoff.setFullYear(txCutoff.getFullYear() - transactionRetentionYears);
  const oldTransactions = await complianceRepo.findTransactionsForRetention(txCutoff);
  for (const tx of oldTransactions) {
    await flagIfNew(
      'transaction',
      tx.id,
      'Transaction record > 5 years post-completion',
      'transaction_5_year',
      'flagged',
      {
        sellerId: tx.sellerId,
        completionDate: tx.completionDate,
      },
    );
  }

  // 4. CDD documents past configured retention period since verification
  const cddCutoff = new Date(now);
  cddCutoff.setFullYear(cddCutoff.getFullYear() - cddRetentionYears);
  const oldCddRecords = await complianceRepo.findCddRecordsForRetention(cddCutoff);
  for (const cdd of oldCddRecords) {
    await flagIfNew(
      'cdd_documents',
      cdd.id,
      'CDD documents > 5 years old',
      'cdd_5_year',
      'flagged',
      {
        subjectId: cdd.subjectId,
        verifiedAt: cdd.verifiedAt,
      },
    );
  }

  // 5. Withdrawn consent records past configured retention period post-withdrawal
  const consentCutoff = new Date(now);
  consentCutoff.setFullYear(consentCutoff.getFullYear() - consentPostWithdrawalRetentionYears);
  const oldConsentRecords = await complianceRepo.findConsentRecordsForDeletion(consentCutoff);
  for (const record of oldConsentRecords) {
    await flagIfNew(
      'consent_record',
      record.id,
      'Consent record > 1 year post-withdrawal',
      'consent_1_year_post_withdrawal',
      'flagged',
      {
        sellerId: record.sellerId,
        withdrawnAt: record.consentWithdrawnAt,
      },
    );
  }

  // 6. Stale data correction requests — alert agent (not deletion)
  const correctionCutoff = new Date(now);
  correctionCutoff.setDate(correctionCutoff.getDate() - 30);
  const staleCorrections = await complianceRepo.findStaleCorrectionRequests(correctionCutoff);
  for (const req of staleCorrections) {
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

// ─── SP3: Hard Delete ─────────────────────────────────────────────────────────

export async function executeHardDelete(input: {
  requestId: string;
  agentId: string;
  reviewNotes?: string;
}): Promise<void> {
  const request = await complianceRepo.findDeletionRequest(input.requestId);
  if (!request) throw new NotFoundError('DataDeletionRequest', input.requestId);

  if (request.status === 'blocked') {
    throw new ComplianceError(
      `Cannot delete: AML/CFT retention requirement applies. Rule: ${request.retentionRule}`,
    );
  }

  if (request.status !== 'flagged' && request.status !== 'pending_review') {
    throw new ComplianceError(`Deletion request is not in a reviewable state: ${request.status}`);
  }

  const details = request.details as Record<string, unknown> | null;
  const auditSnapshot = {
    targetType: request.targetType,
    targetId: request.targetId,
    retentionRule: request.retentionRule,
    approvedByAgentId: input.agentId,
    details,
  };

  switch (request.targetType) {
    case 'lead':
    case 'seller': {
      // Collect all file paths before the DB cascade removes FK references
      const filePaths = await complianceRepo.collectSellerFilePaths(request.targetId);
      await complianceRepo.hardDeleteSeller(request.targetId);
      for (const filePath of filePaths) {
        try {
          await localStorage.delete(filePath);
        } catch (err) {
          await auditService.log({
            action: 'compliance.file_unlink_failed',
            entityType: 'seller',
            entityId: request.targetId,
            details: {
              filePath,
              error: err instanceof Error ? err.message : String(err),
              requestId: input.requestId,
            },
            agentId: input.agentId,
          });
        }
      }
      break;
    }

    case 'cdd_documents': {
      // File paths may be stored in details; unlink before clearing DB record
      const docDetails = details as { filePaths?: string[] } | null;
      const paths = docDetails?.filePaths ?? [];
      for (const filePath of paths) {
        try {
          await localStorage.delete(filePath);
        } catch (err) {
          // Log the failure — orphaned files need operator attention
          await auditService.log({
            action: 'compliance.file_unlink_failed',
            entityType: 'cdd_documents',
            entityId: request.targetId,
            details: {
              filePath,
              error: err instanceof Error ? err.message : String(err),
              requestId: input.requestId,
            },
            agentId: input.agentId,
          });
        }
      }
      await complianceRepo.hardDeleteCddDocuments(request.targetId);
      break;
    }

    case 'consent_record':
      await complianceRepo.hardDeleteConsentRecord(request.targetId);
      break;

    case 'transaction': {
      const filePaths = await complianceRepo.collectTransactionFilePaths(request.targetId);
      await complianceRepo.hardDeleteTransaction(request.targetId);
      for (const filePath of filePaths) {
        try {
          await localStorage.delete(filePath);
        } catch (err) {
          await auditService.log({
            action: 'compliance.file_unlink_failed',
            entityType: 'transaction',
            entityId: request.targetId,
            details: {
              filePath,
              error: err instanceof Error ? err.message : String(err),
              requestId: input.requestId,
            },
            agentId: input.agentId,
          });
        }
      }
      break;
    }

    default:
      throw new ComplianceError(`Unknown target type for deletion: ${request.targetType}`);
  }

  const now = new Date();
  await complianceRepo.updateDeletionRequest(input.requestId, {
    status: 'executed',
    reviewedByAgentId: input.agentId,
    reviewedAt: now,
    reviewNotes: input.reviewNotes,
    executedAt: now,
  });

  await auditService.log({
    action: 'data.hard_deleted',
    entityType: request.targetType,
    entityId: request.targetId,
    details: auditSnapshot,
    agentId: input.agentId,
  });
}

// ─── Deletion Queue (called by admin service) ─────────────────────────────────

export async function getDeletionQueue() {
  return complianceRepo.findPendingDeletionRequests();
}

// ─── Secure Document Access (service wrappers for router) ─────────────────────

export async function getTransactionDocuments(transactionId: string) {
  return complianceRepo.findTransactionDocuments(transactionId);
}

export async function recordOtpScannedCopyDeleted(otpId: string): Promise<void> {
  return complianceRepo.markOtpScannedCopyDeleted(otpId);
}

export async function recordInvoiceDeleted(invoiceId: string): Promise<void> {
  return complianceRepo.markInvoiceDeleted(invoiceId);
}

export async function recordEaaSignedCopyDeleted(eaaId: string): Promise<void> {
  return complianceRepo.markEaaSignedCopyDeleted(eaaId);
}

export async function getCddRecordsByTransaction(transactionId: string) {
  return complianceRepo.findCddRecordsByTransaction(transactionId);
}

// ─── SP3: Agent Anonymisation ─────────────────────────────────────────────────

export async function anonymiseAgent(input: {
  agentId: string;
  requestedByAgentId: string;
}): Promise<void> {
  const agent = await complianceRepo.findAgentById(input.agentId);
  if (!agent) throw new NotFoundError('Agent', input.agentId);

  if (agent.isActive) {
    throw new ComplianceError(
      'Cannot anonymise an active agent. Deactivate the agent account first.',
    );
  }

  const snapshot = {
    originalName: agent.name,
    originalEmail: agent.email,
    originalPhone: agent.phone,
    anonymisedBy: input.requestedByAgentId,
  };

  await complianceRepo.anonymiseAgentRecord(input.agentId);

  await auditService.log({
    action: 'agent.anonymised',
    entityType: 'agent',
    entityId: input.agentId,
    details: snapshot,
    agentId: input.requestedByAgentId,
  });
}
