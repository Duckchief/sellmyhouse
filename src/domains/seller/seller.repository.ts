import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { Seller, SellerStatus } from '@prisma/client';

export async function findById(id: string): Promise<Seller | null> {
  return prisma.seller.findUnique({
    where: { id },
  });
}

export async function updateOnboardingStep(id: string, step: number): Promise<Seller> {
  return prisma.seller.update({
    where: { id },
    data: { onboardingStep: step },
  });
}

export async function getSellerWithRelations(id: string) {
  return prisma.seller.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      onboardingStep: true,
      emailVerified: true,
      notificationPreference: true,
      consentService: true,
      consentMarketing: true,
      agentId: true,
      createdAt: true,
      updatedAt: true,
      properties: true,
      transactions: { select: { id: true, status: true } },
      consentRecords: { orderBy: { consentGivenAt: 'desc' } },
      caseFlags: { where: { status: { not: 'resolved' } } },
    },
  });
}

export async function updateNotificationPreference(
  id: string,
  preference: 'whatsapp_and_email' | 'email_only',
) {
  return prisma.seller.update({
    where: { id },
    data: { notificationPreference: preference },
  });
}

export async function getConsentHistory(sellerId: string) {
  return prisma.consentRecord.findMany({
    // Legacy: subjectId/subjectType retained in DB until explicit FK migration is complete
    where: { sellerId },
    orderBy: { consentGivenAt: 'desc' },
  });
}

export async function updateSellerStatus(
  id: string,
  data: { status: SellerStatus; consultationCompletedAt?: Date },
): Promise<Seller> {
  return prisma.seller.update({
    where: { id },
    data,
  });
}

/**
 * Find active sellers with no activity (updatedAt) for the last N days.
 * Returns seller ID, name, email, assigned agent ID, and last activity date.
 */
export async function findInactiveSellers(inactiveDays: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - inactiveDays);

  return prisma.seller.findMany({
    where: {
      status: { in: ['engaged', 'active'] },
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      name: true,
      email: true,
      agentId: true,
      updatedAt: true,
      status: true,
    },
  });
}

/**
 * Record that this seller was served the CPF disclaimer form.
 * Called on GET /seller/financial/form — provides server-side proof
 * the disclaimer was shown before any calculation is submitted.
 */
export async function recordCpfDisclaimerShown(id: string): Promise<void> {
  await prisma.seller.update({
    where: { id },
    data: { cpfDisclaimerShownAt: new Date() },
  });
}

export async function upsertSaleProceeds(data: {
  sellerId: string;
  sellingPrice: number;
  outstandingLoan: number;
  cpfSeller1: number;
  cpfSeller2?: number;
  cpfSeller3?: number;
  cpfSeller4?: number;
  resaleLevy: number;
  otherDeductions: number;
  commission: number;
  buyerDeposit?: number;
  netProceeds: number;
}) {
  return prisma.saleProceeds.upsert({
    where: { sellerId: data.sellerId },
    create: {
      id: createId(),
      ...data,
    },
    update: {
      sellingPrice: data.sellingPrice,
      outstandingLoan: data.outstandingLoan,
      cpfSeller1: data.cpfSeller1,
      cpfSeller2: data.cpfSeller2 ?? null,
      cpfSeller3: data.cpfSeller3 ?? null,
      cpfSeller4: data.cpfSeller4 ?? null,
      resaleLevy: data.resaleLevy,
      otherDeductions: data.otherDeductions,
      commission: data.commission,
      buyerDeposit: data.buyerDeposit ?? 0,
      netProceeds: data.netProceeds,
    },
  });
}

export async function findSaleProceedsBySellerId(sellerId: string) {
  return prisma.saleProceeds.findUnique({ where: { sellerId } });
}
