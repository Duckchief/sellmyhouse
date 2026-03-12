// src/domains/compliance/compliance.service.ts
import * as complianceRepo from './compliance.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError } from '../shared/errors';
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

  // TODO: Integrate real Singapore DNC registry API check
  // For now, consent flags serve as the gate.
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
      await complianceRepo.updateSellerField(request.sellerId, request.fieldName, request.requestedValue);
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
  const nricDisplay = data.cddRecords[0]?.nricLast4
    ? maskNric(data.cddRecords[0].nricLast4)
    : null;

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
