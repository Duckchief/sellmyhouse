import { prisma } from '@/infra/database/prisma';
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
    include: {
      properties: true,
      transactions: true,
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
