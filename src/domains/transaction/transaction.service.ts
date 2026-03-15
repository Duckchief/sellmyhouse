// src/domains/transaction/transaction.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as txRepo from './transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import * as propertyService from '@/domains/property/property.service';
import * as viewingService from '@/domains/viewing/viewing.service';
import { localStorage } from '@/infra/storage/local-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  ComplianceError,
} from '@/domains/shared/errors';
import { OTP_TRANSITIONS, TRANSACTION_STATUS_ORDER } from './transaction.types';
import * as offerService from '@/domains/offer/offer.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import { checkComplianceGate } from '@/domains/review/review.service';
import type {
  CreateTransactionInput,
  CreateOtpInput,
  AdvanceOtpInput,
  UploadOtpScanInput,
  UploadInvoiceInput,
  HdbApplicationStatus,
} from './transaction.types';
import path from 'path';

// ── Cross-domain lookups (used by review.service for compliance gates) ────────

export async function findTransactionById(transactionId: string) {
  return txRepo.findById(transactionId);
}

export async function findTransactionBySellerId(sellerId: string) {
  return txRepo.findTransactionBySellerId(sellerId);
}

export async function findOtpByTransactionId(transactionId: string) {
  return txRepo.findOtpByTransactionId(transactionId);
}

// ── Transaction ────────────────────────────────────────────────────────────────

export async function createTransaction(input: CreateTransactionInput) {
  // H4: Verify the linked offer exists and is accepted
  const offer = await offerService.findOffer(input.offerId);
  if (!offer || offer.status !== 'accepted') {
    throw new ValidationError('Transaction must be linked to an accepted offer');
  }
  if (offer.propertyId !== input.propertyId) {
    throw new ValidationError('Offer propertyId does not match transaction propertyId');
  }

  // H5: Look up seller CDD record for audit trail
  const sellerCdd = await complianceService.findLatestSellerCddRecord(input.sellerId);

  const tx = await txRepo.createTransaction({
    id: createId(),
    propertyId: input.propertyId,
    sellerId: input.sellerId,
    offerId: input.offerId,
    sellerCddRecordId: sellerCdd?.id ?? null,
    counterpartyCddRecordId: null, // set when counterparty CDD is completed post-acceptance
    agreedPrice: input.agreedPrice,
    optionFee: input.optionFee ?? null,
    optionDate: input.optionDate ?? null,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.created',
    entityType: 'transaction',
    entityId: tx.id,
    details: {
      propertyId: input.propertyId,
      agreedPrice: input.agreedPrice,
      offerId: input.offerId,
      sellerCddRecordId: sellerCdd?.id ?? null,
    },
  });

  return tx;
}

export async function getTransaction(transactionId: string) {
  const tx = await txRepo.findById(transactionId);
  if (!tx) throw new NotFoundError('Transaction', transactionId);
  return tx;
}

export async function advanceTransactionStatus(input: {
  transactionId: string;
  status: 'option_exercised' | 'completing' | 'completed';
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  // Guard: terminal states cannot be transitioned
  if (tx.status === 'completed' || tx.status === 'fallen_through') {
    throw new ValidationError(
      `Transaction status '${tx.status}' is terminal — cannot advance further`,
    );
  }

  // Guard: forward-only transitions
  const currentIdx = TRANSACTION_STATUS_ORDER.indexOf(
    tx.status as (typeof TRANSACTION_STATUS_ORDER)[number],
  );
  const requestedIdx = TRANSACTION_STATUS_ORDER.indexOf(
    input.status as (typeof TRANSACTION_STATUS_ORDER)[number],
  );
  if (currentIdx >= 0 && requestedIdx >= 0 && requestedIdx <= currentIdx) {
    throw new ValidationError(
      `Cannot transition from '${tx.status}' to '${input.status}' — must advance forward`,
    );
  }

  // H3: Gate 3 — counterparty CDD must be complete before any status advance
  // Passes transaction.id as entityId; checkComplianceGate uses it as the CDD subject lookup key
  await checkComplianceGate('counterparty_cdd', tx.id);

  // Gate 5: HDB approval required before marking completed
  if (input.status === 'completed') {
    await checkComplianceGate('hdb_complete', tx.id);
    // Refresh CDD retention to ensure 5-year minimum from actual completion (AML/CFT)
    await complianceService.refreshCddRetentionOnCompletion(tx.id, tx.sellerId);
  }

  const completionDate = input.status === 'completed' ? new Date() : null;

  const updated = await txRepo.updateTransactionStatus(
    input.transactionId,
    input.status,
    completionDate !== null ? completionDate : undefined,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.status_changed',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { newStatus: input.status },
  });

  return updated;
}

