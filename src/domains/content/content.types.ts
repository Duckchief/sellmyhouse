// src/domains/content/content.types.ts
//
// Content domain — market content, testimonials, referrals, video tutorials.
//
// REGULATORY NOTE — CEA PG 2/2011 Section 7.3 (Social Network Advertising):
// Any social media accounts (Facebook, Instagram, TikTok, LinkedIn, etc.) used
// to post estate agency content must display the estate agent licence number
// (Huttons: L3008899K) and salesperson registration number in the account profile.
//
// The agent is responsible for ensuring their social media profiles comply
// before manually posting approved MarketContent to those platforms.
// This applies to ALL accounts used for property marketing, not just the
// official sellmyhomenow.sg accounts.

// ─── Video Tutorials ─────────────────────────────────────────────────────────

export type VideoCategory = 'photography' | 'forms' | 'process' | 'financial';

export interface TutorialCreateInput {
  title: string;
  slug?: string;
  description?: string;
  youtubeUrl: string;
  category: VideoCategory;
  orderIndex?: number;
}

export interface TutorialUpdateInput {
  title?: string;
  slug?: string;
  description?: string;
  youtubeUrl?: string;
  category?: VideoCategory;
  orderIndex?: number;
}

export interface ReorderItem {
  id: string;
  orderIndex: number;
}

// ─── Market Content ───────────────────────────────────────────────────────────

/** Minimal HDB transaction shape used by aggregation (compatible with Prisma.Decimal) */
export interface HdbTransactionPartial {
  month: string;
  town: string;
  flatType: string;
  resalePrice: { toNumber(): number };
}

export type MarketContentStatus =
  | 'ai_generated'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published';

export interface TownMedianPrice {
  town: string;
  medianPrice: number;
  transactionCount: number;
}

export interface MillionDollarSummary {
  count: number;
  examples: Array<{ town: string; flatType: string; price: number }>;
}

export interface FlatTypeTrend {
  flatType: string;
  direction: 'rising' | 'falling' | 'stable';
  changePercent: number;
}

export interface MarketInsights {
  topTowns: TownMedianPrice[];
  millionDollar: MillionDollarSummary;
  trends: FlatTypeTrend[];
}

export interface SocialFormats {
  tiktok: string;
  instagram: string;
  linkedin: string;
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

export type TestimonialStatus = 'pending_submission' | 'pending_review' | 'approved' | 'rejected';

export interface TestimonialSubmitInput {
  content: string;
  rating: number;
  sellerName: string;
  sellerTown: string;
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export type ReferralStatus =
  | 'link_generated'
  | 'clicked'
  | 'lead_created'
  | 'transaction_completed';

export interface ReferralFunnel {
  linksGenerated: number;
  clicked: number;
  leadsCreated: number;
  transactionsCompleted: number;
}

export interface TopReferrer {
  sellerId: string;
  sellerName: string;
  clicks: number;
  leadsCreated: number;
  transactionsCompleted: number;
}
