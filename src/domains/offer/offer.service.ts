import { createId } from '@paralleldrive/cuid2';
import { prisma } from '@/infra/database/prisma';
import * as offerRepo from './offer.repository';
import * as propertyRepo from '@/domains/property/property.repository';
import * as hdbService from '@/domains/hdb/service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import { NotFoundError, ValidationError, ForbiddenError } from '@/domains/shared/errors';
import { OFFER_TRANSITIONS, AI_ANALYSIS_STATUS } from './offer.types';
import type { CreateOfferInput, CounterOfferInput } from './offer.types';

export interface CreateOfferServiceInput extends CreateOfferInput {
  sellerId: string;
  town: string;
  flatType: string;
}

async function assertOfferOwnership(
  propertyId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<void> {
  if (callerRole === 'admin') return;
  const property = await propertyRepo.findByIdWithSeller(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  const assignedAgentId = property.seller?.agentId;
  if (assignedAgentId !== callerAgentId) {
    throw new ForbiddenError('You are not authorised to manage offers for this property');
  }
}

export async function findOffer(offerId: string) {
  return offerRepo.findById(offerId);
}

function buildOfferAnalysisPrompt(params: {
  offerAmount: number;
  town: string;
  flatType: string;
  recentPrices: number[];
}): string {
  const { offerAmount, town, flatType, recentPrices } = params;
  const sorted = [...recentPrices].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return [
    `You are a Singapore HDB real estate assistant for SellMyHomeNow.sg.`,
    `Analyse this offer for context, focusing on market positioning.`,
    ``,
    `Property: ${flatType} flat in ${town}`,
    `Offer amount: $${offerAmount.toLocaleString()}`,
    `Recent 12-month transactions (${sorted.length} records): ` +
      (median
        ? `median $${median.toLocaleString()}, range $${min?.toLocaleString()}–$${max?.toLocaleString()}`
        : 'insufficient data'),
    ``,
    `Write 2–3 concise sentences explaining how this offer compares to the market.`,
    `Use a neutral, professional tone. Do not provide financial advice.`,
    `End with: "This is indicative only based on public HDB data. It does not constitute financial or legal advice."`,
  ].join('\n');
}

export async function createOffer(input: CreateOfferServiceInput) {
  const listing = await propertyRepo.findActiveListingForProperty(input.propertyId);
  if (!listing) {
    throw new ValidationError('Offers can only be submitted for properties with an active listing');
  }

  const offerId = createId();

  // TODO: Anonymisation job required. On schedule, null buyerName and
  // buyerPhone on Offer records where retentionExpiresAt < now() and
  // transaction is fallen_through or completed.
  // See: src/infra/jobs/ (to be implemented).
  const retentionYears = await settingsService.getNumber('data_retention_years', 6);
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + retentionYears);

  const offer = await offerRepo.create({
    id: offerId,
    propertyId: input.propertyId,
    buyerName: input.buyerName,
    buyerPhone: input.buyerPhone,
    buyerAgentName: input.buyerAgentName ?? null,
    buyerAgentCeaReg: input.buyerAgentCeaReg ?? null,
    isCoBroke:
      input.buyerAgentName !== null &&
      input.buyerAgentName !== undefined &&
      input.buyerAgentName.trim().length > 0,
    offerAmount: input.offerAmount,
    notes: input.notes ?? null,
    retentionExpiresAt,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.created',
    entityType: 'offer',
    entityId: offerId,
    details: { propertyId: input.propertyId, offerAmount: input.offerAmount },
  });

  // Notify seller of new offer
  // Second argument is agentId — required by notificationService.send signature
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: input.sellerId,
      templateName: 'offer_received',
      templateData: {
        address: `${input.flatType} flat in ${input.town}`,
        amount: String(input.offerAmount),
      },
    },
    input.agentId,
  );

  // Attempt AI analysis if enabled
  const aiEnabled = await settingsService.getBoolean('offer_ai_analysis_enabled', false);
  if (aiEnabled) {
    try {
      const recentTransactions = await hdbService.getRecentByTownAndFlatType(
        input.town,
        input.flatType,
      );
      const recentPrices = recentTransactions.map((t) => Number(t.resalePrice));
      const prompt = buildOfferAnalysisPrompt({
        offerAmount: input.offerAmount,
        town: input.town,
        flatType: input.flatType,
        recentPrices,
      });
      const result = await aiFacade.generateText(prompt);
      await offerRepo.updateAiAnalysis(offerId, {
        aiAnalysis: result.text,
        aiAnalysisProvider: result.provider,
        aiAnalysisModel: result.model,
        aiAnalysisStatus: AI_ANALYSIS_STATUS.GENERATED,
      });
    } catch {
      // AI analysis failure is non-fatal — offer is still recorded
    }
  }

  return offer;
}

