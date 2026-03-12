// src/domains/content/content.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { Prisma } from '@prisma/client';
import type { TutorialCreateInput, TutorialUpdateInput, ReorderItem } from './content.types';

// ─── Video Tutorials ─────────────────────────────────────────────────────────

export async function findAllTutorials() {
  return prisma.videoTutorial.findMany({
    orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }],
  });
}

export async function findTutorialById(id: string) {
  return prisma.videoTutorial.findUnique({ where: { id } });
}

export async function findTutorialBySlug(slug: string) {
  return prisma.videoTutorial.findUnique({ where: { slug } });
}

export async function createTutorial(input: Omit<TutorialCreateInput, 'slug'> & { id: string; slug: string }) {
  return prisma.videoTutorial.create({
    data: {
      id: input.id,
      title: input.title,
      slug: input.slug,
      description: input.description,
      youtubeUrl: input.youtubeUrl,
      category: input.category,
      orderIndex: input.orderIndex ?? 0,
    },
  });
}

export async function updateTutorial(id: string, input: TutorialUpdateInput) {
  return prisma.videoTutorial.update({ where: { id }, data: input });
}

export async function deleteTutorial(id: string): Promise<void> {
  await prisma.videoTutorial.delete({ where: { id } });
}

export async function reorderTutorials(items: ReorderItem[]): Promise<void> {
  await Promise.all(
    items.map((item) =>
      prisma.videoTutorial.update({
        where: { id: item.id },
        data: { orderIndex: item.orderIndex },
      }),
    ),
  );
}

// ─── Market Content ───────────────────────────────────────────────────────────

/** Returns the first non-rejected MarketContent record for the given period, or null. */
export async function findMarketContentByPeriod(period: string) {
  return prisma.marketContent.findFirst({
    where: { period, status: { not: 'rejected' } },
  });
}

export async function findAllMarketContent() {
  return prisma.marketContent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function findMarketContentById(id: string) {
  return prisma.marketContent.findUnique({ where: { id } });
}

export async function createMarketContent(input: {
  id: string;
  town: string;
  flatType: string;
  period: string;
  rawData: object;
  aiNarrative: string;
  aiProvider: string;
  aiModel: string;
  tiktokFormat: string;
  instagramFormat: string;
  linkedinFormat: string;
}) {
  return prisma.marketContent.create({
    data: {
      id: input.id,
      town: input.town,
      flatType: input.flatType,
      period: input.period,
      rawData: input.rawData as Prisma.InputJsonValue,
      aiNarrative: input.aiNarrative,
      aiProvider: input.aiProvider,
      aiModel: input.aiModel,
      tiktokFormat: input.tiktokFormat,
      instagramFormat: input.instagramFormat,
      linkedinFormat: input.linkedinFormat,
      status: 'pending_review',
    },
  });
}

export async function updateMarketContentStatus(
  id: string,
  status: 'approved' | 'rejected',
  agentId?: string,
) {
  return prisma.marketContent.update({
    where: { id },
    data: {
      status,
      approvedByAgentId: status === 'approved' ? agentId : undefined,
      approvedAt: status === 'approved' ? new Date() : undefined,
    },
  });
}

/** Returns HDB transactions where month >= fromMonth (format: YYYY-MM). */
export async function findHdbTransactionsForMonths(fromMonth: string) {
  return prisma.hdbTransaction.findMany({
    where: { month: { gte: fromMonth } },
    select: { month: true, town: true, flatType: true, resalePrice: true },
  });
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

export async function findTestimonialByToken(token: string) {
  return prisma.testimonial.findUnique({ where: { submissionToken: token } });
}

export async function findTestimonialBySeller(sellerId: string) {
  return prisma.testimonial.findFirst({ where: { sellerId } });
}

export async function findAllTestimonials() {
  return prisma.testimonial.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

export async function findFeaturedTestimonials() {
  return prisma.testimonial.findMany({
    where: { status: 'approved', displayOnWebsite: true },
    orderBy: { approvedAt: 'desc' },
    take: 6,
  });
}

export async function createTestimonial(input: {
  id: string;
  sellerId: string;
  transactionId: string;
  sellerName: string;
  sellerTown: string;
  submissionToken: string;
  tokenExpiresAt: Date;
}) {
  return prisma.testimonial.create({ data: input });
}

export async function updateTestimonialSubmission(
  id: string,
  data: { content: string; rating: number; sellerName: string; sellerTown: string; status: 'pending_review' },
) {
  return prisma.testimonial.update({ where: { id }, data });
}

export async function updateTestimonialStatus(
  id: string,
  status: 'approved' | 'rejected',
  agentId?: string,
) {
  return prisma.testimonial.update({
    where: { id },
    data: {
      status,
      approvedByAgentId: status === 'approved' ? agentId : undefined,
      approvedAt: status === 'approved' ? new Date() : undefined,
    },
  });
}

export async function setTestimonialDisplay(id: string, displayOnWebsite: boolean) {
  return prisma.testimonial.update({ where: { id }, data: { displayOnWebsite } });
}

export async function hardDeleteTestimonial(id: string): Promise<void> {
  await prisma.testimonial.delete({ where: { id } });
}

// ─── Referrals ────────────────────────────────────────────────────────────────
// Implemented in Section 5
