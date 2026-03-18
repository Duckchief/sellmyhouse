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

  // ownerCpfs: array of { cpfRefund: number } — seller-provided from my.cpf.gov.sg
  const rawOwnerCpfs = body.ownerCpfs;
  let ownerCpfs: CpfOwnerInput[];

  if (Array.isArray(rawOwnerCpfs) && rawOwnerCpfs.length > 0) {
    if (rawOwnerCpfs.length > 4) {
      throw new ValidationError('ownerCpfs may not have more than 4 entries');
    }
    ownerCpfs = rawOwnerCpfs.map((entry: unknown, idx: number) => {
      const cpfRefund = Number((entry as Record<string, unknown>).cpfRefund ?? 0);
      if (isNaN(cpfRefund) || cpfRefund < 0) {
        throw new ValidationError(`ownerCpfs[${idx}].cpfRefund must be a non-negative number`);
      }
      return { cpfRefund };
    });
  } else {
    // Default: single owner with zero CPF refund
    ownerCpfs = [{ cpfRefund: 0 }];
  }

  const legalFeesEstimate =
    body.legalFeesEstimate !== undefined ? Number(body.legalFeesEstimate) : undefined;

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
