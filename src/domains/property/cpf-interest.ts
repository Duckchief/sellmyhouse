import type { FlatType } from './financial.types';

const CPF_OA_RATE = 0.025; // 2.5% p.a.

export function calculateCpfAccruedInterest(
  cpfUsed: number,
  purchaseYear: number,
  currentYear: number,
): number {
  const years = currentYear - purchaseYear;
  if (years <= 0 || cpfUsed === 0) return 0;
  return Math.round((cpfUsed * (Math.pow(1 + CPF_OA_RATE, years) - 1)) * 100) / 100;
}

// Median CPF OA usage estimates by flat type (SGD)
const CPF_USAGE_ESTIMATES: Record<FlatType, number> = {
  '2 ROOM': 50000,
  '3 ROOM': 100000,
  '4 ROOM': 150000,
  '5 ROOM': 200000,
  EXECUTIVE: 250000,
  'MULTI-GENERATION': 300000,
};

export function estimateCpfUsage(flatType: FlatType): number {
  return CPF_USAGE_ESTIMATES[flatType] ?? 0;
}
