// src/domains/transaction/transaction.repository.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { TransactionStatus, OtpStatus, HdbApplicationStatus } from '@prisma/client';

interface CreateTransactionData {
  id?: string;
  propertyId: string;
  sellerId: string;
  offerId?: string | null;
  sellerCddRecordId?: string | null;
  counterpartyCddRecordId?: string | null;
  agreedPrice: number;
  optionFee?: number | null;
  optionDate?: Date | null;
}

interface CreateOtpData {
  id?: string;
  transactionId: string;
  hdbSerialNumber: string;
}

export async function createTransaction(data: CreateTransactionData) {
  return prisma.transaction.create({
    data: {
      id: data.id ?? createId(),
      propertyId: data.propertyId,
      sellerId: data.sellerId,
      offerId: data.offerId ?? null,
      sellerCddRecordId: data.sellerCddRecordId ?? null,
      counterpartyCddRecordId: data.counterpartyCddRecordId ?? null,
      agreedPrice: data.agreedPrice,
      optionFee: data.optionFee ?? null,
      optionDate: data.optionDate ?? null,
    },
  });
}

export async function findById(id: string) {
  return prisma.transaction.findUnique({
    where: { id },
    include: { otp: true, commissionInvoice: true },
  });
}

export async function findByPropertyId(propertyId: string) {
  return prisma.transaction.findFirst({
    where: { propertyId },
    orderBy: { createdAt: 'desc' },
    include: { otp: true, commissionInvoice: true },
  });
}

export async function updateTransactionStatus(
  id: string,
  status: TransactionStatus,
  completionDate?: Date | null,
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      status,
      ...(completionDate !== undefined ? { completionDate } : {}),
    },
  });
}

export async function updateFallenThrough(id: string, reason: string) {
  return prisma.transaction.update({
    where: { id },
    data: { status: 'fallen_through', fallenThroughReason: reason },
  });
}

export async function updateHdbTracking(
  id: string,
  data: {
    hdbApplicationStatus?: HdbApplicationStatus;
    hdbAppointmentDate?: Date | null;
    hdbAppSubmittedAt?: Date | null;
    hdbAppSubmittedByAgentId?: string | null;
    hdbAppApprovedAt?: Date | null;
  },
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      hdbApplicationStatus: data.hdbApplicationStatus,
      hdbAppointmentDate: data.hdbAppointmentDate,
      hdbAppSubmittedAt: data.hdbAppSubmittedAt,
      hdbAppSubmittedByAgentId: data.hdbAppSubmittedByAgentId,
      hdbAppApprovedAt: data.hdbAppApprovedAt,
    },
  });
}

export async function updateExerciseDeadline(id: string, exerciseDeadline: Date) {
  return prisma.transaction.update({
    where: { id },
    data: { exerciseDeadline },
  });
}

export async function createOtp(data: CreateOtpData) {
  return prisma.otp.create({
    data: {
      id: data.id ?? createId(),
      transactionId: data.transactionId,
      hdbSerialNumber: data.hdbSerialNumber,
    },
  });
}

export async function findOtpByTransactionId(transactionId: string) {
  return prisma.otp.findUnique({ where: { transactionId } });
}

export async function updateOtpStatus(
  id: string,
  status: OtpStatus,
  extra?: {
    issuedAt?: Date;
    exercisedAt?: Date;
    expiredAt?: Date;
  },
) {
  return prisma.otp.update({
    where: { id },
    data: {
      status,
      ...(extra?.issuedAt ? { issuedAt: extra.issuedAt } : {}),
      ...(extra?.exercisedAt ? { exercisedAt: extra.exercisedAt } : {}),
      ...(extra?.expiredAt ? { expiredAt: extra.expiredAt } : {}),
    },
  });
}

export async function updateOtpReview(
  id: string,
  reviewedAt: Date,
  agentId: string,
  notes?: string,
) {
  return prisma.otp.update({
    where: { id },
    data: {
      agentReviewedAt: reviewedAt,
      agentReviewedByAgentId: agentId,
      agentReviewNotes: notes ?? null,
    },
  });
}