async function handleFallenThrough(propertyId: string, transactionId: string, agentId: string) {
  // Note: COS 2020 Condition 16 — In the event of a conveyancing dispute
  // governed by COS 2020, parties should consider settling the dispute
  // amicably through mediation before commencing legal proceedings.
  // The agent should inform both parties of this option if a dispute arises.

  // 1. Expire active OTP
  const otp = await txRepo.findOtpByTransactionId(transactionId);
  if (otp && otp.status !== 'exercised' && otp.status !== 'expired') {
    await txRepo.updateOtpStatus(otp.id, 'expired', { expiredAt: new Date() });
  }

  // 2. Expire portal listings
  await portalService.expirePortalListings(propertyId);

  // 3. Cancel all active viewing slots and notify booked viewers
  await viewingService.cancelSlotsForPropertyCascade(propertyId, agentId);

  // 4. Revert property and listing back to draft
  await propertyService.revertPropertyToDraft(propertyId);

  // 5. Alert agent to manually delist from live portals
  const property = await propertyService.getPropertyById(propertyId);
  const address = property ? `${property.block} ${property.street}, ${property.town}` : propertyId;
  await notificationService.send(
    {
      recipientType: 'agent',
      recipientId: agentId,
      templateName: 'transaction_update',
      templateData: {
        address,
        status: 'fallen_through — please delist manually from live portals',
      },
    },
    agentId,
  );
}

export async function markFallenThrough(input: {
  transactionId: string;
  sellerId: string;
  reason: string;
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  if (tx.status === 'completed' || tx.status === 'fallen_through') {
    throw new ValidationError(
      `Transaction status '${tx.status}' is terminal — cannot mark as fallen through`,
    );
  }

  const updated = await txRepo.updateFallenThrough(input.transactionId, input.reason);

  await handleFallenThrough(tx.propertyId, input.transactionId, input.agentId);

  const sellerProperty = await propertyService.getPropertyById(tx.propertyId);
  const sellerAddress = sellerProperty
    ? `${sellerProperty.block} ${sellerProperty.street}, ${sellerProperty.town}`
    : tx.propertyId;
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: input.sellerId,
      templateName: 'transaction_update',
      templateData: {
        address: sellerAddress,
        status: `fallen through: ${input.reason}`,
      },
    },
    input.agentId,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.fallen_through',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { reason: input.reason, sellerId: input.sellerId },
  });

  return updated;
}

export async function updateHdbTracking(input: {
  transactionId: string;
  hdbApplicationStatus?: HdbApplicationStatus;
  hdbAppointmentDate?: Date | null;
  hdbAppSubmittedAt?: Date | null;
  hdbAppSubmittedByAgentId?: string | null;
  hdbAppApprovedAt?: Date | null;
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  // Gate: HDB submission review — verify OTP is exercised before submission
  if (input.hdbApplicationStatus === 'application_submitted') {
    await checkComplianceGate('hdb_submission_review', tx.sellerId);
  }

  const updated = await txRepo.updateHdbTracking(input.transactionId, {
    hdbApplicationStatus: input.hdbApplicationStatus,
    hdbAppointmentDate: input.hdbAppointmentDate,
    hdbAppSubmittedAt: input.hdbAppSubmittedAt,
    hdbAppSubmittedByAgentId: input.hdbAppSubmittedByAgentId,
    hdbAppApprovedAt: input.hdbAppApprovedAt,
  });

  if (input.hdbApplicationStatus) {
    const property = await propertyService.getPropertyById(tx.propertyId);
    const address = property
      ? `${property.block} ${property.street}, ${property.town}`
      : tx.propertyId;
    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: tx.sellerId,
        templateName: 'transaction_update',
        templateData: {
          address,
          status: `HDB application status updated to: ${input.hdbApplicationStatus}`,
        },
      },
      input.agentId,
    );
  }

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.hdb_updated',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { hdbApplicationStatus: input.hdbApplicationStatus },
  });

  return updated;
}

