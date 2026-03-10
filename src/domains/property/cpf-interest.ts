import type { FlatType } from './financial.types';

const CPF_INTEREST_RATE = 0.025; // 2.5% p.a.

/**
 * Calculate CPF accrued interest at 2.5% p.a. compounded annually.
 * Formula: principal × ((1 + rate)^years − 1)
 * Source: https://www.cpf.gov.sg/member/faq/home-ownership/housing-scheme/how-do-i-calculate-the-accrued-interest
 */
export function calculateCpfAccruedInterest(
  oaUsed: number,
  purchaseYear: number,
  currentYear: number,
): number {
  if (oaUsed <= 0 || purchaseYear >= currentYear) return 0;
  const years = currentYear - purchaseYear;
  return Math.round(oaUsed * (Math.pow(1 + CPF_INTEREST_RATE, years) - 1) * 100) / 100;
}

/**
 * Rough CPF usage estimate when seller doesn't know their actual figures.
 * Based on typical downpayment patterns for each flat type.
 * These are conservative estimates — clearly marked as rough in the report.
 */
const ESTIMATED_CPF_USAGE: Record<string, number> = {
  '2 ROOM': 30000,
  '3 ROOM': 60000,
  '4 ROOM': 90000,
  '5 ROOM': 120000,
  EXECUTIVE: 150000,
  'MULTI-GENERATION': 180000,
};

export function estimateCpfUsage(flatType: FlatType): number {
  return ESTIMATED_CPF_USAGE[flatType] ?? 0;
}
