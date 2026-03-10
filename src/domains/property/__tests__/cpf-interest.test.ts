import type { FlatType } from '../financial.types';
import { calculateCpfAccruedInterest, estimateCpfUsage } from '../cpf-interest';

describe('calculateCpfAccruedInterest', () => {
  it('calculates 2.5% p.a. compound interest over 10 years', () => {
    // $100,000 at 2.5% for 10 years: 100000 * (1.025^10 - 1) = $28,008.45
    const result = calculateCpfAccruedInterest(100000, 2016, 2026);
    expect(result).toBeCloseTo(28008.45, 0);
  });

  it('calculates 2.5% p.a. compound interest over 20 years', () => {
    // $100,000 at 2.5% for 20 years: 100000 * (1.025^20 - 1) = $63,861.64
    const result = calculateCpfAccruedInterest(100000, 2006, 2026);
    expect(result).toBeCloseTo(63861.64, 0);
  });

  it('returns 0 for $0 OA used', () => {
    const result = calculateCpfAccruedInterest(0, 2016, 2026);
    expect(result).toBe(0);
  });

  it('returns 0 when purchase year equals current year', () => {
    const result = calculateCpfAccruedInterest(100000, 2026, 2026);
    expect(result).toBe(0);
  });

  it('handles 1 year correctly', () => {
    // $50,000 at 2.5% for 1 year = $1,250
    const result = calculateCpfAccruedInterest(50000, 2025, 2026);
    expect(result).toBeCloseTo(1250, 0);
  });

  it('handles very old purchase (30 years)', () => {
    // $30,000 at 2.5% for 30 years: 30000 * (1.025^30 - 1) = $32,927.03
    const result = calculateCpfAccruedInterest(30000, 1996, 2026);
    expect(result).toBeCloseTo(32927.03, 0);
  });
});

describe('estimateCpfUsage', () => {
  it('estimates based on flat type for 4 ROOM', () => {
    const result = estimateCpfUsage('4 ROOM');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(500000);
  });

  it('estimates higher for EXECUTIVE than 3 ROOM', () => {
    const exec = estimateCpfUsage('EXECUTIVE');
    const threeRoom = estimateCpfUsage('3 ROOM');
    expect(exec).toBeGreaterThan(threeRoom);
  });

  it('returns 0 for unknown flat type', () => {
    expect(estimateCpfUsage('UNKNOWN' as FlatType)).toBe(0);
  });
});
