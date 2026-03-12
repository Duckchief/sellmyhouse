import { createId } from '@paralleldrive/cuid2';
import * as propertyRepo from './property.repository';
import * as auditService from '../shared/audit.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../shared/errors';
import { canTransitionListing } from './property.types';
import type { CreatePropertyInput, UpdatePropertyInput } from './property.types';
import { checkComplianceGate } from '@/domains/review/review.service';

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

export async function createProperty(input: CreatePropertyInput) {
  const baseSlug = generatePropertySlug(input.block, input.street, input.town);
  const slug = await buildUniqueSlug(baseSlug);

  const property = await propertyRepo.create({ ...input, slug });
  await propertyRepo.createListing(property.id);

  auditService.log({
    action: 'property.created',
    entityType: 'property',
    entityId: property.id,
    details: { sellerId: input.sellerId },
  });

  return property;
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

  auditService.log({
    action: 'property.updated',
    entityType: 'property',
    entityId: propertyId,
    details: { sellerId, data },
  });

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
    auditService.log({
      action: 'listing.reverted_to_pending_review',
      entityType: 'listing',
      entityId: activeListing.id,
      details: { reason: 'asking_price_changed' },
    });
  }

  auditService.log({
    action: 'property.price_changed',
    entityType: 'property',
    entityId: propertyId,
    details: { sellerId, oldPrice, newPrice },
  });

  return updated;
}

export async function revertPropertyToDraft(propertyId: string): Promise<void> {
  await propertyRepo.updatePropertyStatus(propertyId, 'draft');

  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (listing) {
    await propertyRepo.updateListingStatus(listing.id, 'draft');
  }

  auditService.log({
    action: 'property.reverted_to_draft',
    entityType: 'property',
    entityId: propertyId,
    details: { reason: 'fallen_through' },
  });
}

export async function backfillPropertySlugs(): Promise<number> {
  const properties = await propertyRepo.findWithNullSlug();
  let count = 0;
  for (const p of properties) {
    const baseSlug = generatePropertySlug(p.block, p.street, p.town);
    const slug = await buildUniqueSlug(baseSlug);
    await propertyRepo.updateSlug(p.id, slug);
    count++;
  }
  return count;
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

  const updated = await propertyRepo.updateListingStatus(listing.id, newStatus);

  auditService.log({
    action: 'listing.status_changed',
    entityType: 'listing',
    entityId: listing.id,
    details: { from: listing.status, to: newStatus },
  });

  return updated;
}
