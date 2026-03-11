// src/domains/transaction/transaction.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as txRepo from './transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import { localStorage } from '@/infra/storage/local-storage';
import { NotFoundError, ValidationError, ConflictError } from '@/domains/shared/errors';
import { OTP_TRANSITIONS, TRANSACTION_STATUS_ORDER } from './transaction.types';
import type {
  CreateTransactionInput,
  CreateOtpInput,
  AdvanceOtpInput,
  UploadOtpScanInput,
  UploadInvoiceInput,
} from './transaction.types';
import path from 'path';

// ── Transaction ────────────────────────────────────────────────────────────────

export async function createTransaction(input: CreateTransactionInput) {
  const tx = await txRepo.createTransaction({
    id: createId(),
    propertyId: input.propertyId,
    sellerId: input.sellerId,
    agreedPrice: input.agreedPrice,
    optionFee: input.optionFee ?? null,
    optionDate: input.optionDate ?? null,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.created',
    entityType: 'transaction',
    entityId: tx.id,
    details: { propertyId: input.propertyId, agreedPrice: input.agreedPrice },
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
  status: 'option_exercised' | 'completing' | 'completed' | 'fallen_through';
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  // Guard: terminal states cannot be transitioned
  if (tx.status === 'completed' || tx.status === 'fallen_through') {
    throw new ValidationError(`Transaction status '${tx.status}' is terminal — cannot advance further`);
  }

  // Guard: forward-only transitions (fallen_through is always allowed)
  if (input.status !== 'fallen_through') {
    const currentIdx = TRANSACTION_STATUS_ORDER.indexOf(tx.status as (typeof TRANSACTION_STATUS_ORDER)[number]);
    const requestedIdx = TRANSACTION_STATUS_ORDER.indexOf(input.status as (typeof TRANSACTION_STATUS_ORDER)[number]);
    if (currentIdx >= 0 && requestedIdx >= 0 && requestedIdx <= currentIdx) {
      throw new ValidationError(`Cannot transition from '${tx.status}' to '${input.status}' — must advance forward`);
    }
  }

  const completionDate = input.status === 'completed' ? new Date() : null;

  const updated = await txRepo.updateTransactionStatus(
    input.transactionId,
    input.status,
    completionDate !== null ? completionDate : undefined,
  );

  if (input.status === 'fallen_through') {
    await handleFallenThrough(tx.propertyId, input.transactionId, input.agentId);
  }

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
  // Expire active OTP and portal listings; revert property + listing to draft
  const otp = await txRepo.findOtpByTransactionId(transactionId);
  if (otp && otp.status !== 'exercised' && otp.status !== 'expired') {
    await txRepo.updateOtpStatus(otp.id, 'expired', { expiredAt: new Date() });
  }

  await portalService.expirePortalListings(propertyId);

  // Alert agent to manually delist from live portals
  await notificationService.send(
    {
      recipientType: 'agent',
      recipientId: agentId,
      templateName: 'transaction_update',
      templateData: {
        address: propertyId,
        status: 'fallen_through — please delist manually from live portals',
      },
    },
    agentId,
  );
}

export async function updateHdbTracking(input: {
  transactionId: string;
  hdbApplicationStatus?: string;
  hdbAppointmentDate?: Date | null;
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const updated = await txRepo.updateHdbTracking(input.transactionId, {
    hdbApplicationStatus: input.hdbApplicationStatus,
    hdbAppointmentDate: input.hdbAppointmentDate,
  });

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

export async function markOtpReviewed(input: { transactionId: string; notes?: string; agentId: string }) {
  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  const updated = await txRepo.updateOtpReview(otp.id, new Date(), input.notes);

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.reviewed',
    entityType: 'otp',
    entityId: otp.id,
    details: {},
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
  if (input.fileBuffer.length > 10 * 1024 * 1024) throw new ValidationError('File must be 10MB or smaller');

  const storedFilename = `invoice-${createId()}.pdf`;
  const storedPath = await localStorage.save(
    `invoices/${input.transactionId}/${storedFilename}`,
    input.fileBuffer,
  );

  // Always read amounts from SystemSetting — never rely on schema defaults
  const commissionAmount = await settingsService.getNumber('commission_amount', 1499);
  const gstRate = await settingsService.getNumber('gst_rate', 0.09);
  const gstAmount = Math.round(commissionAmount * gstRate * 100) / 100;
  const totalAmount = commissionAmount + gstAmount;

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

export async function sendInvoice(input: { transactionId: string; sellerId: string; agentId: string }) {
  const invoice = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (!invoice) throw new NotFoundError('CommissionInvoice', input.transactionId);

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: input.sellerId,
      templateName: 'invoice_uploaded',
      templateData: { address: input.transactionId },
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
