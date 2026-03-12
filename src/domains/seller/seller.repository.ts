import { prisma } from '@/infra/database/prisma';
import type { Seller } from '@prisma/client';

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

export async function getConsentHistory(sellerId: string) {
  return prisma.consentRecord.findMany({
    where: {
      subjectType: 'seller',
      subjectId: sellerId,
    },
    orderBy: { consentGivenAt: 'desc' },
  });
}

