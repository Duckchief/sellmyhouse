// src/domains/compliance/compliance.service.ts
import * as complianceRepo from './compliance.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError } from '../shared/errors';
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
