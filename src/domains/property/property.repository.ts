import { prisma } from '../../infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import { $Enums } from '@prisma/client';
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
};

// Named exports to match the function-based calling pattern in tests
export const create = propertyRepository.create.bind(propertyRepository);
export const findByIdWithListings =
  propertyRepository.findByIdWithListings.bind(propertyRepository);
export const findBySellerId = propertyRepository.findBySellerId.bind(propertyRepository);
export const update = propertyRepository.update.bind(propertyRepository);
export const appendPriceHistory = propertyRepository.appendPriceHistory.bind(propertyRepository);
export const createListing = propertyRepository.createListing.bind(propertyRepository);
export const findActiveListingForProperty =
  propertyRepository.findActiveListingForProperty.bind(propertyRepository);
export const updateListingStatus = propertyRepository.updateListingStatus.bind(propertyRepository);
export const updateListingPhotos = propertyRepository.updateListingPhotos.bind(propertyRepository);
export const findBySlug = propertyRepository.findBySlug.bind(propertyRepository);
export const updateSlug = propertyRepository.updateSlug.bind(propertyRepository);
export const findWithNullSlug = propertyRepository.findWithNullSlug.bind(propertyRepository);
export const updatePropertyStatus =
  propertyRepository.updatePropertyStatus.bind(propertyRepository);
export const findListingWithSeller =
  propertyRepository.findListingWithSeller.bind(propertyRepository);
export const findByIdWithSeller = propertyRepository.findByIdWithSeller.bind(propertyRepository);
