// src/domains/content/content.service.ts
import { createId } from '@/infra/database/prisma';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from '@/domains/shared/errors';
import { logger } from '@/infra/logger';
import * as contentRepo from './content.repository';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import { AIUnavailableError } from '@/domains/shared/ai/ai.facade';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import type {
  TutorialCreateInput,
  TutorialUpdateInput,
  ReorderItem,
  HdbTransactionPartial,
  MarketInsights,
  TestimonialSubmitInput,
} from './content.types';
import type { VideoTutorial } from '@prisma/client';

// ─── Video Tutorials ─────────────────────────────────────────────────────────

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // strip special chars
    .trim()
    .replace(/[\s-]+/g, '-'); // collapse spaces/hyphens
}

export async function getTutorialsGrouped(): Promise<Record<string, VideoTutorial[]>> {
  const tutorials = await contentRepo.findAllTutorials();
  return tutorials.reduce((acc: Record<string, VideoTutorial[]>, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});
}

export async function getTutorialById(id: string) {
  const tutorial = await contentRepo.findTutorialById(id);
  if (!tutorial) throw new NotFoundError('VideoTutorial', id);
  return tutorial;
}

export async function createTutorial(input: TutorialCreateInput) {
  const slug = input.slug ?? generateSlug(input.title);
  const existing = await contentRepo.findTutorialBySlug(slug);
  if (existing) throw new ConflictError(`Slug "${slug}" is already in use`);

  return contentRepo.createTutorial({ ...input, slug, id: createId() });
}

export async function updateTutorial(id: string, input: TutorialUpdateInput) {
  const tutorial = await contentRepo.findTutorialById(id);
  if (!tutorial) throw new NotFoundError('VideoTutorial', id);

  if (input.slug && input.slug !== tutorial.slug) {
    const existing = await contentRepo.findTutorialBySlug(input.slug);
    if (existing && existing.id !== id) {
      throw new ConflictError(`Slug "${input.slug}" is already in use`);
    }
  }

  return contentRepo.updateTutorial(id, input);
}

export async function deleteTutorial(id: string): Promise<void> {
  const tutorial = await contentRepo.findTutorialById(id);
  if (!tutorial) throw new NotFoundError('VideoTutorial', id);
  await contentRepo.deleteTutorial(id);
}

export async function reorderTutorials(items: ReorderItem[]): Promise<void> {
  await contentRepo.reorderTutorials(items);
}

// ─── Market Content ───────────────────────────────────────────────────────────

