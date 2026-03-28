// src/domains/compliance/compliance.service.ts
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import * as complianceRepo from './compliance.repository';
import * as txRepo from '@/domains/transaction/transaction.repository';
import * as sellerService from '@/domains/seller/seller.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as propertyRepo from '@/domains/property/property.repository';
import * as offerRepo from '@/domains/offer/offer.repository';
import * as viewingRepo from '@/domains/viewing/viewing.repository';
import * as notificationService from '@/domains/notification/notification.service';
import { logger } from '@/infra/logger';
import { localStorage } from '@/infra/storage/local-storage';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import * as auditService from '../shared/audit.service';
import {
  NotFoundError,
  ComplianceError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../shared/errors';
import { maskNric } from '../shared/nric';
import { AUTO_APPLY_FIELDS, type CreateCorrectionRequestInput } from './compliance.types';
import type {
  DncChannel,
  MessageType,
  DncAllowedResult,
  WithdrawConsentInput,
  ConsentWithdrawalResult,
  GrantConsentInput,
  ConsentGrantResult,
  CreateCddRecordInput,
  CddRecord,
  CreateEaaInput,
  EaaRecord,
  ConfirmEaaExplanationInput,
  CddDocument,
  CddDocumentType,
  UploadCddDocumentInput,
  DownloadCddDocumentInput,
  DeleteCddDocumentInput,
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

  // DNC Registry Integration (PDPA)
  // Current approach: consent-based. Sellers explicitly opt in during onboarding,
  // so service communications are permitted. Marketing communications are gated
  // by the consentMarketing flag (separate from service consent, never pre-ticked).
  //
  // Future enhancement: integrate Singapore DNC Registry API (https://www.dnc.gov.sg)
  // for outbound marketing to non-clients (e.g., cold outreach campaigns).
  // This is not needed for current MVP where all communications are to opted-in sellers.
  //
  // When implementing:
  //   1. Register for DNC API access at dnc.gov.sg
  //   2. Before any marketing WhatsApp/phone call to a NEW number (not an existing seller),
  //      check the number against the DNC registry
  //   3. Cache results for 30 days (DNC registry updates monthly)
  //   4. Log all DNC checks in audit trail
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

  // Atomically create consent record + update seller flag in a single transaction
  const newRecord = await complianceRepo.withdrawConsentAtomically(input.sellerId, input.type, {
    subjectId: input.sellerId,
    purposeService: input.type === 'service' ? false : currentConsent.consentService,
    purposeMarketing: input.type === 'marketing' ? false : currentConsent.consentMarketing,
    consentWithdrawnAt: now,
    withdrawalChannel: input.channel,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

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

  let retentionRule: string;
  let deletionRequestDetails: Record<string, string | number>;

  if (hasAnyTransaction) {
    // Find the most recent completion date for retention end calculation
    const completedTxDates = sellerWithTx.transactions
      .filter((tx) => tx.completionDate)
      .map((tx) => tx.completionDate as Date)
      .sort((a, b) => b.getTime() - a.getTime());

    const latestCompletion = completedTxDates[0] ?? now;
    const retentionEndDate = new Date(latestCompletion);
    retentionEndDate.setDate(retentionEndDate.getDate() + 30); // 30-day post-completion purge

    retentionRule = 'post_completion_purge';
    deletionRequestDetails = {
      sellerId: input.sellerId,
      withdrawalDate: now.toISOString(),
      retentionEndDate: retentionEndDate.toISOString(),
      transactionCount: sellerWithTx.transactions.length,
    };
  } else {
    // No transactions: flag for 30-day grace deletion
    retentionRule = '30_day_grace';
    deletionRequestDetails = {
      sellerId: input.sellerId,
      withdrawalDate: now.toISOString(),
    };
  }

  // DeletionTargetType enum has no 'seller' value; 'lead' is the closest valid type
  const deletionRequest = await complianceRepo.createDeletionRequest({
    targetType: 'lead',
    targetId: input.sellerId,
    reason: 'Service consent withdrawn by seller',
    retentionRule,
    status: 'flagged',
    details: deletionRequestDetails,
  });

  await auditService.log({
    action: 'consent.withdrawn',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { type: input.type, channel: input.channel, consentRecordId: newRecord.id },
  });

  // Side effects: void offers, cancel viewings, delist listing, mark transaction fallen_through
  // Best-effort — failures are logged but must not block the withdrawal
  try {
    await executeConsentWithdrawalSideEffects(input.sellerId);
  } catch (err) {
    logger.error({ err, sellerId: input.sellerId }, 'consent.withdrawal.side_effects_failed');
  }

  return {
    consentRecordId: newRecord.id,
    deletionRequestId: deletionRequest.id,
    deletionBlocked: false,
    retentionRule,
  };
}

// ─── Consent Grant ────────────────────────────────────────────────────────────

export async function grantMarketingConsent(input: GrantConsentInput): Promise<ConsentGrantResult> {
  const currentConsent = await complianceRepo.findSellerConsent(input.sellerId);
  if (!currentConsent) {
    throw new NotFoundError('Seller', input.sellerId);
  }

  // Atomically create consent record + update seller flag in a single transaction
  const newRecord = await complianceRepo.grantConsentAtomically(input.sellerId, {
    subjectId: input.sellerId,
    purposeService: currentConsent.consentService,
    purposeMarketing: true,
    withdrawalChannel: input.channel, // schema field is named for withdrawal but stores the interaction channel for both grant and withdraw
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await auditService.log({
    action: 'consent.granted',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { type: 'marketing', channel: input.channel, consentRecordId: newRecord.id },
  });

  return { consentRecordId: newRecord.id };
}

async function executeConsentWithdrawalSideEffects(sellerId: string): Promise<void> {
  const property = await propertyRepo.findBySellerId(sellerId);
  if (property) {
    const address = `${property.block} ${property.street} ${property.town}`;

    // 1. Void all pending/countered offers in one batch
    const offers = await offerRepo.findByPropertyId(property.id);
    await offerRepo.expirePendingAndCounteredSiblings(property.id, '');

    // Notify listing agent for co-broke offers (buyer's agent is external — agent handles follow-up)
    const seller = await sellerService.findById(sellerId);
    const coBrokeOffers = offers.filter(
      (o) =>
        (o.status === 'pending' || o.status === 'countered') && o.buyerAgentName && seller?.agentId,
    );
    for (const offer of coBrokeOffers) {
      try {
        await notificationService.send(
          {
            recipientType: 'agent',
            recipientId: seller!.agentId!,
            templateName: 'generic',
            templateData: {
              message: `The seller for ${address} has withdrawn from the transaction. The offer has been voided.`,
            },
            preferredChannel: 'whatsapp',
          },
          seller!.agentId!,
        );
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, offerId: offer.id },
          'Failed to notify agent of voided offer',
        );
      }
    }

    // 2. Cancel all active viewing slots in one batch
    const activeSlots = await viewingRepo.findActiveSlotsByPropertyId(property.id);
    if (activeSlots.length > 0) {
      await viewingRepo.bulkCancelSlotsAndViewings(activeSlots.map((s) => s.id));
    }

    // 3. Delist active listing
    const listing = await propertyRepo.findActiveListingForProperty(property.id);
    if (listing) {
      await propertyRepo.updateListingStatus(listing.id, 'closed');
    }
  }

  // 4. Transition any active transaction to fallen_through
  const activeTx = await txRepo.findTransactionBySellerId(sellerId);
  if (activeTx) {
    await txRepo.updateFallenThrough(activeTx.id, 'Seller withdrew service consent');
  }
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

  const nricDisplay = data.cddRecords[0]?.nricLast4 ? maskNric(data.cddRecords[0].nricLast4) : null;

  const [correctionRequests, consentHistory] = await Promise.all([
    complianceRepo.findCorrectionRequestsBySeller(sellerId),
    complianceRepo.findAllConsentRecords(sellerId),
  ]);

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

// Masks NRIC values at known key names in a nested details object (Finding #3).
// Only targets fields named `nricLast4` / `nric_last4` to avoid false-positive masking.
function maskNricInDetails(details: unknown): unknown {
  if (!details || typeof details !== 'object') return details;
  if (Array.isArray(details)) return details.map(maskNricInDetails);
  const obj = details as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => {
      if ((k === 'nricLast4' || k === 'nric_last4') && typeof v === 'string') {
        return [k, maskNric(v)];
      }
      return [k, maskNricInDetails(v)];
    }),
  );
}

export async function generateDataExport(sellerId: string): Promise<Record<string, unknown>> {
  // A2: Audit data access request
  await auditService.log({
    action: 'data_access.requested',
    entityType: 'seller',
    entityId: sellerId,
    details: { requestedBy: 'seller' },
  });

  const myData = await getMyData(sellerId);

  // Finding #3: Include audit trail entries recorded against the seller's ID.
  // NRIC values in details are masked before export — only last4 is ever stored.
  const auditLogs = await complianceRepo.findAuditLogsForSeller(sellerId);

  const exportData = {
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
    auditTrail: auditLogs.map((entry) => ({
      action: entry.action,
      entityType: entry.entityType,
      details: maskNricInDetails(entry.details),
      createdAt: entry.createdAt,
    })),
  };

  // A2: Audit data access fulfilled
  await auditService.log({
    action: 'data_access.fulfilled',
    entityType: 'seller',
    entityId: sellerId,
    details: { format: 'json', fieldsIncluded: Object.keys(exportData) },
  });

  return exportData;
}

// ─── SP3: Retention Scanning ──────────────────────────────────────────────────

export interface ScanRetentionResult {
  flaggedCount: number;
  skippedCount: number;
}

// ─── Tier 1: Daily Sensitive Document Purge ──────────────────────────────────

export async function purgeSensitiveDocs(): Promise<{ purgedCount: number }> {
  const sensitiveDocRetentionDays = await settingsService.getNumber(
    'sensitive_doc_retention_days',
    7,
  );
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sensitiveDocRetentionDays);

  const transactions = await complianceRepo.findCompletedTransactionsForDocPurge(cutoff);
  let purgedCount = 0;

  for (const tx of transactions) {
    const hasOtpFiles = tx.otp?.scannedCopyPathSeller || tx.otp?.scannedCopyPathReturned;
    const hasInvoice = tx.commissionInvoice?.invoiceFilePath;
    if (!hasOtpFiles && !hasInvoice) continue;

    const { filePaths } = await complianceRepo.purgeTransactionSensitiveDocs(tx.id, tx.sellerId);
    for (const filePath of filePaths) {
      try {
        await localStorage.delete(filePath);
      } catch {
        // Orphaned file — logged in audit below
      }
    }
    await auditService.log({
      action: 'compliance.sensitive_docs_purged',
      entityType: 'transaction',
      entityId: tx.id,
      details: { sellerId: tx.sellerId, filesDeleted: filePaths.length },
    });
    purgedCount++;
  }

  // Finding #2.6: Redact nricLast4 for any CDD records not yet processed (e.g. transactions
  // that had no OTP/invoice files and were skipped by the guard above).
  const cddForNricRedaction = await complianceRepo.findCddRecordsForNricRedaction(cutoff);
  if (cddForNricRedaction.length > 0) {
    await complianceRepo.redactNricFromCddRecordsBatch(cddForNricRedaction.map((c) => c.id));
  }

  return { purgedCount };
}

export async function confirmHuttonsSubmission(
  transactionId: string,
  agentId: string,
): Promise<{ purgedFiles: number }> {
  const tx = await txRepo.findById(transactionId);
  if (!tx) throw new NotFoundError('Transaction', transactionId);

  if (tx.status !== 'completed' && tx.status !== 'fallen_through') {
    throw new ValidationError('Transaction must be completed before confirming Huttons submission');
  }

  if (tx.seller?.agentId !== agentId) {
    throw new ForbiddenError('You do not own this transaction');
  }

  if ((tx as { huttonsSubmittedAt?: Date | null }).huttonsSubmittedAt) {
    throw new ConflictError('Huttons submission already confirmed for this transaction');
  }

  // Record the handoff
  await txRepo.confirmHuttonsHandoff(transactionId, agentId);

  // Immediate Tier 1 purge — same logic as the 7-day auto-purge
  const { filePaths } = await complianceRepo.purgeTransactionSensitiveDocs(
    transactionId,
    tx.sellerId,
  );
  for (const filePath of filePaths) {
    try {
      await localStorage.delete(filePath);
    } catch {
      // Orphaned file — logged in audit below
    }
  }

  await auditService.log({
    agentId,
    action: 'compliance.huttons_handoff_confirmed',
    entityType: 'transaction',
    entityId: transactionId,
    details: { sellerId: tx.sellerId, filesDeleted: filePaths.length },
  });

  return { purgedFiles: filePaths.length };
}

export async function scanRetention(): Promise<ScanRetentionResult> {
  const now = new Date();
  let flaggedCount = 0;
  let skippedCount = 0;

  // Load retention periods from SystemSetting (never hardcode)
  const [
    leadRetentionMonths,
    financialDataRetentionDays,
    transactionAnonymisationDays,
    consentPostWithdrawalRetentionYears,
    listingRetentionMonths,
  ] = await Promise.all([
    settingsService.getNumber('lead_retention_months', 12),
    settingsService.getNumber('financial_data_retention_days', 7),
    settingsService.getNumber('transaction_anonymisation_days', 30),
    settingsService.getNumber('consent_post_withdrawal_retention_years', 1),
    settingsService.getNumber('listing_retention_months', 6),
  ]);

  async function flagNewItems(
    targetType: string,
    items: {
      id: string;
      reason: string;
      retentionRule: string;
      details: Record<string, unknown>;
    }[],
  ) {
    if (items.length === 0) return;
    const existingIds = await complianceRepo.findExistingDeletionRequestIds(
      targetType,
      items.map((i) => i.id),
    );
    for (const item of items) {
      if (existingIds.has(item.id)) {
        skippedCount++;
        continue;
      }
      await complianceRepo.createDeletionRequest({
        targetType,
        targetId: item.id,
        reason: item.reason,
        retentionRule: item.retentionRule,
        status: 'flagged',
        details: item.details,
      });
      flaggedCount++;
    }
  }

  // 1. Leads inactive for configured months
  const leadCutoff = new Date(now);
  leadCutoff.setMonth(leadCutoff.getMonth() - leadRetentionMonths);
  const staleLeads = await complianceRepo.findLeadsForRetention(leadCutoff);
  await flagNewItems(
    'lead',
    staleLeads.map((lead) => ({
      id: lead.id,
      reason: 'Lead inactive for 12+ months',
      retentionRule: 'lead_12_month',
      details: { sellerName: lead.name, lastActivity: lead.updatedAt },
    })),
  );

  // 2. Service consent withdrawn 30+ days, no transactions
  const withdrawalCutoff = new Date(now);
  withdrawalCutoff.setDate(withdrawalCutoff.getDate() - 30);
  const withdrawnSellers = await complianceRepo.findServiceWithdrawnForDeletion(withdrawalCutoff);
  await flagNewItems(
    'lead',
    withdrawnSellers.map((seller) => ({
      id: seller.id,
      reason: 'Service consent withdrawn > 30 days ago',
      retentionRule: '30_day_grace',
      details: { sellerName: seller.name },
    })),
  );

  // 3. Tier 1: Auto-delete sensitive documents (NRIC, CDD docs, OTP scans, invoices)
  const { purgedCount: tier1Purged } = await purgeSensitiveDocs();
  flaggedCount += tier1Purged;

  // 4. Tier 2: Auto-redact financial data (offer amounts, agreed price, option fee)
  const financialCutoff = new Date(now);
  financialCutoff.setDate(financialCutoff.getDate() - financialDataRetentionDays);
  const txForFinancialRedaction =
    await complianceRepo.findCompletedTransactionsForFinancialRedaction(financialCutoff);
  for (const tx of txForFinancialRedaction) {
    await complianceRepo.redactTransactionFinancialData(tx.id);
    await auditService.log({
      action: 'compliance.financial_data_redacted',
      entityType: 'transaction',
      entityId: tx.id,
      details: { sellerId: tx.sellerId },
    });
    flaggedCount++;
  }

  // 5. Tier 3: Auto-anonymise seller PII (30 days post-completion)
  const anonymisationCutoff = new Date(now);
  anonymisationCutoff.setDate(anonymisationCutoff.getDate() - transactionAnonymisationDays);
  const txForAnonymisation =
    await complianceRepo.findCompletedTransactionsForAnonymisation(anonymisationCutoff);
  for (const tx of txForAnonymisation) {
    await complianceRepo.anonymiseTransactionSeller(tx.id, tx.sellerId);
    await complianceRepo.redactSellerNotifications(tx.sellerId);
    await auditService.log({
      action: 'compliance.seller_pii_anonymised',
      entityType: 'transaction',
      entityId: tx.id,
      details: { sellerId: tx.sellerId },
      actorType: 'system',
    });
    flaggedCount++;
  }

  // 6. Withdrawn consent records past configured retention period post-withdrawal
  const consentCutoff = new Date(now);
  consentCutoff.setFullYear(consentCutoff.getFullYear() - consentPostWithdrawalRetentionYears);
  const oldConsentRecords = await complianceRepo.findConsentRecordsForDeletion(consentCutoff);
  await flagNewItems(
    'consent_record',
    oldConsentRecords.map((record) => ({
      id: record.id,
      reason: 'Consent record > 1 year post-withdrawal',
      retentionRule: 'consent_1_year_post_withdrawal',
      details: { sellerId: record.sellerId, withdrawnAt: record.consentWithdrawnAt },
    })),
  );

  // 6. VerifiedViewers past retention period — anonymise PII fields in batch
  const expiredViewers = await complianceRepo.findVerifiedViewersForRetention(now);
  if (expiredViewers.length > 0) {
    await complianceRepo.anonymiseVerifiedViewerRecords(expiredViewers.map((v) => v.id));
    for (const viewer of expiredViewers) {
      await auditService.log({
        action: 'compliance.viewer_pii_anonymised',
        entityType: 'verified_viewer',
        entityId: viewer.id,
        details: { reason: 'retentionExpiresAt exceeded' },
      });
    }
    flaggedCount += expiredViewers.length;
  }

  // 7. Buyers past retention period — anonymise PII fields in batch
  const expiredBuyers = await complianceRepo.findBuyersForRetention(now);
  if (expiredBuyers.length > 0) {
    await complianceRepo.anonymiseBuyerRecords(expiredBuyers.map((b) => b.id));
    for (const buyer of expiredBuyers) {
      await auditService.log({
        action: 'compliance.buyer_pii_anonymised',
        entityType: 'buyer',
        entityId: buyer.id,
        details: { reason: 'retentionExpiresAt exceeded' },
      });
    }
    flaggedCount += expiredBuyers.length;
  }

  // 8. Closed listings past configured retention period (Finding #15)
  const listingCutoff = new Date(now);
  listingCutoff.setMonth(listingCutoff.getMonth() - listingRetentionMonths);
  const closedListings = await complianceRepo.findClosedListingsForRetention(listingCutoff);
  await flagNewItems(
    'listing',
    closedListings.map((listing) => {
      const photos = (listing.photos as { path?: string; optimizedPath?: string }[] | null) ?? [];
      const photoPaths: string[] = [];
      for (const photo of photos) {
        if (photo.path) photoPaths.push(photo.path);
        if (photo.optimizedPath) photoPaths.push(photo.optimizedPath);
      }
      return {
        id: listing.id,
        reason: `Listing closed > ${listingRetentionMonths} months ago`,
        retentionRule: 'listing_closed',
        details: { propertyId: listing.propertyId, photoPaths },
      };
    }),
  );

  // 9. ViewingSlots: delete 30 days after slot date once property has a closed listing (Finding #16)
  // Direct delete — operational scheduling data, no agent review required
  const viewingSlotCutoff = new Date(now);
  viewingSlotCutoff.setDate(viewingSlotCutoff.getDate() - 30);
  const oldSlots = await complianceRepo.findOldViewingSlotsForClosedProperties(viewingSlotCutoff);
  if (oldSlots.length > 0) {
    const slotIds = oldSlots.map((s) => s.id);
    const deletedSlots = await complianceRepo.deleteOldViewingSlotsWithViewings(slotIds);
    await auditService.log({
      action: 'compliance.viewing_slots_deleted',
      entityType: 'viewing_slot',
      entityId: 'batch',
      details: { count: deletedSlots, cutoffDate: viewingSlotCutoff },
    });
    flaggedCount += deletedSlots;
  }

  // 10. WeeklyUpdates: delete 6 months after creation (Finding #16)
  // Direct delete — AI-generated market narratives, not core personal data requiring agent review
  const weeklyUpdateCutoff = new Date(now);
  weeklyUpdateCutoff.setMonth(weeklyUpdateCutoff.getMonth() - 6);
  const oldWeeklyUpdates = await complianceRepo.findOldWeeklyUpdates(weeklyUpdateCutoff);
  if (oldWeeklyUpdates.length > 0) {
    const updateIds = oldWeeklyUpdates.map((u) => u.id);
    const deletedUpdates = await complianceRepo.deleteOldWeeklyUpdates(updateIds);
    await auditService.log({
      action: 'compliance.weekly_updates_deleted',
      entityType: 'weekly_update',
      entityId: 'batch',
      details: { count: deletedUpdates, cutoffDate: weeklyUpdateCutoff },
    });
    flaggedCount += deletedUpdates;
  }

  // ── Tables explicitly excluded from automated retention ───────────────────
  // AuditLog: append-only, 2-year policy enforced at the DB/infra level (CLAUDE.md)
  // Notification: operational delivery log, no standalone PII — deleted via seller cascade
  // Testimonial: public marketing content — deleted via seller hard delete cascade
  // DataDeletionRequest / DataCorrectionRequest: compliance records — never auto-deleted
  // HdbTransaction / HdbDataSync / MarketContent: public/derived data, no personal data
  // AgentSetting / SystemSetting: config data — no personal data
  // ─────────────────────────────────────────────────────────────────────────

  // 11. Stale data correction requests — alert agent (not deletion)
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

  // 12. Inactive agents — anonymise PII after configured years of inactivity (Finding #4)
  // Inactivity = isActive:false AND no logins/seller-activity/HDB-submissions in retention period.
  // Anonymisation keeps the record for referential integrity (replaces name/email/phone).
  const agentRetentionYears = await settingsService.getNumber('agent_retention_years', 2);
  const agentCutoff = new Date(now);
  agentCutoff.setFullYear(agentCutoff.getFullYear() - agentRetentionYears);
  const inactiveAgents = await complianceRepo.findInactiveAgentsForRetention(agentCutoff);
  for (const agent of inactiveAgents) {
    await complianceRepo.anonymiseAgentRecord(agent.id);
    await auditService.log({
      action: 'compliance.agent_pii_anonymised',
      entityType: 'agent',
      entityId: agent.id,
      details: { reason: 'agent_inactive_2_years' },
    });
    flaggedCount++;
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

    case 'listing': {
      const listingDetails = details as { photoPaths?: string[] } | null;
      const photoPaths = listingDetails?.photoPaths ?? [];
      for (const filePath of photoPaths) {
        try {
          await localStorage.delete(filePath);
        } catch (err) {
          await auditService.log({
            action: 'compliance.file_unlink_failed',
            entityType: 'listing',
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
      await complianceRepo.hardDeleteListing(request.targetId);
      break;
    }

    case 'nric_data':
      await complianceRepo.redactNricFromCddRecord(request.targetId);
      break;

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

// ─── Pending Document Downloads (dashboard reminder) ────────────────────────

export interface PendingDownload {
  transactionId: string;
  propertyAddress: string;
  docTypes: string[];
  daysRemaining: number;
}

export async function getPendingDocumentDownloads(agentId?: string): Promise<PendingDownload[]> {
  const sensitiveDocDays = await settingsService.getNumber('sensitive_doc_retention_days', 7);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - sensitiveDocDays);

  const transactions = await complianceRepo.findPendingDocumentDownloads(cutoffDate, agentId);
  const now = new Date();

  return transactions.map((tx) => {
    const docTypes: string[] = [];
    if (tx.otp?.scannedCopyPathSeller || tx.otp?.scannedCopyPathReturned) {
      docTypes.push('OTP scanned copy');
    }
    if (tx.commissionInvoice?.invoiceFilePath) {
      docTypes.push('Commission invoice');
    }

    const completionDate = tx.completionDate as Date;
    const deleteDate = new Date(completionDate);
    deleteDate.setDate(deleteDate.getDate() + sensitiveDocDays);
    const daysRemaining = Math.max(0, Math.ceil((deleteDate.getTime() - now.getTime()) / 86400000));

    const addr = tx.property;
    const propertyAddress = `${addr.block} ${addr.street}, ${addr.town}`;

    return {
      transactionId: tx.id,
      propertyAddress,
      docTypes,
      daysRemaining,
    };
  });
}

// ─── CDD Record Management ────────────────────────────────────────────────────

export async function createCddRecord(
  input: CreateCddRecordInput,
  agentId: string,
): Promise<CddRecord> {
  const record = await complianceRepo.createCddRecord(input);
  await auditService.log({
    agentId,
    action: 'compliance.cdd_record_created',
    entityType: 'cdd_record',
    entityId: record.id,
    details: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  });

  // A4: Audit identity verification and risk assessment if set on creation
  if (record.identityVerified) {
    await auditService.log({
      agentId,
      action: 'cdd.identity_verified',
      entityType: 'cdd_record',
      entityId: record.id,
      details: { subjectType: input.subjectType, subjectId: input.subjectId },
    });
  }
  if (input.riskLevel) {
    await auditService.log({
      agentId,
      action: 'cdd.risk_assessed',
      entityType: 'cdd_record',
      entityId: record.id,
      details: { riskLevel: input.riskLevel },
    });
  }

  return record;
}

export async function updateCddStatus(
  sellerId: string,
  status: 'not_started' | 'pending' | 'verified',
  agentId: string,
  isAdmin = false,
): Promise<void> {
  // Agents cannot set verified directly — must use verifyCdd (modal flow)
  if (status === 'verified' && !isAdmin) {
    throw new ForbiddenError('Agents must use the verification modal to set CDD to Verified');
  }

  // If record is locked, only admins can change it
  if (!isAdmin) {
    const existing = await complianceRepo.findSellerCddRecord(sellerId);
    if (existing?.identityVerified) {
      throw new ForbiddenError('CDD is locked. Contact an admin to revert.');
    }
  }

  if (status === 'not_started') {
    await complianceRepo.deleteCddRecord(sellerId);
    await auditService.log({
      agentId,
      action: 'cdd.record_deleted',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
    return;
  }

  await complianceRepo.upsertCddStatus(sellerId, agentId, status);

  if (status === 'verified') {
    await auditService.log({
      agentId,
      action: 'cdd.identity_verified',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
  } else {
    await auditService.log({
      agentId,
      action: 'cdd.status_set_pending',
      entityType: 'seller',
      entityId: sellerId,
      details: { sellerId },
    });
  }
}

export async function verifyCdd(sellerId: string, agentId: string, phrase: string): Promise<void> {
  if (phrase !== 'I confirm') {
    throw new ValidationError('Invalid confirmation phrase');
  }

  const existing = await complianceRepo.findSellerCddRecord(sellerId);
  if (existing?.identityVerified) {
    throw new ConflictError('CDD is already verified and locked');
  }

  await complianceRepo.upsertCddStatus(sellerId, agentId, 'verified');

  await auditService.log({
    agentId,
    action: 'cdd.identity_verified',
    entityType: 'seller',
    entityId: sellerId,
    details: { sellerId },
  });
}

export async function refreshCddRetentionOnCompletion(
  transactionId: string,
  sellerId: string,
): Promise<void> {
  await complianceRepo.refreshCddRetentionOnCompletion(transactionId, sellerId);
  await auditService.log({
    action: 'compliance.cdd_retention_refreshed',
    entityType: 'transaction',
    entityId: transactionId,
    details: { sellerId },
  });
}

// ─── EAA Management ──────────────────────────────────────────────────────────

const VALID_EAA_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent_to_seller'],
  sent_to_seller: ['signed'],
  signed: ['active'],
};

export async function createEaa(input: CreateEaaInput, agentId: string): Promise<EaaRecord> {
  const cdd = await complianceRepo.findLatestSellerCddRecord(input.sellerId);
  if (!cdd || !cdd.identityVerified) {
    throw new ComplianceError('CDD must be verified before creating an EAA');
  }

  const record = await complianceRepo.createEaa(input);
  await auditService.log({
    agentId,
    action: 'compliance.eaa_created',
    entityType: 'estate_agency_agreement',
    entityId: record.id,
    details: {
      sellerId: input.sellerId,
      agreementType: input.agreementType ?? 'non_exclusive',
    },
  });
  return record;
}

export async function updateEaaStatus(
  eaaId: string,
  status: string,
  agentId: string,
): Promise<EaaRecord> {
  const eaa = await complianceRepo.findEaaById(eaaId);
  if (!eaa) throw new NotFoundError('EstateAgencyAgreement', eaaId);

  const allowed = VALID_EAA_STATUS_TRANSITIONS[eaa.status];
  if (!allowed || !allowed.includes(status)) {
    throw new ComplianceError(`Cannot transition EAA from "${eaa.status}" to "${status}"`);
  }

  const signedAt = status === 'signed' ? new Date() : undefined;
  const record = await complianceRepo.updateEaaStatus(eaaId, status, signedAt);
  await auditService.log({
    agentId,
    action: 'compliance.eaa_status_updated',
    entityType: 'estate_agency_agreement',
    entityId: eaaId,
    details: { previousStatus: eaa.status, newStatus: status },
  });

  if (status === 'active') {
    await sellerService.updateSellerStatus(eaa.sellerId, 'active', agentId);
  }

  return record;
}

export async function confirmEaaExplanation(input: ConfirmEaaExplanationInput): Promise<EaaRecord> {
  const eaa = await complianceRepo.findEaaById(input.eaaId);
  if (!eaa) throw new NotFoundError('EstateAgencyAgreement', input.eaaId);

  if (eaa.videoCallConfirmedAt) {
    throw new ComplianceError('EAA explanation has already been confirmed');
  }

  const record = await complianceRepo.updateEaaExplanation(input);
  await auditService.log({
    agentId: input.agentId,
    action: 'compliance.eaa_explanation_confirmed',
    entityType: 'estate_agency_agreement',
    entityId: input.eaaId,
    details: { method: input.method, notes: input.notes },
  });
  return record;
}

export async function findEaaById(eaaId: string): Promise<EaaRecord | null> {
  return complianceRepo.findEaaById(eaaId);
}

export async function findEaaBySellerId(sellerId: string): Promise<EaaRecord | null> {
  return complianceRepo.findEaaBySellerId(sellerId);
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

export async function getCddRecordsByTransaction(transactionId: string) {
  return complianceRepo.findCddRecordsByTransaction(transactionId);
}

// ─── Viewer Consent Record ────────────────────────────────────────────────────

export async function createViewerConsentRecord(data: {
  viewerId: string;
  subjectId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return complianceRepo.createViewerConsentRecord(data);
}

// ─── Service wrappers for cross-domain callers (no direct repo access) ─────────

export function findLatestSellerCddRecord(sellerId: string) {
  return complianceRepo.findLatestSellerCddRecord(sellerId);
}

export function findCddRecordByTransactionAndSubjectType(
  transactionId: string,
  subjectType: string,
) {
  return complianceRepo.findCddRecordByTransactionAndSubjectType(transactionId, subjectType);
}

// ─── CDD Document Upload ──────────────────────────────────────────────────────

const MAX_CDD_DOCUMENTS = 5;

function assertCddOwnership(verifiedByAgentId: string, agentId: string, isAdmin: boolean): void {
  if (!isAdmin && verifiedByAgentId !== agentId) {
    throw new ForbiddenError('You are not authorised to access this CDD record');
  }
}

export async function uploadCddDocument(input: UploadCddDocumentInput): Promise<CddDocument> {
  const record = await complianceRepo.findCddRecordById(input.cddRecordId);
  if (!record) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(record.verifiedByAgentId, input.agentId, input.isAdmin);

  const existing = (record.documents as CddDocument[]) ?? [];
  if (existing.length >= MAX_CDD_DOCUMENTS) {
    throw new ValidationError(`Maximum ${MAX_CDD_DOCUMENTS} documents per CDD record`);
  }

  // Verify actual file content (magic bytes) before virus scan
  const detectedCdd = await fileTypeFromBuffer(input.fileBuffer);
  const allowedCddMimes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!detectedCdd || !allowedCddMimes.includes(detectedCdd.mime)) {
    throw new ValidationError('File content does not match a valid image or PDF');
  }

  // Virus scan — fail-closed in production
  const scan = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!scan.isClean) {
    await auditService.log({
      agentId: input.agentId,
      action: 'cdd.document_scan_rejected',
      entityType: 'cdd_record',
      entityId: input.cddRecordId,
      details: { filename: input.originalFilename, viruses: scan.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  // Encrypt + save — UUID filename prevents enumeration
  const docId = createId();
  const ext = path.extname(input.originalFilename).toLowerCase() || '.bin';
  const filePath = `cdd/${input.cddRecordId}/${input.docType}-${docId}${ext}.enc`;

  const { path: savedPath, wrappedKey } = await encryptedStorage.save(filePath, input.fileBuffer);

  const doc: CddDocument = {
    id: docId,
    docType: input.docType,
    label: input.label ?? null,
    path: savedPath,
    wrappedKey,
    mimeType: input.mimeType,
    sizeBytes: input.fileBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedByAgentId: input.agentId,
  };

  await complianceRepo.addCddDocument(input.cddRecordId, doc);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_uploaded',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { docType: input.docType, sizeBytes: input.fileBuffer.length },
  });

  return doc;
}

// ─── CDD Document Download ────────────────────────────────────────────────────

export async function downloadCddDocument(
  input: DownloadCddDocumentInput,
): Promise<{ buffer: Buffer; mimeType: string; docType: CddDocumentType; filePath: string }> {
  const result = await complianceRepo.findCddRecordWithDocument(
    input.cddRecordId,
    input.documentId,
  );
  if (!result) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(result.verifiedByAgentId, input.agentId, input.isAdmin);

  const doc = result.document;
  if (!doc) throw new NotFoundError('CddDocument', input.documentId);

  const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_downloaded',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { documentId: input.documentId, docType: doc.docType },
  });

  return { buffer, mimeType: doc.mimeType, docType: doc.docType, filePath: doc.path };
}

// ─── AML/CFT Reg 12H: Tipping-Off Suppression ───────────────────────────────

export async function isSensitiveCaseSeller(sellerId: string): Promise<boolean> {
  return complianceRepo.findSensitiveCaseBySellerId(sellerId);
}

// ─── CDD Document Delete ──────────────────────────────────────────────────────

export async function deleteCddDocument(input: DeleteCddDocumentInput): Promise<void> {
  const result = await complianceRepo.findCddRecordWithDocument(
    input.cddRecordId,
    input.documentId,
  );
  if (!result) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(result.verifiedByAgentId, input.agentId, input.isAdmin);

  const doc = result.document;
  if (!doc) throw new NotFoundError('CddDocument', input.documentId);

  // Path traversal guard before deletion
  const uploadsRoot = path.resolve(process.env['UPLOADS_DIR'] ?? 'uploads');
  const resolved = path.resolve(uploadsRoot, doc.path);
  if (!resolved.startsWith(uploadsRoot + path.sep)) {
    throw new ForbiddenError('File path is outside the allowed uploads directory');
  }

  // Hard delete: remove file first, then clear from DB
  await encryptedStorage.delete(doc.path);
  await complianceRepo.removeCddDocument(input.cddRecordId, input.documentId);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_deleted',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { documentId: input.documentId, docType: doc.docType },
  });
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

// ─── Huttons Transfer Consent ─────────────────────────────────────────────────

export async function recordHuttonsTransferConsent(sellerId: string): Promise<void> {
  const existing = await complianceRepo.findSellerConsent(sellerId);
  await complianceRepo.createConsentRecord({
    subjectId: sellerId,
    purposeService: existing?.consentService ?? true,
    purposeMarketing: existing?.consentMarketing ?? false,
    purposeHuttonsTransfer: true,
  });
}
