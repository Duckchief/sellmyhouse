import { createId } from '@paralleldrive/cuid2';
import * as propertyRepo from './property.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError, ForbiddenError, ValidationError, ComplianceError } from '../shared/errors';
import { canTransitionListing } from './property.types';
import type { CreatePropertyInput, UpdatePropertyInput } from './property.types';
import { checkComplianceGate } from '@/domains/review/review.service';
import * as caseFlagService from '@/domains/seller/case-flag.service';
import * as authRepo from '../auth/auth.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import { buildListingDescriptionPrompt } from '@/domains/shared/ai/prompts/listing-description';
import { logger } from '@/infra/logger';

const SLUG_RETRY_LIMIT = 3;

export function generatePropertySlug(block: string, street: string, town: string): string {
  return `${block}-${street}-${town}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function buildUniqueSlug(baseSlug: string): Promise<string> {
  const existing = await propertyRepo.findBySlug(baseSlug);
  if (!existing) return baseSlug;
  return `${baseSlug}-${createId().slice(0, 6)}`;
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002';
}

export async function createProperty(input: CreatePropertyInput) {
  // MOP enforcement: block listing if mop_not_met flag is active unless agent provides override reason
  const hasMopBlock = await caseFlagService.hasActiveMopFlag(input.sellerId);
  if (hasMopBlock && !input.mopOverrideReason) {
    throw new ComplianceError(
      'MOP not yet met: listing creation is blocked. Provide mopOverrideReason to override.',
    );
  }

  const seller = await authRepo.findSellerById(input.sellerId);
  if (!seller?.emailVerified) {
    throw new ValidationError('Please verify your email address before creating a listing.');
  }

  const baseSlug = generatePropertySlug(input.block, input.street, input.town);

  // L20: Retry on slug unique constraint violation (P2002) to handle concurrent requests
  // M39: Property + listing created atomically in a single transaction
  let property;
  for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
    const slug =
      attempt === 0
        ? await buildUniqueSlug(baseSlug)
        : `${baseSlug}-${createId().slice(0, 6)}`;
    try {
      property = await propertyRepo.createPropertyWithListing({ ...input, slug });
      break;
    } catch (err) {
      if (isPrismaUniqueConstraintError(err) && attempt < SLUG_RETRY_LIMIT - 1) {
        logger.warn({ attempt, baseSlug }, 'Slug collision on property create, retrying');
        continue;
      }
      throw err;
    }
  }

  // L21: Add .catch() to fire-and-forget audit calls
  auditService
    .log({
      action: 'property.created',
      entityType: 'property',
      entityId: property!.id,
      details: { sellerId: input.sellerId },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));

  // Audit the MOP override when an override reason was provided
  if (hasMopBlock && input.mopOverrideReason) {
    auditService
      .log({
        agentId: input.agentId,
        action: 'case_flag.mop_override',
        entityType: 'property',
        entityId: property!.id,
        details: { sellerId: input.sellerId, mopOverrideReason: input.mopOverrideReason },
      })
      .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));
  }

  return property!;
}

export async function getPropertyForSeller(sellerId: string) {
  return propertyRepo.findBySellerId(sellerId);
}

export async function getPropertyById(propertyId: string) {
  const property = await propertyRepo.findByIdWithListings(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  return property;
}

export async function updateProperty(
  propertyId: string,
  sellerId: string,
  data: UpdatePropertyInput,
) {
  const property = await propertyRepo.findByIdWithListings(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  if (property.sellerId !== sellerId) throw new ForbiddenError('You do not own this property');

  const updated = await propertyRepo.update(propertyId, data);

  // If the listing is live, revert to pending_review
  const activeListing = updated.listings.find((l) => l.status !== 'closed');
  if (activeListing && activeListing.status === 'live') {
    await propertyRepo.updateListingStatus(activeListing.id, 'pending_review');
  }

  // L21: Add .catch() to fire-and-forget audit call
  auditService
    .log({
      action: 'property.updated',
      entityType: 'property',
      entityId: propertyId,
      details: { sellerId, data },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));

  return updated;
}

export async function updateAskingPrice(propertyId: string, sellerId: string, newPrice: number) {
  const property = await propertyRepo.findByIdWithListings(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  if (property.sellerId !== sellerId) throw new ForbiddenError('You do not own this property');

  const oldPrice = property.askingPrice;
  const updated = await propertyRepo.appendPriceHistory(propertyId, newPrice, sellerId);

  // If listing is live, revert to pending_review
  const activeListing = updated.listings.find((l) => l.status !== 'closed');
  if (activeListing && activeListing.status === 'live') {
    await propertyRepo.updateListingStatus(activeListing.id, 'pending_review');
    // L21: Add .catch() to fire-and-forget audit call
    auditService
      .log({
        action: 'listing.reverted_to_pending_review',
        entityType: 'listing',
        entityId: activeListing.id,
        details: { reason: 'asking_price_changed' },
      })
      .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));
  }

  // L21: Add .catch() to fire-and-forget audit call
  auditService
    .log({
      action: 'property.price_changed',
      entityType: 'property',
      entityId: propertyId,
      details: { sellerId, oldPrice, newPrice },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));

  return updated;
}

export async function revertPropertyToDraft(propertyId: string): Promise<void> {
  await propertyRepo.updatePropertyStatus(propertyId, 'draft');

  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (listing) {
    await propertyRepo.updateListingStatus(listing.id, 'draft');
  }

  // L21: Add .catch() to fire-and-forget audit call
  auditService
    .log({
      action: 'property.reverted_to_draft',
      entityType: 'property',
      entityId: propertyId,
      details: { reason: 'fallen_through' },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));
}

export async function backfillPropertySlugs(): Promise<number> {
  const properties = await propertyRepo.findWithNullSlug();
  let count = 0;
  for (const p of properties) {
    const baseSlug = generatePropertySlug(p.block, p.street, p.town);
    const slug = await buildUniqueSlug(baseSlug);
    await propertyRepo.updateSlug(p.id, slug);
    await auditService.log({
      action: 'property.slug_backfilled',
      entityType: 'property',
      entityId: p.id,
      details: { slug },
    });
    count++;
  }
  return count;
}

export async function findPropertyByIdWithSeller(propertyId: string) {
  return propertyRepo.findByIdWithSeller(propertyId);
}

export async function findActiveListingForProperty(propertyId: string) {
  return propertyRepo.findActiveListingForProperty(propertyId);
}

export async function findPropertyByIdWithListings(propertyId: string) {
  return propertyRepo.findByIdWithListings(propertyId);
}

export async function updateListingStatus(propertyId: string, newStatus: string) {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) throw new NotFoundError('Active listing for property', propertyId);

  if (!canTransitionListing(listing.status, newStatus)) {
    throw new ValidationError(
      `Cannot transition listing from '${listing.status}' to '${newStatus}'`,
    );
  }

  // Gate 2: EAA must be signed before listing can go live
  if (newStatus === 'live') {
    const property = await propertyRepo.findByIdWithListings(propertyId);
    if (!property) throw new NotFoundError('Property', propertyId);
    await checkComplianceGate('eaa_signed', property.sellerId);
  }

  // M46: When going live, update both listing and property status atomically
  let updated;
  if (newStatus === 'live') {
    updated = await propertyRepo.updateListingAndPropertyStatus(
      listing.id,
      newStatus,
      propertyId,
      'listed',
    );
  } else {
    updated = await propertyRepo.updateListingStatus(listing.id, newStatus);
  }

  // L21: Add .catch() to fire-and-forget audit call
  auditService
    .log({
      action: 'listing.status_changed',
      entityType: 'listing',
      entityId: listing.id,
      details: { from: listing.status, to: newStatus },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Audit log failed'));

  return updated;
}

export async function generateListingDescription(
  listingId: string,
  agentId: string,
  callerRole: string,
): Promise<void> {
  const listing = await propertyRepo.findListingForDescriptionGeneration(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== agentId) {
      throw new ForbiddenError('You are not authorised to generate a description for this listing');
    }
  }

  const template = await settingsService.get('listing_description_prompt');
  // buildListingDescriptionPrompt throws ValidationError if template is empty
  const prompt = buildListingDescriptionPrompt(template, {
    flatType: listing.property.flatType,
    town: listing.property.town,
    block: listing.property.block,
    street: listing.property.street,
    floorAreaSqm: listing.property.floorAreaSqm,
    storey: listing.property.level,
    leaseCommencementDate: listing.property.leaseCommenceDate,
  });

  const result = await aiFacade.generateText(prompt);

  await propertyRepo.saveAiDescription(listingId, {
    aiDescription: result.text,
    aiDescriptionStatus: 'ai_generated',
    aiDescriptionProvider: result.provider,
    aiDescriptionModel: result.model,
    aiDescriptionGeneratedAt: new Date(),
    descriptionApprovedAt: null,
  });

  await auditService.log({
    agentId,
    action: 'listing.description_generated',
    entityType: 'listing',
    entityId: listingId,
    details: { provider: result.provider, model: result.model },
  });
}

export async function saveDescriptionDraft(
  listingId: string,
  text: string,
  agentId: string,
  callerRole: string,
): Promise<void> {
  const listing = await propertyRepo.findListingForDescriptionGeneration(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  const effectiveRole = callerRole ?? 'agent';
  if (effectiveRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== agentId) {
      throw new ForbiddenError('You are not authorised to edit this listing description');
    }
  }

  await propertyRepo.updateDescriptionDraft(listingId, text);

  await auditService.log({
    agentId,
    action: 'listing.description_draft_saved',
    entityType: 'listing',
    entityId: listingId,
    details: {},
  });
}
