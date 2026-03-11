// src/domains/property/portal.service.ts
import * as portalRepo from './portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { formatForPortal } from './portal.formatter';
import { NotFoundError } from '@/domains/shared/errors';

const PORTALS = ['propertyguru', 'ninety_nine_co', 'srx'] as const;

export async function generatePortalListings(listingId: string): Promise<void> {
  const listing = await portalRepo.findListingWithAgent(listingId);

  if (!listing) throw new NotFoundError('Listing', listingId);
  if (!listing.property?.seller?.agent) {
    throw new NotFoundError('Agent for listing', listingId);
  }

  const [agencyName, agencyLicence] = await Promise.all([
    settingsService.get('agency_name', 'Huttons Asia Pte Ltd'),
    settingsService.get('agency_licence', 'L3008899K'),
  ]);

  const agent = listing.property.seller.agent;

  for (const portal of PORTALS) {
    const content = formatForPortal({
      portal,
      listing: listing as never,
      property: listing.property as never,
      agent: { id: agent.id, name: agent.name, ceaRegNo: agent.ceaRegNo, phone: agent.phone },
      agencyName,
      agencyLicence,
    });

    await portalRepo.upsertPortalListing({
      listingId,
      portalName: portal,
      portalReadyContent: content as unknown as Record<string, unknown>,
    });
  }

  await auditService.log({
    action: 'portal.listings_generated',
    entityType: 'listing',
    entityId: listingId,
    details: { portals: PORTALS },
  });
}

export async function markAsPosted(portalListingId: string, url: string) {
  return portalRepo.updatePortalListing(portalListingId, {
    status: 'posted',
    portalListingUrl: url,
    postedManuallyAt: new Date(),
  });
}

export async function getPortalListings(listingId: string) {
  return portalRepo.findPortalListingsByListingId(listingId);
}

export async function expirePortalListings(listingId: string) {
  return portalRepo.expirePortalListingsByListingId(listingId);
}
