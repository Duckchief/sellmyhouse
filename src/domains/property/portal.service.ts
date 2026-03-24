// src/domains/property/portal.service.ts
import * as portalRepo from './portal.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as auditService from '@/domains/shared/audit.service';
import { formatForPortal } from './portal.formatter';
import { NotFoundError, ForbiddenError } from '@/domains/shared/errors';
import type { PhotoRecord } from './property.types';
import { localStorage } from '@/infra/storage/local-storage';

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

export async function getPortalListings(
  listingId: string,
  callerAgentId?: string,
  callerRole?: string,
) {
  if (callerAgentId && callerRole !== 'admin') {
    const listing = await portalRepo.findListingWithAgent(listingId);
    if (!listing) throw new NotFoundError('Listing', listingId);
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to view this listing');
    }
  }
  return portalRepo.findPortalListingsByListingId(listingId);
}

export async function expirePortalListings(listingId: string) {
  return portalRepo.expirePortalListingsByListingId(listingId);
}

export async function getPortalsReadyCount(agentId?: string): Promise<number> {
  return portalRepo.countPortalsReady(agentId);
}

export type PortalIndexItem = {
  id: string;
  sellerName: string | null;
  address: string;
  photosStatus: 'approved' | 'pending' | 'downloaded';
  descriptionStatus: 'approved' | 'pending';
  portalsPostedCount: number;
};

export async function getPortalIndex(agentId?: string): Promise<PortalIndexItem[]> {
  const listings = await portalRepo.findListingsForPortalIndex(agentId);
  return listings.map((l) => {
    let photosStatus: 'approved' | 'pending' | 'downloaded';
    if (l.photosApprovedAt && !l.photos) {
      photosStatus = 'downloaded';
    } else if (l.photosApprovedAt) {
      photosStatus = 'approved';
    } else {
      photosStatus = 'pending';
    }

    return {
      id: l.id,
      sellerName: l.property.seller.name,
      address: `Blk ${l.property.block} ${l.property.street}, ${l.property.town}`,
      photosStatus,
      descriptionStatus: l.descriptionApprovedAt ? 'approved' : 'pending',
      portalsPostedCount: l.portalListings.filter((pl) => pl.status === 'posted').length,
    };
  });
}

export async function getListingForPortalsPage(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ id: string; photos: PhotoRecord[]; photosApprovedAt: Date | null }> {
  const listing = await portalRepo.findListingById(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to view this listing');
    }
  }

  const photos: PhotoRecord[] = listing.photos
    ? (() => {
        try {
          const parsed = JSON.parse(listing.photos as string);
          return Array.isArray(parsed) ? (parsed as PhotoRecord[]) : [];
        } catch {
          return [];
        }
      })()
    : [];

  return { id: listing.id, photos, photosApprovedAt: listing.photosApprovedAt };
}

export async function readPhotosForDownload(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ files: { buffer: Buffer; filename: string }[]; photos: PhotoRecord[] }> {
  const listing = await portalRepo.findListingById(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to manage this listing');
    }
  }

  if (!listing.photos) throw new NotFoundError('Photos', listingId);

  let photos: PhotoRecord[];
  try {
    const parsed = JSON.parse(listing.photos as string);
    photos = Array.isArray(parsed) ? (parsed as PhotoRecord[]) : [];
  } catch {
    photos = [];
  }
  if (photos.length === 0) throw new NotFoundError('Photos', listingId);

  const files: { buffer: Buffer; filename: string }[] = [];
  for (const photo of photos) {
    try {
      const buffer = await localStorage.read(photo.optimizedPath);
      files.push({ buffer, filename: `photo-${photo.displayOrder + 1}-${photo.id}.jpg` });
    } catch {
      // File missing from disk — still proceed with cleanup
    }
  }

  return { files, photos };
}

export async function deletePhotosFromListing(
  listingId: string,
  photos: PhotoRecord[],
  callerAgentId: string,
): Promise<void> {
  for (const photo of photos) {
    await localStorage.delete(photo.optimizedPath);
    await localStorage.delete(photo.path);
  }

  await portalRepo.clearListingPhotos(listingId);

  await auditService.log({
    agentId: callerAgentId,
    action: 'listing_photos.downloaded_and_deleted',
    entityType: 'listing',
    entityId: listingId,
    details: { photoCount: photos.length },
  });
}

export async function downloadAndDeletePhotos(
  listingId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ files: { buffer: Buffer; filename: string }[] }> {
  const { files, photos } = await readPhotosForDownload(listingId, callerAgentId, callerRole);
  await deletePhotosFromListing(listingId, photos, callerAgentId);
  return { files };
}
