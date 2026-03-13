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

export function validateCalculationInput(body: Record<string, unknown>): FinancialCalculationInput {
  const salePrice = Number(body.salePrice);
  if (!body.salePrice && body.salePrice !== 0) {
    throw new ValidationError('Sale price is required');
  }
  if (isNaN(salePrice) || salePrice <= 0) {
    throw new ValidationError('Sale price must be greater than zero');
  }

  const outstandingLoan = Number(body.outstandingLoan ?? 0);
  if (outstandingLoan < 0) {
    throw new ValidationError('Outstanding loan cannot be negative');
  }

  const flatType = body.flatType as string;
  if (!VALID_FLAT_TYPES.includes(flatType as FlatType)) {
    throw new ValidationError(`Invalid flat type: ${flatType}`);
  }

  const subsidyType = (body.subsidyType as string) || 'subsidised';
  if (!VALID_SUBSIDY_TYPES.includes(subsidyType as SubsidyType)) {
    throw new ValidationError(`Invalid subsidy type: ${subsidyType}`);
  }

  // CPF: accept null, "unknown", or a number
  const cpfOaUsed = parseCpfInput(body.cpfOaUsed);
  const purchaseYear = Number(body.purchaseYear) || new Date().getFullYear();

  const owner1Cpf: CpfOwnerInput = {
    oaUsed: cpfOaUsed,
    purchaseYear,
  };

  // Joint owner (optional)
  let owner2Cpf: CpfOwnerInput | undefined;
  if (body.jointOwnerCpfOaUsed !== undefined || body.jointOwnerPurchaseYear !== undefined) {
    owner2Cpf = {
      oaUsed: parseCpfInput(body.jointOwnerCpfOaUsed),
      purchaseYear: Number(body.jointOwnerPurchaseYear) || purchaseYear,
    };
  }

  const legalFeesEstimate =
    body.legalFeesEstimate !== undefined ? Number(body.legalFeesEstimate) : undefined;

  return {
    salePrice,
    outstandingLoan,
    owner1Cpf,
    owner2Cpf,
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

function parseCpfInput(value: unknown): number | null {
  if (value === null || value === undefined || value === 'unknown' || value === '') {
    return null;
  }
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new ValidationError('CPF OA used must be a non-negative number or "unknown"');
  }
  return num;
}
