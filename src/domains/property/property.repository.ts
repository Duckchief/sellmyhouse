import { prisma } from '../../infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import { $Enums, AiDescriptionStatus } from '@prisma/client';
import type {
  CreatePropertyInput,
  UpdatePropertyInput,
  PhotoRecord,
  PriceHistoryEntry,
} from './property.types';

export const propertyRepository = {
  // ─── Property ──────────────────────────────────────────────

  async create(input: CreatePropertyInput) {
    return prisma.property.create({
      data: {
        id: createId(),
        priceHistory: '[]',
        ...input,
      },
    });
  },

  // M39: Atomic property + listing creation in a single transaction
  async createPropertyWithListing(input: CreatePropertyInput) {
    return prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          id: createId(),
          priceHistory: '[]',
          ...input,
        },
      });
      await tx.listing.create({
        data: {
          id: createId(),
          propertyId: property.id,
          status: 'draft',
          photos: '[]',
        },
      });
      return property;
    });
  },

  async findByIdWithListings(id: string) {
    return prisma.property.findUnique({
      where: { id },
      include: { listings: true },
    });
  },

  async findByIdWithSeller(id: string) {
    return prisma.property.findUnique({
      where: { id },
      select: { id: true, seller: { select: { agentId: true } } },
    });
  },

  async findBySellerId(sellerId: string) {
    return prisma.property.findFirst({
      where: { sellerId },
      include: { listings: true },
    });
  },

  async update(id: string, data: UpdatePropertyInput) {
    return prisma.property.update({
      where: { id },
      data,
      include: { listings: true },
    });
  },

  async appendPriceHistory(id: string, newPrice: number, changedBy: string) {
    const property = await prisma.property.findUnique({
      where: { id },
      include: { listings: true },
    });

    const rawHistory = property?.priceHistory;
    const existingHistory: PriceHistoryEntry[] = rawHistory
      ? (JSON.parse(rawHistory as string) as PriceHistoryEntry[])
      : [];

    const newEntry: PriceHistoryEntry = {
      price: newPrice,
      changedAt: new Date().toISOString(),
      changedBy,
    };

    const updatedHistory = [...existingHistory, newEntry];

    return prisma.property.update({
      where: { id },
      data: {
        askingPrice: newPrice,
        priceHistory: JSON.stringify(updatedHistory),
      },
      include: { listings: true },
    });
  },

  // ─── Listing ───────────────────────────────────────────────

  async createListing(propertyId: string) {
    return prisma.listing.create({
      data: {
        id: createId(),
        propertyId,
        status: 'draft',
        photos: '[]',
      },
    });
  },

  async findActiveListingForProperty(propertyId: string) {
    return prisma.listing.findFirst({
      where: {
        propertyId,
        status: { notIn: ['closed'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findListingWithSeller(listingId: string) {
    return prisma.listing.findUnique({
      where: { id: listingId },
      include: { property: { include: { seller: { select: { agentId: true } } } } },
    });
  },

  async updateListingStatus(listingId: string, status: string) {
    return prisma.listing.update({
      where: { id: listingId },
      data: { status: status as $Enums.ListingStatus },
    });
  },

  // M46: Atomic listing + property status update in a single transaction
  async updateListingAndPropertyStatus(
    listingId: string,
    listingStatus: string,
    propertyId: string,
    propertyStatus: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const listing = await tx.listing.update({
        where: { id: listingId },
        data: { status: listingStatus as $Enums.ListingStatus },
      });
      await tx.property.update({
        where: { id: propertyId },
        data: {
          status: propertyStatus as import('@prisma/client').$Enums.PropertyStatus,
        },
      });
      return listing;
    });
  },

  async updateListingPhotos(listingId: string, photos: PhotoRecord[]) {
    return prisma.listing.update({
      where: { id: listingId },
      data: { photos: JSON.stringify(photos) },
    });
  },

  async findBySlug(slug: string) {
    return prisma.property.findUnique({ where: { slug } });
  },

  async updateSlug(id: string, slug: string) {
    return prisma.property.update({ where: { id }, data: { slug } });
  },

  async findWithNullSlug() {
    return prisma.property.findMany({ where: { slug: null } });
  },

  async updatePropertyStatus(id: string, status: string) {
    return prisma.property.update({
      where: { id },
      data: { status: status as import('@prisma/client').$Enums.PropertyStatus },
    });
  },

  async saveAiDescription(
    listingId: string,
    data: {
      aiDescription: string;
      description: string;
      aiDescriptionStatus: AiDescriptionStatus;
      aiDescriptionProvider: string;
      aiDescriptionModel: string;
      aiDescriptionGeneratedAt: Date;
      descriptionApprovedAt: null;
    },
  ) {
    return prisma.listing.update({
      where: { id: listingId },
      data,
    });
  },

  // M50: Set aiDescriptionStatus to pending_review when draft is saved
  async updateDescriptionDraft(listingId: string, text: string) {
    return prisma.listing.update({
      where: { id: listingId },
      data: {
        aiDescription: text,
        aiDescriptionStatus: 'pending_review' as AiDescriptionStatus,
      },
    });
  },

  async findListingForDescriptionGeneration(listingId: string) {
    return prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        property: {
          select: {
            flatType: true,
            town: true,
            block: true,
            street: true,
            floorAreaSqm: true,
            level: true,
            leaseCommenceDate: true,
            seller: { select: { agentId: true } },
          },
        },
      },
    });
  },

  async findListingCardData(listingId: string) {
    return prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        status: true,
        photosApprovedAt: true,
        photos: true,
        descriptionApprovedAt: true,
        aiDescription: true,
        description: true,
        portalListings: { select: { status: true } },
        property: {
          select: {
            seller: { select: { agentId: true } },
          },
        },
      },
    });
  },
};

