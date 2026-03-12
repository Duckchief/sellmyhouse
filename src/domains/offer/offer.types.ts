import type { OfferStatus } from '@prisma/client';

export type { OfferStatus };

// Valid transitions for offer status state machine
// Only 'pending' offers can be actioned — countered/accepted/rejected are terminal
export const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  pending: ['countered', 'accepted', 'rejected', 'expired'],
  countered: [], // countered offers can't be directly transitioned — a new child offer is created
  accepted: [],
  rejected: [],
  expired: [],
};

// AI analysis status values (domain-specific HITL flow: generated → reviewed → shared)
// Maps to CLAUDE.md canonical: ai_generated → pending_review → approved → sent
export const AI_ANALYSIS_STATUS = {
  GENERATED: 'generated',
  REVIEWED: 'reviewed',
  SHARED: 'shared',
} as const;

export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUS)[keyof typeof AI_ANALYSIS_STATUS];

export interface CreateOfferInput {
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName?: string;
  buyerAgentCeaReg?: string;
  isCoBroke: boolean;
  offerAmount: number;
  notes?: string;
  agentId: string;
}

export interface CounterOfferInput {
  parentOfferId: string;
  counterAmount: number;
  notes?: string;
  agentId: string;
}

export interface OfferWithChain {
  id: string;
  propertyId: string;
  buyerName: string;
  buyerPhone: string;
  buyerAgentName: string | null;
  buyerAgentCeaReg: string | null;
  isCoBroke: boolean;
  offerAmount: string; // Prisma Decimal serializes as string
  counterAmount: string | null;
  status: OfferStatus;
  notes: string | null;
  parentOfferId: string | null;
  aiAnalysis: string | null;
  aiAnalysisProvider: string | null;
  aiAnalysisModel: string | null;
  aiAnalysisStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  counterOffers: OfferWithChain[];
}
