import type {
  FinancialCalculationInput,
  FinancialCalculationOutput,
} from './financial.types';
import { getResaleLevy } from './resale-levy';

const DEFAULT_LEGAL_FEES = 2500;

/**
 * Calculate net cash proceeds from HDB resale.
 *
 * CPF figures are seller-provided (from my.cpf.gov.sg → Home Ownership).
 * The platform performs no CPF calculations — this aligns with HDB's own
 * sales proceeds calculator approach.
 *
 * Formula:
 *   totalCpfRefund  = sum of all owner cpfRefund values
 *   totalDeductions = outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees
 *   netCashProceeds = salePrice − totalDeductions
 */
export function calculateNetProceeds(
  input: FinancialCalculationInput,
  commission: number,
): FinancialCalculationOutput {
  const warnings: string[] = [];

  const ownerCpfRefunds = input.ownerCpfs.map((o) => o.cpfRefund);
  const totalCpfRefund = Math.round(
    ownerCpfRefunds.reduce((sum, r) => sum + r, 0) * 100,
  ) / 100;

  const resaleLevy = getResaleLevy(input.flatType, input.subsidyType, input.isFirstTimer);
  const legalFees = input.legalFeesEstimate ?? DEFAULT_LEGAL_FEES;

  const totalDeductions = Math.round(
    (input.outstandingLoan + totalCpfRefund + resaleLevy + commission + legalFees) * 100,
  ) / 100;

  const netCashProceeds = Math.round((input.salePrice - totalDeductions) * 100) / 100;

  if (netCashProceeds < 0) {
    warnings.push(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  }

  return {
    salePrice: input.salePrice,
    outstandingLoan: input.outstandingLoan,
    ownerCpfRefunds,
    totalCpfRefund,
    resaleLevy,
    commission,
    legalFees,
    totalDeductions,
    netCashProceeds,
    warnings,
  };
}