// Named exports to match the function-based calling pattern in tests
export const create = propertyRepository.create.bind(propertyRepository);
export const createPropertyWithListing =
  propertyRepository.createPropertyWithListing.bind(propertyRepository);
export const findByIdWithListings =
  propertyRepository.findByIdWithListings.bind(propertyRepository);
export const findBySellerId = propertyRepository.findBySellerId.bind(propertyRepository);
export const update = propertyRepository.update.bind(propertyRepository);
export const appendPriceHistory = propertyRepository.appendPriceHistory.bind(propertyRepository);
export const createListing = propertyRepository.createListing.bind(propertyRepository);
export const findActiveListingForProperty =
  propertyRepository.findActiveListingForProperty.bind(propertyRepository);
export const updateListingStatus = propertyRepository.updateListingStatus.bind(propertyRepository);
export const updateListingAndPropertyStatus =
  propertyRepository.updateListingAndPropertyStatus.bind(propertyRepository);
export const updateListingPhotos = propertyRepository.updateListingPhotos.bind(propertyRepository);
export const findBySlug = propertyRepository.findBySlug.bind(propertyRepository);
export const updateSlug = propertyRepository.updateSlug.bind(propertyRepository);
export const findWithNullSlug = propertyRepository.findWithNullSlug.bind(propertyRepository);
export const updatePropertyStatus =
  propertyRepository.updatePropertyStatus.bind(propertyRepository);
export const findListingWithSeller =
  propertyRepository.findListingWithSeller.bind(propertyRepository);
export const findByIdWithSeller = propertyRepository.findByIdWithSeller.bind(propertyRepository);
export const saveAiDescription = propertyRepository.saveAiDescription.bind(propertyRepository);
export const updateDescriptionDraft =
  propertyRepository.updateDescriptionDraft.bind(propertyRepository);
export const findListingForDescriptionGeneration =
  propertyRepository.findListingForDescriptionGeneration.bind(propertyRepository);
export const findListingCardData = propertyRepository.findListingCardData.bind(propertyRepository);
