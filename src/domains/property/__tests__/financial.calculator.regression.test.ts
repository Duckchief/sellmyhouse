import { calculateNetProceeds } from '../financial.calculator';
import type { FinancialCalculationInput } from '../financial.types';

/**
 * Regression suite for financial calculations.
 * CPF figures are seller-provided — the calculator performs no CPF calculation.
 * Commission is always $1,633.91 (from SystemSetting, passed in as argument).
 */
describe('Financial Calculator — Regression Suite', () => {
  const COMMISSION = 1633.91;

  const makeInput = (overrides: Partial<FinancialCalculationInput>): FinancialCalculationInput => ({
    salePrice: 500000,
    outstandingLoan: 200000,
    ownerCpfs: [{ cpfRefund: 128000 }],
    flatType: '4 ROOM',
    subsidyType: 'subsidised',
    isFirstTimer: false,
    legalFeesEstimate: 2500,
    ...overrides,
  });

  // --- Single owner ---

  it('1. Standard 4-ROOM subsidised, single owner', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION);
    expect(r.ownerCpfRefunds).toEqual([128000]);
    expect(r.totalCpfRefund).toBe(128000);
    expect(r.netCashProceeds).toBeCloseTo(500000 - 200000 - 128000 - 40000 - 1633.91 - 2500, 2);
    expect(r.warnings).toEqual([]);
  });

  it('2. Zero CPF refund (paid cash, no CPF used)', () => {
    const r = calculateNetProceeds(makeInput({ ownerCpfs: [{ cpfRefund: 0 }] }), COMMISSION);
    expect(r.totalCpfRefund).toBe(0);
    expect(r.ownerCpfRefunds).toEqual([0]);
  });

  it('3. Zero outstanding loan', () => {
    const r = calculateNetProceeds(makeInput({ outstandingLoan: 0 }), COMMISSION);
    expect(r.outstandingLoan).toBe(0);
    expect(r.netCashProceeds).toBeGreaterThan(0);
  });

  it('4. Zero loan and zero CPF — only levy, commission, legal', () => {
    const r = calculateNetProceeds(
      makeInput({ outstandingLoan: 0, ownerCpfs: [{ cpfRefund: 0 }] }),
      COMMISSION,
    );
    expect(r.totalDeductions).toBeCloseTo(40000 + 1633.91 + 2500, 2);
  });

  // --- Multiple owners ---

  it('5. Two owners', () => {
    const r = calculateNetProceeds(
      makeInput({ ownerCpfs: [{ cpfRefund: 80000 }, { cpfRefund: 70000 }] }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toEqual([80000, 70000]);
    expect(r.totalCpfRefund).toBe(150000);
  });

  it('6. Three owners', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 700000,
        ownerCpfs: [{ cpfRefund: 50000 }, { cpfRefund: 40000 }, { cpfRefund: 30000 }],
      }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toHaveLength(3);
    expect(r.totalCpfRefund).toBe(120000);
  });

  it('7. Four owners (HDB maximum)', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 800000,
        ownerCpfs: [
          { cpfRefund: 40000 },
          { cpfRefund: 35000 },
          { cpfRefund: 30000 },
          { cpfRefund: 25000 },
        ],
      }),
      COMMISSION,
    );
    expect(r.ownerCpfRefunds).toHaveLength(4);
    expect(r.totalCpfRefund).toBe(130000);
  });

  it('8. ownerCpfRefunds is parallel array to ownerCpfs', () => {
    const ownerCpfs = [{ cpfRefund: 60000 }, { cpfRefund: 55000 }, { cpfRefund: 45000 }];
    const r = calculateNetProceeds(makeInput({ ownerCpfs }), COMMISSION);
    expect(r.ownerCpfRefunds).toEqual([60000, 55000, 45000]);
  });

  // --- Negative net proceeds ---

  it('9. Negative net proceeds — warning, not error', () => {
    const r = calculateNetProceeds(
      makeInput({ salePrice: 100000, outstandingLoan: 300000 }),
      COMMISSION,
    );
    expect(r.netCashProceeds).toBeLessThan(0);
    expect(r.warnings).toContain(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  });

  // --- Resale levy by flat type (subsidised, second-timer) ---

  it('10. 2-ROOM levy = $15,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '2 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(15000);
  });

  it('11. 3-ROOM levy = $30,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '3 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(30000);
  });

  it('12. 5-ROOM levy = $45,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '5 ROOM' }), COMMISSION);
    expect(r.resaleLevy).toBe(45000);
  });

  it('13. EXECUTIVE levy = $50,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: 'EXECUTIVE' }), COMMISSION);
    expect(r.resaleLevy).toBe(50000);
  });

  it('14. Non-subsidised flat — no resale levy', () => {
    const r = calculateNetProceeds(
      makeInput({ flatType: '5 ROOM', subsidyType: 'non_subsidised' }),
      COMMISSION,
    );
    expect(r.resaleLevy).toBe(0);
  });

  it('15. First-timer — no resale levy even if subsidised', () => {
    const r = calculateNetProceeds(makeInput({ isFirstTimer: true }), COMMISSION);
    expect(r.resaleLevy).toBe(0);
  });

  // --- Commission ---

  it('16. Commission passed through unchanged', () => {
    const r = calculateNetProceeds(makeInput({}), 1633.91);
    expect(r.commission).toBe(1633.91);
  });

  // --- Legal fees ---

  it('17. Custom legal fees', () => {
    const r = calculateNetProceeds(makeInput({ legalFeesEstimate: 3000 }), COMMISSION);
    expect(r.legalFees).toBe(3000);
  });

  it('18. Default legal fees when not provided', () => {
    const r = calculateNetProceeds(makeInput({ legalFeesEstimate: undefined }), COMMISSION);
    expect(r.legalFees).toBe(2500);
  });

  // --- Consistency checks ---

  it('19. totalDeductions = sum of all components', () => {
    const r = calculateNetProceeds(
      makeInput({ ownerCpfs: [{ cpfRefund: 80000 }, { cpfRefund: 50000 }] }),
      COMMISSION,
    );
    const expected =
      r.outstandingLoan + r.totalCpfRefund + r.resaleLevy + r.commission + r.legalFees;
    expect(r.totalDeductions).toBeCloseTo(expected, 2);
  });

  it('20. netCashProceeds = salePrice - totalDeductions', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION);
    expect(r.netCashProceeds).toBeCloseTo(r.salePrice - r.totalDeductions, 2);
  });
});
