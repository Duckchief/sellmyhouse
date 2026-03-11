// src/domains/property/portal.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { PortalName } from '@prisma/client';
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
      listingId_portalName: { listingId: data.listingId, portalName: data.portalName as PortalName },
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
