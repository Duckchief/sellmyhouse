import { prisma } from '@/infra/database/prisma';
import type { Prisma } from '@prisma/client';

export async function create(data: {
  id: string;
  sellerId: string;
  propertyId: string;
  reportData: unknown;
  version?: number;
}) {
  return prisma.financialReport.create({
    data: {
      id: data.id,
      sellerId: data.sellerId,
      propertyId: data.propertyId,
      reportData: data.reportData as Prisma.InputJsonValue,
      version: data.version,
    },
  });
}

export async function findById(id: string) {
  return prisma.financialReport.findUnique({ where: { id } });
}

export async function findLatestForProperty(sellerId: string, propertyId: string) {
  return prisma.financialReport.findFirst({
    where: { sellerId, propertyId },
    orderBy: { version: 'desc' },
  });
}

export async function findAllForSeller(sellerId: string) {
  return prisma.financialReport.findMany({
    where: { sellerId },
    orderBy: { version: 'desc' },
  });
}

export async function updateNarrative(
  id: string,
  data: { aiNarrative: string; aiProvider: string; aiModel: string },
) {
  return prisma.financialReport.update({
    where: { id },
    data: {
      aiNarrative: data.aiNarrative,
      aiProvider: data.aiProvider,
      aiModel: data.aiModel,
      status: 'pending_review',
    },
  });
}

export async function approve(id: string, agentId: string, reviewNotes?: string) {
  const now = new Date();
  return prisma.financialReport.update({
    where: { id },
    data: {
      reviewedByAgentId: agentId,
      reviewedAt: now,
      reviewNotes: reviewNotes ?? null,
      approvedAt: now,
      status: 'approved',
    },
  });
}

export async function markSent(id: string, channel: string) {
  return prisma.financialReport.update({
    where: { id },
    data: {
      sentToSellerAt: new Date(),
      sentVia: channel,
      status: 'sent',
    },
  });
}
