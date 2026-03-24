// src/domains/property/portal.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { PortalName } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

export async function findListingWithAgent(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      property: {
        include: {
          seller: {
            include: { agent: true },
          },
        },
      },
    },
  });
}

export async function upsertPortalListing(data: {
  listingId: string;
  portalName: string;
  portalReadyContent: Record<string, unknown>;
}) {
  return prisma.portalListing.upsert({
    where: {
      listingId_portalName: {
        listingId: data.listingId,
        portalName: data.portalName as PortalName,
      },
    },
    create: {
      id: createId(),
      listingId: data.listingId,
      portalName: data.portalName as PortalName,
      portalReadyContent: data.portalReadyContent as never,
      status: 'ready',
    },
    update: {
      portalReadyContent: data.portalReadyContent as never,
      status: 'ready',
      postedManuallyAt: null,
      portalListingUrl: null,
    },
  });
}

export async function updatePortalListing(
  id: string,
  data: { status: string; portalListingUrl: string; postedManuallyAt: Date },
) {
  return prisma.portalListing.update({
    where: { id },
    data: {
      status: data.status as never,
      portalListingUrl: data.portalListingUrl,
      postedManuallyAt: data.postedManuallyAt,
    },
  });
}

export async function findPortalListingsByListingId(listingId: string) {
  return prisma.portalListing.findMany({
    where: { listingId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function expirePortalListingsByListingId(listingId: string) {
  return prisma.portalListing.updateMany({
    where: {
      listingId,
      status: { in: ['ready', 'posted'] },
    },
    data: { status: 'expired' },
  });
}

export async function countPortalsReady(agentId?: string): Promise<number> {
  return prisma.listing.count({
    where: {
      photosApprovedAt: { not: null },
      descriptionApprovedAt: { not: null },
      photos: { not: Prisma.JsonNull },
      ...(agentId ? { property: { seller: { agentId } } } : {}),
      OR: [
        { portalListings: { none: {} } }, // no portal listings at all — needs action
        { portalListings: { some: { status: { not: 'posted' as never } } } }, // at least one not posted
      ],
    },
  });
}

export async function findListingsForPortalIndex(agentId?: string) {
  return prisma.listing.findMany({
    where: {
      status: { in: ['pending_review', 'approved', 'live', 'paused'] as never[] },
      OR: [
        { photos: { not: Prisma.JsonNull } },
        { photosApprovedAt: { not: null } },
        { descriptionApprovedAt: { not: null } },
        { description: { not: null } },
      ],
      ...(agentId ? { property: { seller: { agentId } } } : {}),
    },
    select: {
      id: true,
      status: true,
      photosApprovedAt: true,
      descriptionApprovedAt: true,
      photos: true,
      property: {
        select: {
          town: true,
          street: true,
          block: true,
          seller: { select: { name: true } },
        },
      },
      portalListings: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findListingById(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      photos: true,
      photosApprovedAt: true,
      property: { select: { seller: { select: { agentId: true } } } },
    },
  });
}

export async function clearListingPhotos(listingId: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { photos: Prisma.JsonNull },
  });
}
