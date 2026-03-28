// src/domains/seller/case-flag.types.ts
import type { CaseFlagType, CaseFlagStatus } from '@prisma/client';

export type { CaseFlagType, CaseFlagStatus };

// Note: enum values match the Prisma schema (eip_restriction, pr_quota).
// The spec uses different names (eip_spr_quota, pr_seller) — schema takes precedence.
export const CASE_FLAG_CHECKLISTS: Record<CaseFlagType, string[]> = {
  deceased_estate: [
    'Obtain Grant of Probate or Letters of Administration',
    'Confirm executor/administrator has authority to sell',
    'Check if all beneficiaries consent to the sale',
    'Engage solicitor for estate conveyancing',
    'HDB approval required for estate sale',
  ],
  divorce: [
    'Obtain court order or decree absolute',
    'Confirm asset division agreement covers the HDB flat',
    'Check if co-owner (ex-spouse) signature is required',
    'Verify MOP status for both parties',
    'Engage solicitor if court order involves property transfer',
  ],
  mop_not_met: [
    'Verify MOP date from HDB My Flat Info portal',
    'Listing can only proceed after MOP date has passed',
    'Any disposal before MOP requires explicit HDB approval',
    'Contact HDB if hardship exemption is being considered',
  ],
  eip_restriction: [
    'Check ethnic integration policy limits for this block on HDB resale portal',
    'Verify buyer eligibility against current EIP/SPR quota before accepting offer',
    'Inform all prospective buyers of quota restrictions upfront',
  ],
  pr_quota: [
    'PRs may only own one HDB flat at a time — confirm no concurrent purchase',
    'Different resale levy rules apply — verify applicable amount with HDB',
    'Confirm PR seller eligibility via HDB My Flat Info portal',
  ],
  bank_loan: [
    'Obtain redemption statement from bank with exact outstanding amount',
    'Factor loan redemption amount into financial calculation',
    'Legal fees for loan redemption apply at completion',
    'Coordinate loan redemption timing with solicitor and completion date',
  ],
  court_order: [
    'Obtain certified true copy of court order',
    'Confirm court order explicitly covers authority to sell the HDB flat',
    'Check if any caveat is registered against the property',
    'Engage solicitor experienced in court-ordered property sales',
  ],
  other: [
    'Document the specific circumstance clearly in the description field',
    'Seek appropriate professional or legal advice',
    'Confirm all parties have legal authority to proceed',
  ],
};

export interface CreateCaseFlagInput {
  sellerId: string;
  flagType: CaseFlagType;
  description: string;
  agentId: string;
}

export interface UpdateCaseFlagInput {
  flagId: string;
  status: CaseFlagStatus;
  guidanceProvided?: string;
  agentId: string;
  role?: string;
}