// ── OTP ────────────────────────────────────────────────────────────────────────

export async function createOtp(input: CreateOtpInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const existing = await txRepo.findOtpByTransactionId(input.transactionId);
  if (existing) throw new ConflictError('OTP already exists for this transaction');

  const otp = await txRepo.createOtp({
    id: createId(),
    transactionId: input.transactionId,
    hdbSerialNumber: input.hdbSerialNumber,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.created',
    entityType: 'otp',
    entityId: otp.id,
    details: { transactionId: input.transactionId },
  });

  return otp;
}

export async function advanceOtp(input: AdvanceOtpInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  const nextStatus = OTP_TRANSITIONS[otp.status];
  if (!nextStatus) {
    throw new ValidationError(`OTP status '${otp.status}' is terminal — cannot advance further`);
  }

  // Gate: issued_to_buyer requires agent review first
  if (nextStatus === 'issued_to_buyer' && !otp.agentReviewedAt) {
    throw new ValidationError('Agent must review OTP before issuing to buyer');
  }

  // Gate: counterparty CDD required for unrepresented buyers (AML/CFT Reg 12B)
  if (nextStatus === 'issued_to_buyer') {
    const acceptedOffer = await txRepo.findAcceptedOfferByPropertyId(tx.propertyId);
    if (acceptedOffer && !acceptedOffer.buyerAgentName) {
      const buyerCdd = await txRepo.findCounterpartyCddByPropertyId(tx.propertyId);
      if (!buyerCdd) {
        throw new ComplianceError(
          'Counterparty CDD must be completed and verified for unrepresented buyers before OTP can be issued to buyer (AML/CFT Reg 12B)',
        );
      }
    }
  }

  const issuedAt = nextStatus === 'issued_to_buyer' ? (input.issuedAt ?? new Date()) : undefined;
  const exercisedAt = nextStatus === 'exercised' ? new Date() : undefined;

  const updated = await txRepo.updateOtpStatus(otp.id, nextStatus, { issuedAt, exercisedAt });

  // Set exercise deadline on transaction when OTP issued to buyer
  if (nextStatus === 'issued_to_buyer' && issuedAt) {
    const exerciseDays = await settingsService.getNumber('otp_exercise_days', 21);
    const deadline = new Date(issuedAt);
    deadline.setDate(deadline.getDate() + exerciseDays);
    await txRepo.updateExerciseDeadline(input.transactionId, deadline);
  }

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.advanced',
    entityType: 'otp',
    entityId: otp.id,
    details: { from: otp.status, to: nextStatus, notes: input.notes },
  });

  return updated;
}

export async function markOtpReviewed(input: {
  transactionId: string;
  notes?: string;
  agentId: string;
}) {
  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  // Gate 4: video call must be confirmed on the linked EAA before agent OTP review
  const eaa = await txRepo.findEaaByTransactionId(input.transactionId);
  if (!eaa?.videoCallConfirmedAt) {
    throw new ValidationError('Video call with seller must be confirmed before reviewing OTP');
  }

  const updated = await txRepo.updateOtpReview(otp.id, new Date(), input.agentId, input.notes);

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.reviewed',
    entityType: 'otp',
    entityId: otp.id,
    details: {
      // PG 1-2021: Agent must advise seller to seek independent legal advice
      legalAdviceReminder:
        'Agent confirms seller was advised to seek independent legal advice before signing',
    },
  });

  return updated;
}

