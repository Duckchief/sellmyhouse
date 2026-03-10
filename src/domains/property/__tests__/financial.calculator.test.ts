import { calculateNetProceeds } from '../financial.calculator';
import type { FinancialCalculationInput } from '../financial.types';

const baseInput: FinancialCalculationInput = {
  salePrice: 500000,
  outstandingLoan: 200000,
  owner1Cpf: { oaUsed: 100000, purchaseYear: 2016 },
  flatType: '4 ROOM',
  subsidyType: 'subsidised',
  isFirstTimer: false,
  legalFeesEstimate: 2500,
};

describe('calculateNetProceeds', () => {
  const commission = 1633.91;
  const currentYear = 2026;

  it('calculates standard case correctly', () => {
    const result = calculateNetProceeds(baseInput, commission, currentYear);

    expect(result.salePrice).toBe(500000);
    expect(result.outstandingLoan).toBe(200000);
    expect(result.owner1Cpf.oaUsed).toBe(100000);
    expect(result.owner1Cpf.accruedInterest).toBeCloseTo(28008.45, 0);
    expect(result.owner1Cpf.totalRefund).toBeCloseTo(128008.45, 0);
    expect(result.owner1Cpf.isEstimated).toBe(false);
    expect(result.resaleLevy).toBe(40000);
    expect(result.commission).toBe(1633.91);
    expect(result.legalFees).toBe(2500);
    expect(result.netCashProceeds).toBeCloseTo(
      500000 - 200000 - 128008.45 - 40000 - 1633.91 - 2500,
      0,
    );
    expect(result.warnings).toEqual([]);
  });

  it('handles zero loan correctly', () => {
    const input = { ...baseInput, outstandingLoan: 0 };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.outstandingLoan).toBe(0);
    expect(result.netCashProceeds).toBeGreaterThan(
      calculateNetProceeds(baseInput, commission, currentYear).netCashProceeds,
    );
  });

  it('handles zero CPF correctly', () => {
    const input = {
      ...baseInput,
      owner1Cpf: { oaUsed: 0, purchaseYear: 2016 },
    };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.owner1Cpf.oaUsed).toBe(0);
    expect(result.owner1Cpf.accruedInterest).toBe(0);
    expect(result.owner1Cpf.totalRefund).toBe(0);
    expect(result.totalCpfRefund).toBe(0);
  });

  it('handles unknown CPF with estimation', () => {
    const input = {
      ...baseInput,
      owner1Cpf: { oaUsed: null, purchaseYear: 2016 },
    };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.owner1Cpf.isEstimated).toBe(true);
    expect(result.owner1Cpf.oaUsed).toBeGreaterThan(0);
    expect(result.warnings).toContain(
      'CPF OA usage was estimated based on flat type. Please check my.cpf.gov.sg for actual figures.',
    );
  });

  it('handles joint owners with separate CPF', () => {
    const input: FinancialCalculationInput = {
      ...baseInput,
      owner2Cpf: { oaUsed: 50000, purchaseYear: 2016 },
    };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.owner2Cpf).toBeDefined();
    expect(result.owner2Cpf!.oaUsed).toBe(50000);
    expect(result.owner2Cpf!.accruedInterest).toBeCloseTo(14004.22, 0);
    expect(result.totalCpfRefund).toBeCloseTo(
      result.owner1Cpf.totalRefund + result.owner2Cpf!.totalRefund,
      2,
    );
  });

  it('shows warning for negative net proceeds', () => {
    const input = {
      ...baseInput,
      salePrice: 100000,
      outstandingLoan: 300000,
    };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.netCashProceeds).toBeLessThan(0);
    expect(result.warnings).toContain(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  });

  it('uses default legal fees when not provided', () => {
    const input = { ...baseInput, legalFeesEstimate: undefined };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.legalFees).toBe(2500);
  });

  it('returns 0 resale levy for non-subsidised flat', () => {
    const input = { ...baseInput, subsidyType: 'non_subsidised' as const };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.resaleLevy).toBe(0);
  });

  it('handles EXECUTIVE flat type', () => {
    const input = { ...baseInput, flatType: 'EXECUTIVE' as const };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.resaleLevy).toBe(50000);
  });

  it('commission is always the value passed in', () => {
    const result = calculateNetProceeds(baseInput, 1633.91, currentYear);
    expect(result.commission).toBe(1633.91);
  });

  it('handles million-dollar flat', () => {
    const input = {
      ...baseInput,
      salePrice: 1200000,
      outstandingLoan: 400000,
      owner1Cpf: { oaUsed: 200000, purchaseYear: 2006 },
    };
    const result = calculateNetProceeds(input, commission, currentYear);
    expect(result.salePrice).toBe(1200000);
    expect(result.netCashProceeds).toBeGreaterThan(0);
  });
});