export async function counterOffer(input: CounterOfferInput & { role: string }) {
  const parent = await offerRepo.findById(input.parentOfferId);
  if (!parent) throw new NotFoundError('Offer', input.parentOfferId);

  await assertOfferOwnership(parent.propertyId, input.agentId, input.role);

  const allowed = OFFER_TRANSITIONS[parent.status];
  if (!allowed.includes('countered')) {
    throw new ValidationError(`Cannot counter an offer with status '${parent.status}'`);
  }

  const childId = createId();
  const [child] = await Promise.all([
    offerRepo.create({
      id: childId,
      propertyId: parent.propertyId,
      buyerName: parent.buyerName,
      buyerPhone: parent.buyerPhone,
      buyerAgentName: parent.buyerAgentName,
      buyerAgentCeaReg: parent.buyerAgentCeaReg,
      isCoBroke: parent.isCoBroke,
      offerAmount: Number(parent.offerAmount),
      counterAmount: input.counterAmount,
      notes: input.notes ?? null,
      parentOfferId: input.parentOfferId,
    }),
    offerRepo.updateStatus(input.parentOfferId, 'countered'),
  ]);

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.countered',
    entityType: 'offer',
    entityId: childId,
    details: { parentOfferId: input.parentOfferId, counterAmount: input.counterAmount },
  });

  return child;
}

export async function acceptOffer(input: { offerId: string; agentId: string; role: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  await assertOfferOwnership(offer.propertyId, input.agentId, input.role);

  const allowed = OFFER_TRANSITIONS[offer.status];
  if (!allowed.includes('accepted')) {
    throw new ValidationError(`Cannot accept an offer with status '${offer.status}'`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const accepted = await offerRepo.updateStatusTx(tx, input.offerId, 'accepted');
    await offerRepo.expirePendingAndCounteredSiblingsTx(tx, offer.propertyId, input.offerId);
    return accepted;
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.accepted',
    entityType: 'offer',
    entityId: input.offerId,
    details: { propertyId: offer.propertyId },
  });

  return updated;
}

export async function rejectOffer(input: { offerId: string; agentId: string; role: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  await assertOfferOwnership(offer.propertyId, input.agentId, input.role);

  const allowed = OFFER_TRANSITIONS[offer.status];
  if (!allowed.includes('rejected')) {
    throw new ValidationError(`Cannot reject an offer with status '${offer.status}'`);
  }

  const updated = await offerRepo.updateStatus(input.offerId, 'rejected');

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.rejected',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}

export async function getOffersForProperty(propertyId: string, agentId: string, role: string) {
  await assertOfferOwnership(propertyId, agentId, role);
  return offerRepo.findByPropertyId(propertyId);
}

export async function reviewAiAnalysis(input: { offerId: string; agentId: string }) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  if (!offer.aiAnalysis) {
    throw new ValidationError('No AI analysis exists for this offer');
  }

  if (offer.aiAnalysisStatus !== AI_ANALYSIS_STATUS.GENERATED) {
    throw new ValidationError(
      `AI analysis cannot be reviewed from status '${offer.aiAnalysisStatus}'`,
    );
  }

  const updated = await offerRepo.updateAiAnalysisStatus(
    input.offerId,
    AI_ANALYSIS_STATUS.REVIEWED,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.analysis_reviewed',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}

export async function shareAiAnalysis(input: {
  offerId: string;
  agentId: string;
  sellerId: string;
}) {
  const offer = await offerRepo.findById(input.offerId);
  if (!offer) throw new NotFoundError('Offer', input.offerId);

  if (!offer.aiAnalysis) {
    throw new ValidationError('No AI analysis exists for this offer');
  }
  if (offer.aiAnalysisStatus !== AI_ANALYSIS_STATUS.REVIEWED) {
    throw new ValidationError('AI analysis must be reviewed before sharing');
  }

  const updated = await offerRepo.updateAiAnalysisStatus(input.offerId, AI_ANALYSIS_STATUS.SHARED);

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: input.sellerId,
      templateName: 'offer_analysis_shared',
      templateData: {
        address: 'Property address',
        analysis: offer.aiAnalysis ?? '',
      },
    },
    input.agentId,
  );

  await auditService.log({
    agentId: input.agentId,
    action: 'offer.analysis_shared',
    entityType: 'offer',
    entityId: input.offerId,
    details: {},
  });

  return updated;
}