/** Returns ISO week string for the given date, e.g. "2026-W11". */
export function getIsoWeekPeriod(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Aggregates HDB transaction data into market insights.
 * Returns null if fewer than 10 transactions are provided.
 *
 * Trend direction is computed by splitting transactions into two halves by month
 * (older vs more recent) and comparing median prices per flat type.
 */
export function aggregateHdbInsights(transactions: HdbTransactionPartial[]): MarketInsights | null {
  if (transactions.length < 10) return null;

  // Group by town for top towns
  const byTown = new Map<string, number[]>();
  for (const t of transactions) {
    const price = t.resalePrice.toNumber();
    if (!byTown.has(t.town)) byTown.set(t.town, []);
    byTown.get(t.town)!.push(price);
  }
  const topTowns = [...byTown.entries()]
    .map(([town, prices]) => ({
      town,
      medianPrice: median(prices),
      transactionCount: prices.length,
    }))
    .sort((a, b) => b.medianPrice - a.medianPrice)
    .slice(0, 5);

  // Million-dollar flats
  const millionDollar = transactions.filter((t) => t.resalePrice.toNumber() >= 1_000_000);
  const millionDollarSummary = {
    count: millionDollar.length,
    examples: millionDollar.slice(0, 3).map((t) => ({
      town: t.town,
      flatType: t.flatType,
      price: t.resalePrice.toNumber(),
    })),
  };

  // Trend: split by month into older vs recent halves
  const months = [...new Set(transactions.map((t) => t.month))].sort();
  const cutoffIdx = Math.floor(months.length / 2);
  const recentMonths = new Set(months.slice(cutoffIdx));

  const byFlatType = new Map<string, { older: number[]; recent: number[] }>();
  for (const t of transactions) {
    if (!byFlatType.has(t.flatType)) byFlatType.set(t.flatType, { older: [], recent: [] });
    const bucket = recentMonths.has(t.month) ? 'recent' : 'older';
    byFlatType.get(t.flatType)![bucket].push(t.resalePrice.toNumber());
  }

  const trends = [...byFlatType.entries()]
    .filter(([, { older, recent }]) => older.length > 0 && recent.length > 0)
    .map(([flatType, { older, recent }]) => {
      const olderMedian = median(older);
      const recentMedian = median(recent);
      const changePercent =
        Math.round(((recentMedian - olderMedian) / olderMedian) * 100 * 10) / 10;
      const direction: 'rising' | 'falling' | 'stable' =
        changePercent >= 5 ? 'rising' : changePercent <= -5 ? 'falling' : 'stable';
      return { flatType, direction, changePercent };
    });

  return { topTowns, millionDollar: millionDollarSummary, trends };
}

/** Trims text to at most `limit` characters. */
export function trimToCharLimit(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

function buildMarketPrompt(insights: MarketInsights, period: string): string {
  return `You are a Singapore HDB property market analyst. Based on the following HDB resale market data for ${period}, generate content.

Respond with ONLY a JSON object (no markdown, no extra text) with these exact keys:
- "narrative": 2-3 sentence plain English summary for a property agent audience
- "tiktok": ≤ 150 characters, exactly 3 hashtags, casual tone
- "instagram": ≤ 300 characters, exactly 5 hashtags, include "Based on HDB resale data — sellmyhomenow.sg"
- "linkedin": professional tone, ≤ 700 characters, include "Based on HDB resale data — sellmyhomenow.sg"

Market data:
${JSON.stringify(insights, null, 2)}`;
}

/**
 * Runs the market content generation pipeline for the given ISO week period.
 * - Throws ConflictError if a non-rejected record already exists for the period.
 * - Returns null if fewer than 10 HDB transactions exist (logs warning).
 * - Creates a pending_review MarketContent record on success.
 */
export async function generateMarketContent(period: string) {
  const existing = await contentRepo.findMarketContentByPeriod(period);
  if (existing) {
    throw new ConflictError(
      `Market content for period ${period} already exists (status: ${existing.status})`,
    );
  }

  // Query last 3 months of HDB data for trend computation
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const fromMonth = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
  const transactions = await contentRepo.findHdbTransactionsForMonths(fromMonth);

  const insights = aggregateHdbInsights(transactions);
  if (!insights) {
    logger.warn(
      { period, count: transactions.length },
      'Insufficient HDB data for market content generation',
    );
    return null;
  }

  let text: string;
  let provider: string;
  let model: string;

  try {
    const result = await aiFacade.generateText(buildMarketPrompt(insights, period));
    text = result.text;
    provider = result.provider;
    model = result.model;
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      logger.warn({ period, err }, 'AI unavailable for market content — skipping generation');
      await auditService.log({
        action: 'market_content.ai_unavailable',
        entityType: 'market_content',
        entityId: period,
        details: { error: (err as Error).message },
      });
      return null;
    }
    throw err;
  }

  let parsed: { narrative: string; tiktok: string; instagram: string; linkedin: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    logger.warn({ period }, 'AI response was not valid JSON; storing raw text as narrative');
    parsed = { narrative: text, tiktok: '', instagram: '', linkedin: '' };
  }

  return contentRepo.createMarketContent({
    id: createId(),
    town: 'ALL',
    flatType: 'ALL',
    period,
    rawData: insights,
    aiNarrative: parsed.narrative ?? '',
    aiProvider: provider,
    aiModel: model,
    tiktokFormat: trimToCharLimit(parsed.tiktok ?? '', 150),
    instagramFormat: trimToCharLimit(parsed.instagram ?? '', 300),
    linkedinFormat: trimToCharLimit(parsed.linkedin ?? '', 700),
  });
}

export async function listMarketContent() {
  return contentRepo.findAllMarketContent();
}

export async function getMarketContentById(id: string) {
  const record = await contentRepo.findMarketContentById(id);
  if (!record) throw new NotFoundError('MarketContent', id);
  return record;
}

export async function approveMarketContent(id: string, agentId: string) {
  // Reminder: PG 2/2011 s7.3 — ensure your social media profile displays
  // CEA licence number and salesperson registration number before posting.
  return contentRepo.updateMarketContentStatus(id, 'approved', agentId);
}

export async function rejectMarketContent(id: string) {
  return contentRepo.updateMarketContentStatus(id, 'rejected', undefined);
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

/** Returns "First L." format, e.g. "John Thomas" → "John T.", "Mary Jane Watson" → "Mary W." */
export function formatDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Issues a submission token for a completed transaction. */
export async function issueTestimonialToken(
  sellerId: string,
  transactionId: string,
  sellerName: string,
  sellerTown: string,
) {
  const token = createId();
  const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  return contentRepo.createTestimonial({
    id: createId(),
    sellerId,
    transactionId,
    sellerName: formatDisplayName(sellerName),
    sellerTown,
    submissionToken: token,
    tokenExpiresAt,
  });
}

/** Submits a testimonial via the public token link. */
export async function submitTestimonial(token: string, input: TestimonialSubmitInput) {
  const testimonial = await contentRepo.findTestimonialByToken(token);
  if (!testimonial) throw new NotFoundError('Testimonial', token);
  if (!testimonial.tokenExpiresAt || testimonial.tokenExpiresAt < new Date())
    throw new ValidationError('This submission link has expired');
  if (testimonial.status !== 'pending_submission')
    throw new ValidationError('This testimonial has already been submitted');

  return contentRepo.updateTestimonialSubmission(testimonial.id, {
    content: input.content,
    rating: input.rating,
    sellerName: input.sellerName,
    sellerTown: input.sellerTown,
    status: 'pending_review' as const,
  });
}

/** Hard-deletes a seller's testimonial (PDPA removal request). No-op if none exists. */
export async function removeTestimonial(sellerId: string): Promise<void> {
  const testimonial = await contentRepo.findTestimonialBySeller(sellerId);
  if (!testimonial) return;
  await contentRepo.hardDeleteTestimonial(testimonial.id);
  void auditService.log({
    action: 'testimonial_removed',
    entityType: 'testimonial',
    entityId: testimonial.id,
    details: { sellerId, reason: 'seller_requested' },
  });
}

export async function getTestimonialByToken(token: string) {
  return contentRepo.findTestimonialByToken(token);
}

export async function getTestimonialBySeller(sellerId: string) {
  return contentRepo.findTestimonialBySeller(sellerId);
}

export async function listTestimonials() {
  return contentRepo.findAllTestimonials();
}

export async function getFeaturedTestimonials() {
  return contentRepo.findFeaturedTestimonials();
}

export async function approveTestimonial(id: string, agentId: string) {
  return contentRepo.updateTestimonialStatus(id, 'approved', agentId);
}

export async function rejectTestimonial(id: string, agentId?: string, reason?: string) {
  const testimonial = await contentRepo.updateTestimonialStatus(id, 'rejected');
  void notificationService.send(
    {
      recipientType: 'seller',
      recipientId: testimonial.sellerId,
      templateName: 'testimonial_rejected',
      templateData: {
        reason: reason ?? 'Your testimonial did not meet our publication guidelines.',
      },
    },
    agentId ?? 'system',
  );
  return testimonial;
}

export async function featureTestimonial(id: string, displayOnWebsite: boolean) {
  const testimonial = await contentRepo.findTestimonialById(id);
  if (!testimonial) throw new NotFoundError('Testimonial', id);
  if (testimonial.status !== 'approved') {
    throw new ValidationError('Only approved testimonials can be featured');
  }
  return contentRepo.setTestimonialDisplay(id, displayOnWebsite);
}

// ─── Referrals ────────────────────────────────────────────────────────────────

const REFERRAL_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Generates a unique 8-character URL-safe referral code. */
export function generateReferralCode(): string {
  return Array.from(
    { length: 8 },
    () => REFERRAL_CHARSET[Math.floor(Math.random() * REFERRAL_CHARSET.length)],
  ).join('');
}

/** Returns the seller's referral record, creating one if it doesn't exist. */
export async function sendReferralLinks(referrerSellerId: string) {
  const existing = await contentRepo.findReferralBySellerId(referrerSellerId);
  if (existing) return existing;

  return contentRepo.createReferral({
    id: createId(),
    referrerSellerId,
    referralCode: generateReferralCode(),
  });
}

/**
 * Atomically increments click count for the referral code.
 * Transitions status from link_generated → clicked on the very first click.
 */
export async function trackReferralClick(referralCode: string): Promise<void> {
  const updated = await contentRepo.incrementClickCount(referralCode);
  if (!updated) return;
  if (updated.clickCount === 1 && updated.status === 'link_generated') {
    await contentRepo.updateReferralStatus(updated.id, 'clicked');
  }
}

/** Links the newly created seller to a referral, transitioning it to lead_created. */
export async function linkReferralToLead(referralCode: string, newSellerId: string): Promise<void> {
  const referral = await contentRepo.findReferralByCode(referralCode);
  if (!referral) return;
  if (referral.referrerSellerId === newSellerId) return; // self-referral — silently ignore
  await contentRepo.linkReferredSeller(referral.id, newSellerId);
}

/** Marks a referral transaction_completed when the referred seller completes a transaction. */
export async function markReferralTransactionComplete(referredSellerId: string): Promise<void> {
  const referral = await contentRepo.findReferralByReferredSeller(referredSellerId);
  if (!referral) return;
  await contentRepo.updateReferralStatus(referral.id, 'transaction_completed');
}

export async function getReferralFunnel() {
  return contentRepo.getReferralFunnel();
}

export async function getTopReferrers() {
  return contentRepo.getTopReferrers();
}

export async function listReferrals() {
  return contentRepo.findAllReferrals();
}
