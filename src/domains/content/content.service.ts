// src/domains/content/content.service.ts
import { createId } from '@/infra/database/prisma';
import { NotFoundError, ConflictError } from '@/domains/shared/errors';
import { logger } from '@/infra/logger';
import * as contentRepo from './content.repository';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import type { TutorialCreateInput, TutorialUpdateInput, ReorderItem, HdbTransactionPartial, MarketInsights } from './content.types';
import type { VideoTutorial } from '@prisma/client';

// ─── Video Tutorials ─────────────────────────────────────────────────────────

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip special chars
    .trim()
    .replace(/[\s-]+/g, '-');       // collapse spaces/hyphens
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
    .map(([town, prices]) => ({ town, medianPrice: median(prices), transactionCount: prices.length }))
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
      const changePercent = Math.round(((recentMedian - olderMedian) / olderMedian) * 100 * 10) / 10;
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
    throw new ConflictError(`Market content for period ${period} already exists (status: ${existing.status})`);
  }

  // Query last 3 months of HDB data for trend computation
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const fromMonth = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
  const transactions = await contentRepo.findHdbTransactionsForMonths(fromMonth);

  const insights = aggregateHdbInsights(transactions);
  if (!insights) {
    logger.warn({ period, count: transactions.length }, 'Insufficient HDB data for market content generation');
    return null;
  }

  const { text, provider, model } = await aiFacade.generateText(buildMarketPrompt(insights, period));

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
  return contentRepo.updateMarketContentStatus(id, 'approved', agentId);
}

export async function rejectMarketContent(id: string) {
  return contentRepo.updateMarketContentStatus(id, 'rejected', undefined);
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
// Implemented in Section 4

// ─── Referrals ────────────────────────────────────────────────────────────────
// Implemented in Section 5
