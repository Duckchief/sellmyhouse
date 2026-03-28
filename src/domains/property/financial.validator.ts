import { ValidationError } from '@/domains/shared/errors';
import type {
  FinancialCalculationInput,
  FlatType,
  SubsidyType,
  CpfOwnerInput,
} from './financial.types';

const VALID_FLAT_TYPES: FlatType[] = [
  '2 ROOM',
  '3 ROOM',
  '4 ROOM',
  '5 ROOM',
  'EXECUTIVE',
  'MULTI-GENERATION',
];

const VALID_SUBSIDY_TYPES: SubsidyType[] = ['subsidised', 'non_subsidised'];

const VALID_SEND_CHANNELS = ['whatsapp', 'email', 'in_app'] as const;

/**
 * Validate and parse the financial calculation form submission.
 *
 * CPF inputs: cpfRefund1 (required), cpfRefund2–cpfRefund4 (optional).
 * Each is the seller's combined CPF figure (principal + accrued interest)
 * self-reported from my.cpf.gov.sg → Home Ownership.
 *
 * purchaseYear is no longer accepted — the platform performs no CPF calculations.
 */
export function validateCalculationInput(body: Record<string, unknown>): FinancialCalculationInput {
  // Sale price
  if (!body.salePrice && body.salePrice !== 0) {
    throw new ValidationError('Sale price is required');
  }
  const salePrice = Number(body.salePrice);
  if (isNaN(salePrice) || salePrice <= 0) {
    throw new ValidationError('Sale price must be greater than zero');
  }

  // Outstanding loan
  const outstandingLoan = Number(body.outstandingLoan ?? 0);
  if (isNaN(outstandingLoan) || outstandingLoan < 0) {
    throw new ValidationError('Outstanding loan cannot be negative');
  }

  // Flat type
  const flatType = body.flatType as string;
  if (!VALID_FLAT_TYPES.includes(flatType as FlatType)) {
    throw new ValidationError(`Invalid flat type: ${flatType}`);
  }

  // Subsidy type
  const subsidyType = (body.subsidyType as string) || 'subsidised';
  if (!VALID_SUBSIDY_TYPES.includes(subsidyType as SubsidyType)) {
    throw new ValidationError(`Invalid subsidy type: ${subsidyType}`);
  }

  // CPF owner inputs — cpfRefund1 required, cpfRefund2–4 optional
  const ownerCpfs: CpfOwnerInput[] = [];
  for (let i = 1; i <= 4; i++) {
    const raw = body[`cpfRefund${i}`];
    if (raw === undefined || raw === null || raw === '') {
      if (i === 1) throw new ValidationError('CPF refund for Owner 1 is required');
      break; // owners are contiguous — stop at first gap
    }
    const value = Number(raw);
    if (isNaN(value) || value < 0) {
      throw new ValidationError(`CPF refund for Owner ${i} must be a non-negative number`);
    }
    ownerCpfs.push({ cpfRefund: value });
  }

  // Legal fees
  const legalFeesEstimate =
    body.legalFeesEstimate !== undefined && body.legalFeesEstimate !== ''
      ? Number(body.legalFeesEstimate)
      : undefined;

  if (legalFeesEstimate !== undefined && isNaN(legalFeesEstimate)) {
    throw new ValidationError('Legal fees estimate must be a valid number');
  }
  if (legalFeesEstimate !== undefined && legalFeesEstimate < 0) {
    throw new ValidationError('Legal fees estimate cannot be negative');
  }

  return {
    salePrice,
    outstandingLoan,
    ownerCpfs,
    flatType: flatType as FlatType,
    subsidyType: subsidyType as SubsidyType,
    isFirstTimer: body.isFirstTimer === true || body.isFirstTimer === 'true',
    legalFeesEstimate,
  };
}

export function validateApproveInput(body: Record<string, unknown>): { reviewNotes?: string } {
  return {
    reviewNotes: body.reviewNotes ? String(body.reviewNotes) : undefined,
  };
}

export function validateSendInput(body: Record<string, unknown>): {
  channel: 'whatsapp' | 'email' | 'in_app';
} {
  const channel = (body.channel as string) || 'whatsapp';
  if (!(VALID_SEND_CHANNELS as readonly string[]).includes(channel)) {
    throw new ValidationError(`Invalid channel: ${channel}`);
  }
  return { channel: channel as 'whatsapp' | 'email' | 'in_app' };
}