export async function uploadOtpScan(input: UploadOtpScanInput) {
  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  // Validate: only pdf/jpg/jpeg/png, max 10MB
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
    throw new ValidationError('File must be PDF, JPG, JPEG, or PNG');
  }
  if (input.fileBuffer.length > 10 * 1024 * 1024) {
    throw new ValidationError('File must be 10MB or smaller');
  }

  // Virus scan before saving
  const scanResult = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!scanResult.isClean) {
    await auditService.log({
      action: 'upload.virus_detected',
      entityType: 'otp',
      entityId: otp.id,
      details: { filename: input.originalFilename, viruses: scanResult.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  // Use UUID-based filename to prevent path traversal — never use originalFilename as stored name
  const storedFilename = `${input.scanType}-${createId()}${ext}`;
  const storedPath = await localStorage.save(
    `otp/${input.transactionId}/${storedFilename}`,
    input.fileBuffer,
  );

  const updated = await txRepo.updateOtpScanPath(otp.id, input.scanType, storedPath);

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.scan_uploaded',
    entityType: 'otp',
    entityId: otp.id,
    details: { scanType: input.scanType },
  });

  return updated;
}

// ── Commission Invoice ─────────────────────────────────────────────────────────

export async function uploadInvoice(input: UploadInvoiceInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const existing = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (existing) throw new ConflictError('Invoice already exists for this transaction');

  // Validate: only pdf, max 10MB
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (ext !== '.pdf') throw new ValidationError('Invoice must be a PDF file');
  if (input.fileBuffer.length > 10 * 1024 * 1024)
    throw new ValidationError('File must be 10MB or smaller');

  // Virus scan before saving
  const invoiceScanResult = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!invoiceScanResult.isClean) {
    await auditService.log({
      action: 'upload.virus_detected',
      entityType: 'commission_invoice',
      entityId: input.transactionId,
      details: { filename: input.originalFilename, viruses: invoiceScanResult.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  const storedFilename = `invoice-${createId()}.pdf`;
  const storedPath = await localStorage.save(
    `invoices/${input.transactionId}/${storedFilename}`,
    input.fileBuffer,
  );

  // Always read amounts from SystemSetting — never rely on schema defaults.
  // Throws AppError('Setting not found: ...') if keys are missing.
  const {
    amount: commissionAmount,
    gstAmount,
    total: totalAmount,
  } = await settingsService.getCommission();

  const invoice = await txRepo.createCommissionInvoice({
    transactionId: input.transactionId,
    invoiceFilePath: storedPath,
    invoiceNumber: input.invoiceNumber,
    amount: commissionAmount,
    gstAmount,
    totalAmount,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.uploaded',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { invoiceNumber: input.invoiceNumber },
  });

  return invoice;
}

export async function sendInvoice(input: {
  transactionId: string;
  sellerId: string;
  agentId: string;
}) {
  const invoice = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (!invoice) throw new NotFoundError('CommissionInvoice', input.transactionId);

  // N6: Fetch actual property address instead of using transactionId
  const invoiceTx = await txRepo.findById(input.transactionId);
  const invoiceProperty = invoiceTx
    ? await propertyService.getPropertyById(invoiceTx.propertyId)
    : null;
  const invoiceAddress = invoiceProperty
    ? `${invoiceProperty.block} ${invoiceProperty.street}, ${invoiceProperty.town}`
    : 'your property';

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: input.sellerId,
      templateName: 'invoice_uploaded',
      templateData: { address: invoiceAddress },
    },
    input.agentId,
  );

  const updated = await txRepo.updateInvoiceStatus(invoice.id, 'sent_to_client', {
    sentAt: new Date(),
    sentVia: 'notification',
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.sent',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: {},
  });

  return updated;
}

export async function markInvoicePaid(input: { transactionId: string; agentId: string }) {
  const invoice = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (!invoice) throw new NotFoundError('CommissionInvoice', input.transactionId);

  const updated = await txRepo.updateInvoiceStatus(invoice.id, 'paid', { paidAt: new Date() });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.paid',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: {},
  });

  return updated;
}
