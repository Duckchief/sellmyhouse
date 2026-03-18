import { prisma } from '@/infra/database/prisma';
import { Prisma } from '@prisma/client';
import type { AiDescriptionStatus } from '@prisma/client';

import type { ReviewItem, EntityType, ReviewStatus } from './review.types';

export interface ReviewQueueResult {
  items: ReviewItem[];
  countByType: Record<EntityType, number>;
  totalCount: number;
}

export function buildAddress(town: string, street: string, block: string): string {
  return `${block} ${street}, ${town}`.trim();
}

export async function getPendingQueue(agentId?: string): Promise<ReviewQueueResult> {
  const sellerWhere = agentId ? { agentId } : {};

  const [financialReports, listingDescs, listingPhotos, weeklyUpdates, docChecklists] =
    await Promise.all([
      prisma.financialReport.findMany({
        where: { status: 'pending_review', seller: sellerWhere },
        include: {
          seller: { select: { id: true, name: true } },
          property: { select: { town: true, street: true, block: true } },
        },
      }),
      prisma.listing.findMany({
        where: {
          description: { not: null },
          descriptionApprovedAt: null,
          property: { seller: sellerWhere },
        },
        include: {
          property: {
            include: { seller: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.listing.findMany({
        where: {
          photos: { not: Prisma.JsonNull },
          photosApprovedAt: null,
          property: { seller: sellerWhere },
        },
        include: {
          property: {
            include: { seller: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.weeklyUpdate.findMany({
        where: { status: 'pending_review', seller: sellerWhere },
        include: {
          seller: { select: { id: true, name: true } },
          property: { select: { town: true, street: true, block: true } },
        },
      }),
      prisma.documentChecklist.findMany({
        where: { status: 'pending_review', seller: sellerWhere },
        include: {
          seller: { select: { id: true, name: true } },
          property: { select: { town: true, street: true, block: true } },
        },
      }),
    ]);

  const now = Date.now();

  const items: ReviewItem[] = [
    ...financialReports.map((r) => ({
      id: r.id,
      entityType: 'financial_report' as EntityType,
      entityId: r.id,
      sellerId: r.sellerId,
      sellerName: r.seller.name,
      propertyAddress: buildAddress(r.property.town, r.property.street, r.property.block),
      currentStatus: r.status,
      submittedAt: r.createdAt,
      priority: now - r.createdAt.getTime(),
    })),
    ...listingDescs.map((l) => ({
      id: `${l.id}-desc`,
      entityType: 'listing_description' as EntityType,
      entityId: l.id,
      sellerId: l.property.seller.id,
      sellerName: l.property.seller.name,
      propertyAddress: buildAddress(l.property.town, l.property.street, l.property.block),
      currentStatus: 'pending_review' as ReviewStatus,
      submittedAt: l.createdAt,
      priority: now - l.createdAt.getTime(),
    })),
    ...listingPhotos.map((l) => ({
      id: `${l.id}-photos`,
      entityType: 'listing_photos' as EntityType,
      entityId: l.id,
      sellerId: l.property.seller.id,
      sellerName: l.property.seller.name,
      propertyAddress: buildAddress(l.property.town, l.property.street, l.property.block),
      currentStatus: 'pending_review' as ReviewStatus,
      submittedAt: l.createdAt,
      priority: now - l.createdAt.getTime(),
    })),
    ...weeklyUpdates.map((w) => ({
      id: w.id,
      entityType: 'weekly_update' as EntityType,
      entityId: w.id,
      sellerId: w.sellerId,
      sellerName: w.seller.name,
      propertyAddress: buildAddress(w.property.town, w.property.street, w.property.block),
      currentStatus: w.status,
      submittedAt: w.createdAt,
      priority: now - w.createdAt.getTime(),
    })),
    ...docChecklists.map((d) => ({
      id: d.id,
      entityType: 'document_checklist' as EntityType,
      entityId: d.id,
      sellerId: d.sellerId,
      sellerName: d.seller.name,
      propertyAddress: buildAddress(d.property.town, d.property.street, d.property.block),
      currentStatus: d.status,
      submittedAt: d.createdAt,
      priority: now - d.createdAt.getTime(),
    })),
  ].sort((a, b) => b.priority - a.priority);

  const countByType: Record<EntityType, number> = {
    financial_report: financialReports.length,
    listing_description: listingDescs.length,
    listing_photos: listingPhotos.length,
    weekly_update: weeklyUpdates.length,
    document_checklist: docChecklists.length,
  };

  return { items, countByType, totalCount: items.length };
}

export async function getDetailForReview(
  entityType: EntityType,
  entityId: string,
): Promise<
  | Awaited<ReturnType<typeof prisma.financialReport.findUnique>>
  | Awaited<ReturnType<typeof prisma.listing.findUnique>>
  | Awaited<ReturnType<typeof prisma.weeklyUpdate.findUnique>>
  | Awaited<ReturnType<typeof prisma.documentChecklist.findUnique>>
  | undefined
> {
  switch (entityType) {
    case 'financial_report':
      return prisma.financialReport.findUnique({
        where: { id: entityId },
        include: { seller: true, property: true },
      });
    case 'listing_description':
    case 'listing_photos':
      return prisma.listing.findUnique({
        where: { id: entityId },
        include: { property: { include: { seller: true } } },
      });
    case 'weekly_update':
      return prisma.weeklyUpdate.findUnique({
        where: { id: entityId },
        include: { seller: true, property: true },
      });
    case 'document_checklist':
      return prisma.documentChecklist.findUnique({
        where: { id: entityId },
        include: { seller: true, property: true },
      });
    default:
      entityType satisfies never;
      return undefined;
  }
}

export async function approveFinancialReport(entityId: string, agentId: string) {
  return prisma.financialReport.update({
    where: { id: entityId },
    data: {
      status: 'approved',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      approvedAt: new Date(),
    },
  });
}

export async function rejectFinancialReport(
  entityId: string,
  agentId: string,
  reviewNotes: string,
) {
  return prisma.financialReport.update({
    where: { id: entityId },
    data: {
      status: 'rejected',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });
}

export async function approveListingDescription(entityId: string, agentId: string) {
  const listing = await prisma.listing.findUnique({
    where: { id: entityId },
    select: { aiDescription: true },
  });
  return prisma.listing.update({
    where: { id: entityId },
    data: {
      descriptionApprovedByAgentId: agentId,
      descriptionApprovedAt: new Date(),
      aiDescriptionStatus: 'approved' as AiDescriptionStatus,
      ...(listing?.aiDescription != null && { description: listing.aiDescription }),
    },
  });
}

export async function rejectListingDescription(
  entityId: string,
  _agentId: string,
  _reviewNotes: string,
) {
  // Clear description to force regeneration; notes captured in audit log
  return prisma.listing.update({
    where: { id: entityId },
    data: { description: null },
  });
}

export async function approveListingPhotos(entityId: string, agentId: string) {
  return prisma.listing.update({
    where: { id: entityId },
    data: {
      photosApprovedByAgentId: agentId,
      photosApprovedAt: new Date(),
    },
  });
}

export async function rejectListingPhotos(
  entityId: string,
  _agentId: string,
  _reviewNotes: string,
) {
  return prisma.listing.update({
    where: { id: entityId },
    data: { photos: Prisma.JsonNull },
  });
}

export async function approveWeeklyUpdate(entityId: string, agentId: string) {
  return prisma.weeklyUpdate.update({
    where: { id: entityId },
    data: {
      status: 'approved',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      approvedAt: new Date(),
    },
  });
}

export async function rejectWeeklyUpdate(entityId: string, agentId: string, reviewNotes: string) {
  return prisma.weeklyUpdate.update({
    where: { id: entityId },
    data: {
      status: 'rejected',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });
}

export async function approveDocumentChecklist(entityId: string, agentId: string) {
  return prisma.documentChecklist.update({
    where: { id: entityId },
    data: {
      status: 'approved',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      approvedAt: new Date(),
    },
  });
}

export async function rejectDocumentChecklist(
  entityId: string,
  agentId: string,
  reviewNotes: string,
) {
  return prisma.documentChecklist.update({
    where: { id: entityId },
    data: {
      status: 'rejected',
      reviewedByAgentId: agentId,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });
}

export async function checkListingFullyApproved(listingId: string): Promise<boolean> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { descriptionApprovedAt: true, photosApprovedAt: true },
  });
  if (!listing) return false;
  return !!(listing.descriptionApprovedAt && listing.photosApprovedAt);
}

export async function setListingStatus(listingId: string, status: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { status: status as never },
  });
}

/**
 * Returns the agentId assigned to the seller who owns this listing.
 * Returns null if the listing or seller does not exist, or if no agent is assigned.
 */
export async function getListingAgentId(listingId: string): Promise<string | null> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { property: { select: { seller: { select: { agentId: true } } } } },
  });
  return listing?.property?.seller?.agentId ?? null;
}

// Compliance gate queries

export async function findVerifiedSellerCdd(sellerId: string) {
  return prisma.cddRecord.findFirst({
    where: { subjectType: 'seller', subjectId: sellerId, identityVerified: true },
  });
}

export async function findActiveEaa(sellerId: string) {
  return prisma.estateAgencyAgreement.findFirst({
    where: { sellerId, status: { in: ['signed', 'active'] } },
  });
}

export async function findSellerById(sellerId: string) {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, name: true, agentId: true },
  });
}
