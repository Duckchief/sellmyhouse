// src/domains/content/content.repository.ts
import { prisma } from '@/infra/database/prisma';
import type { Prisma, MarketContentStatus, TestimonialStatus } from '@prisma/client';
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

export async function createTutorial(
  input: Omit<TutorialCreateInput, 'slug'> & { id: string; slug: string },
) {
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

export async function findAllMarketContent(status?: string) {
  return prisma.marketContent.findMany({
    where: status ? { status: status as MarketContentStatus } : undefined,
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

export async function findTestimonialById(id: string) {
  return prisma.testimonial.findUnique({ where: { id } });
}

export async function findTestimonialBySeller(sellerId: string) {
  return prisma.testimonial.findFirst({ where: { sellerId } });
}

export async function findAllTestimonials(status?: string) {
  return prisma.testimonial.findMany({
    where: status ? { status: status as TestimonialStatus } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function countTestimonialsByStatus(status: string): Promise<number> {
  return prisma.testimonial.count({
    where: { status: status as TestimonialStatus },
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
  clientName: string;
  clientTown: string;
  submissionToken: string;
  tokenExpiresAt: Date;
  clientType?: 'seller' | 'buyer';
}) {
  return prisma.testimonial.create({ data: input });
}

export async function createManualTestimonial(input: {
  id: string;
  clientName: string;
  clientTown: string;
  rating: number;
  content: string;
  source?: string | null;
  isManual: true;
  status: 'pending_review';
  createdByAgentId: string;
  sellerId: null;
  buyerId: null;
  transactionId: null;
}) {
  return prisma.testimonial.create({ data: input });
}

export async function updateTestimonialSubmission(
  id: string,
  data: {
    content: string;
    rating: number;
    clientName: string;
    clientTown: string;
    status: 'pending_review';
  },
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

export async function reissueTestimonialToken(id: string, token: string, tokenExpiresAt: Date) {
  return prisma.testimonial.update({
    where: { id },
    data: {
      status: 'pending_submission',
      submissionToken: token,
      tokenExpiresAt,
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

export async function createReferral(input: {
  id: string;
  referrerSellerId: string;
  referralCode: string;
}) {
  return prisma.referral.create({ data: input });
}

export async function findReferralByCode(referralCode: string) {
  return prisma.referral.findUnique({ where: { referralCode } });
}

export async function findReferralBySellerId(referrerSellerId: string) {
  return prisma.referral.findFirst({ where: { referrerSellerId } });
}

export async function findReferralByReferredSeller(referredSellerId: string) {
  return prisma.referral.findFirst({ where: { referredSellerId } });
}

export async function findAllReferrals() {
  return prisma.referral.findMany({ orderBy: { createdAt: 'desc' } });
}

/** Returns referrals that are in lead_created status and whose referred seller
 *  has at least one completed transaction — used by the daily completion job. */
export async function findReferralsWithCompletedTransactions() {
  return prisma.referral.findMany({
    where: {
      status: 'lead_created',
      referredSellerId: { not: null },
      referredSeller: {
        transactions: { some: { status: 'completed' } },
      },
    },
  });
}

/** Atomically increments click count. Returns null if code not found. */
export async function incrementClickCount(referralCode: string) {
  try {
    return await prisma.referral.update({
      where: { referralCode },
      data: { clickCount: { increment: 1 } },
    });
  } catch {
    return null;
  }
}

export async function linkReferredSeller(id: string, referredSellerId: string) {
  return prisma.referral.update({
    where: { id },
    data: { referredSellerId, status: 'lead_created', convertedAt: new Date() },
  });
}

export async function updateReferralStatus(
  id: string,
  status: 'clicked' | 'lead_created' | 'transaction_completed',
) {
  return prisma.referral.update({ where: { id }, data: { status } });
}

export async function getReferralFunnel() {
  const [linksGenerated, clicked, leadsCreated, transactionsCompleted] = await Promise.all([
    prisma.referral.count(),
    prisma.referral.count({
      where: { status: { in: ['clicked', 'lead_created', 'transaction_completed'] } },
    }),
    prisma.referral.count({ where: { status: { in: ['lead_created', 'transaction_completed'] } } }),
    prisma.referral.count({ where: { status: 'transaction_completed' } }),
  ]);
  return { linksGenerated, clicked, leadsCreated, transactionsCompleted };
}

export async function getTopReferrers(limit = 10) {
  return prisma.referral.findMany({
    where: { clickCount: { gt: 0 } },
    orderBy: { clickCount: 'desc' },
    take: limit,
    include: {
      referrer: { select: { id: true, name: true } },
    },
  });
}

export async function deleteReferralsByReferrer(referrerSellerId: string): Promise<void> {
  await prisma.referral.deleteMany({ where: { referrerSellerId } });
}

export async function nullifyReferredSeller(referredSellerId: string): Promise<void> {
  await prisma.referral.updateMany({
    where: { referredSellerId },
    data: { referredSellerId: null },
  });
}
