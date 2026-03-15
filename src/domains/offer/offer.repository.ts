import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { Offer, OfferStatus, Prisma } from '@prisma/client';

interface CreateOfferData {
  id?: string;
  propertyId: string;
  buyerName: string | null;
  buyerPhone: string | null;
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
      buyerName: data.buyerName ?? null,
      buyerPhone: data.buyerPhone ?? null,
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

/**
 * Transactional variant: update offer status within a Prisma transaction client.
 */
export async function updateStatusTx(
  tx: Prisma.TransactionClient,
  id: string,
  status: OfferStatus,
) {
  return tx.offer.update({ where: { id }, data: { status } });
}

/**
 * Transactional variant: expire siblings within a Prisma transaction client.
 */
export async function expirePendingAndCounteredSiblingsTx(
  tx: Prisma.TransactionClient,
  propertyId: string,
  exceptOfferId: string,
) {
  return tx.offer.updateMany({
    where: {
      propertyId,
      id: { not: exceptOfferId },
      status: { in: ['pending', 'countered'] },
    },
    data: { status: 'expired' },
  });
}

/**
 * Atomically accepts an offer and expires all pending/countered siblings.
 * Wraps the Prisma $transaction so the service layer doesn't need direct Prisma access.
 */
export async function acceptOfferAtomically(offerId: string, propertyId: string) {
  return prisma.$transaction(async (tx) => {
    const accepted = await updateStatusTx(tx, offerId, 'accepted');
    await expirePendingAndCounteredSiblingsTx(tx, propertyId, offerId);
    return accepted;
  });
}

/**
 * Returns all Offer records where retentionExpiresAt is in the past
 * and at least one PII field (buyerName or buyerPhone) is not yet nulled.
 * Used by the anonymisation job to find records that need PII erasure.
 */
export async function findOffersForAnonymisation(): Promise<Offer[]> {
  return prisma.offer.findMany({
    where: {
      retentionExpiresAt: { lt: new Date() },
      OR: [{ buyerName: { not: null } }, { buyerPhone: { not: null } }],
    },
  });
}

/**
 * Nulls buyerName and buyerPhone on the given Offer record.
 * This is the PDPA-compliant anonymisation step — called by the anonymisation job
 * after retentionExpiresAt has passed.
 */
export async function anonymiseOfferPii(offerId: string): Promise<void> {
  await prisma.offer.update({
    where: { id: offerId },
    data: { buyerName: null, buyerPhone: null },
  });
}
