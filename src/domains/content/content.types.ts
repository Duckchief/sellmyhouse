// src/domains/content/content.types.ts

// ─── Video Tutorials ─────────────────────────────────────────────────────────

export type VideoCategory = 'photography' | 'forms' | 'process' | 'financial';

export interface TutorialCreateInput {
  title: string;
  slug: string;
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

export type MarketContentStatus = 'ai_generated' | 'pending_review' | 'approved' | 'rejected' | 'published';

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

export type ReferralStatus = 'link_generated' | 'clicked' | 'lead_created' | 'transaction_completed';

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
