import type {
  FinancialCalculationInput,
  FinancialCalculationOutput,
  CpfBreakdown,
} from './financial.types';
import { calculateCpfAccruedInterest, estimateCpfUsage } from './cpf-interest';
import { getResaleLevy } from './resale-levy';

const DEFAULT_LEGAL_FEES = 2500;

export function calculateNetProceeds(
  input: FinancialCalculationInput,
  commission: number,
  currentYear: number,
): FinancialCalculationOutput {
  const warnings: string[] = [];

  // CPF Owner 1
  const owner1Cpf = calculateCpfBreakdown(
    input.owner1Cpf.oaUsed,
    input.owner1Cpf.purchaseYear,
    currentYear,
    input.flatType,
    warnings,
  );

  // CPF Owner 2 (optional joint owner)
  let owner2Cpf: CpfBreakdown | undefined;
  if (input.owner2Cpf) {
    owner2Cpf = calculateCpfBreakdown(
      input.owner2Cpf.oaUsed,
      input.owner2Cpf.purchaseYear,
      currentYear,
      input.flatType,
      warnings,
    );
  }

  const totalCpfRefund = owner1Cpf.totalRefund + (owner2Cpf?.totalRefund ?? 0);
  const resaleLevy = getResaleLevy(input.flatType, input.subsidyType, input.isFirstTimer);
  const legalFees = input.legalFeesEstimate ?? DEFAULT_LEGAL_FEES;

  const totalDeductions =
    input.outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees;

  const netCashProceeds = Math.round((input.salePrice - totalDeductions) * 100) / 100;

  if (netCashProceeds < 0) {
    warnings.push(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  }

  return {
    salePrice: input.salePrice,
    outstandingLoan: input.outstandingLoan,
    owner1Cpf,
    owner2Cpf,
    totalCpfRefund: Math.round(totalCpfRefund * 100) / 100,
    resaleLevy,
    commission,
    legalFees,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netCashProceeds,
    warnings,
  };
}

function calculateCpfBreakdown(
  oaUsed: number | null,
  purchaseYear: number,
  currentYear: number,
  flatType: string,
  warnings: string[],
): CpfBreakdown {
  const isEstimated = oaUsed === null;
  const actualOaUsed = oaUsed ?? estimateCpfUsage(flatType as any);

  if (isEstimated && actualOaUsed > 0) {
    warnings.push(
      'CPF OA usage was estimated based on flat type. Please check my.cpf.gov.sg for actual figures.',
    );
  }

  const accruedInterest = calculateCpfAccruedInterest(actualOaUsed, purchaseYear, currentYear);

  return {
    oaUsed: actualOaUsed,
    accruedInterest,
    totalRefund: Math.round((actualOaUsed + accruedInterest) * 100) / 100,
    isEstimated,
  };
}