export async function updateOtpScanPath(id: string, scanType: 'seller' | 'returned', path: string) {
  const field = scanType === 'seller' ? 'scannedCopyPathSeller' : 'scannedCopyPathReturned';
  return prisma.otp.update({ where: { id }, data: { [field]: path } });
}

export async function createCommissionInvoice(data: {
  id?: string;
  transactionId: string;
  invoiceFilePath: string;
  invoiceNumber: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
}) {
  return prisma.commissionInvoice.create({
    data: {
      id: data.id ?? createId(),
      transactionId: data.transactionId,
      invoiceFilePath: data.invoiceFilePath,
      invoiceNumber: data.invoiceNumber,
      amount: data.amount,
      gstAmount: data.gstAmount,
      totalAmount: data.totalAmount,
      status: 'uploaded',
      uploadedAt: new Date(),
    },
  });
}

export async function findInvoiceByTransactionId(transactionId: string) {
  return prisma.commissionInvoice.findUnique({ where: { transactionId } });
}

export async function updateInvoiceStatus(
  id: string,
  status: 'sent_to_client' | 'paid',
  extra?: { sentAt?: Date; sentVia?: string; paidAt?: Date },
) {
  return prisma.commissionInvoice.update({
    where: { id },
    data: {
      status,
      ...(extra?.sentAt ? { sentAt: extra.sentAt } : {}),
      ...(extra?.sentVia ? { sentVia: extra.sentVia } : {}),
      ...(extra?.paidAt ? { paidAt: extra.paidAt } : {}),
    },
  });
}

export async function findEaaByTransactionId(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { estateAgencyAgreementId: true },
  });
  if (!tx?.estateAgencyAgreementId) return null;
  return prisma.estateAgencyAgreement.findUnique({
    where: { id: tx.estateAgencyAgreementId },
    select: { id: true, videoCallConfirmedAt: true, signedCopyPath: true },
  });
}

export async function findTransactionBySellerId(sellerId: string) {
  return prisma.transaction.findFirst({
    where: { sellerId, status: { not: 'fallen_through' } },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Counterparty CDD queries ─────────────────────────────────────────────────

export async function findAcceptedOfferByPropertyId(propertyId: string) {
  return prisma.offer.findFirst({
    where: { propertyId, status: 'accepted' },
    select: { id: true, buyerName: true, buyerAgentName: true, buyerAgentCeaReg: true },
  });
}

export async function findCounterpartyCddByPropertyId(propertyId: string) {
  const acceptedOffer = await prisma.offer.findFirst({
    where: { propertyId, status: 'accepted' },
    select: { id: true },
  });
  if (!acceptedOffer) return null;

  return prisma.cddRecord.findFirst({
    where: {
      subjectType: { in: ['buyer', 'counterparty'] },
      subjectId: acceptedOffer.id,
      identityVerified: true,
    },
  });
}

// ── Cron queries ──────────────────────────────────────────────────────────────

/** Returns all OTPs with status issued_to_buyer for reminder checking */
export async function findOtpsIssuedToBuyer() {
  return prisma.otp.findMany({
    where: { status: 'issued_to_buyer' },
    include: { transaction: { include: { seller: true } } },
  });
}

/** Returns transactions completed on a specific date */
export async function findTransactionsCompletedOn(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { gte: start, lte: end },
    },
    include: { seller: true },
  });
}

/** Returns transactions where completionDate was exactly N days ago */
export async function findTransactionsCompletedDaysAgo(daysAgo: number) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  return findTransactionsCompletedOn(target);
}

/** Deduplication check: returns existing notification or null */
export async function findExistingNotification(templateName: string, recipientId: string) {
  return prisma.notification.findFirst({ where: { templateName, recipientId } });
}

/** Returns transactions with HDB appointments within the next N days */
export async function findUpcomingHdbAppointments(withinDays: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86400000);
  return prisma.transaction.findMany({
    where: {
      hdbAppointmentDate: { gte: now, lte: cutoff },
      status: { in: ['option_exercised', 'completing'] },
    },
    select: { id: true, sellerId: true, hdbAppointmentDate: true },
  });
}
