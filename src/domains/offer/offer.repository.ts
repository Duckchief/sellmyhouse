import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { OfferStatus } from '@prisma/client';

interface CreateOfferData {
  id?: string;
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName?: string | null;
  buyerAgentCeaReg?: string | null;
  isCoBroke?: boolean;
  offerAmount: number;
  notes?: string | null;
  parentOfferId?: string | null;
  counterAmount?: number | null;
  retentionExpiresAt?: Date | null;
}

interface UpdateAiAnalysisData {
  aiAnalysis: string;
  aiAnalysisProvider: string;
  aiAnalysisModel: string;
  aiAnalysisStatus: string;
}

export async function create(data: CreateOfferData) {
  return prisma.offer.create({
    data: {
      id: data.id ?? createId(),
      propertyId: data.propertyId,
      buyerName: data.buyerName,
      buyerPhone: data.buyerPhone,
      buyerAgentName: data.buyerAgentName ?? null,
      buyerAgentCeaReg: data.buyerAgentCeaReg ?? null,
      isCoBroke: data.isCoBroke ?? false,
      offerAmount: data.offerAmount,
      notes: data.notes ?? null,
      parentOfferId: data.parentOfferId ?? null,
      counterAmount: data.counterAmount ?? null,
      retentionExpiresAt: data.retentionExpiresAt ?? null,
    },
  });
}

export async function findById(id: string) {
  return prisma.offer.findUnique({ where: { id } });
}

export async function findByPropertyId(propertyId: string) {
  return prisma.offer.findMany({
    where: { propertyId },
    orderBy: { createdAt: 'asc' },
    include: {
      counterOffers: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function updateStatus(id: string, status: OfferStatus) {
  return prisma.offer.update({ where: { id }, data: { status } });
}

export async function updateAiAnalysis(id: string, data: UpdateAiAnalysisData) {
  return prisma.offer.update({
    where: { id },
    data: {
      aiAnalysis: data.aiAnalysis,
      aiAnalysisProvider: data.aiAnalysisProvider,
      aiAnalysisModel: data.aiAnalysisModel,
      aiAnalysisStatus: data.aiAnalysisStatus,
    },
  });
}

/**
 * Updates only the AI analysis status, without modifying content or provider/model fields.
 * This prevents accidentally overwriting null fields with empty strings.
 */
export async function updateAiAnalysisStatus(id: string, status: string) {
  return prisma.offer.update({
    where: { id },
    data: { aiAnalysisStatus: status },
  });
}

/**
 * Expires all pending and countered offers for a property, except the accepted one.
 * Called when an offer is accepted — closes all other open negotiation threads.
 */
export async function expirePendingAndCounteredSiblings(propertyId: string, exceptOfferId: string) {
  return prisma.offer.updateMany({
    where: {
      propertyId,
      id: { not: exceptOfferId },
      status: { in: ['pending', 'countered'] },
    },
    data: { status: 'expired' },
  });
}
