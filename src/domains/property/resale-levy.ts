import type { FlatType, SubsidyType } from './financial.types';

/**
 * HDB resale levy rates for subsidised flats (second-timers only).
 * Source: https://www.hdb.gov.sg/residential/selling-a-flat/resale-levy
 * Rates as of 2024. Admin can override via SystemSetting if rates change.
 * First-timers and non-subsidised flat purchasers do not pay resale levy.
 */
const SUBSIDISED_LEVY: Record<string, number> = {
  '1 ROOM': 15000,
  '2 ROOM': 15000,
  '3 ROOM': 30000,
  '4 ROOM': 40000,
  '5 ROOM': 45000,
  EXECUTIVE: 50000,
  'MULTI-GENERATION': 50000,
};

/**
 * First-timers do not pay resale levy — only second-timers who previously
 * received a housing subsidy are required to pay.
 */
export function getResaleLevy(
  flatType: FlatType,
  subsidyType: SubsidyType,
  isFirstTimer: boolean,
): number {
  if (subsidyType === 'non_subsidised') return 0;
  if (isFirstTimer) return 0;
  return SUBSIDISED_LEVY[flatType] ?? 0;
}
