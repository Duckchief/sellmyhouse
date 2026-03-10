import { calculateNetProceeds } from '../financial.calculator';
import type { FinancialCalculationInput } from '../financial.types';

/**
 * Regression suite: 26 edge cases for financial calculations.
 * Commission is always $1,633.91 (from SystemSetting).
 */
describe('Financial Calculator — Regression Suite', () => {
  const COMMISSION = 1633.91;
  const CURRENT_YEAR = 2026;

  const makeInput = (overrides: Partial<FinancialCalculationInput>): FinancialCalculationInput => ({
    salePrice: 500000,
    outstandingLoan: 200000,
    owner1Cpf: { oaUsed: 100000, purchaseYear: 2016 },
    flatType: '4 ROOM',
    subsidyType: 'subsidised',
    isFirstTimer: false,
    legalFeesEstimate: 2500,
    ...overrides,
  });

  // --- Standard cases ---

  it('1. Standard 4-ROOM subsidised, known CPF', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION, CURRENT_YEAR);
    expect(r.netCashProceeds).toBeCloseTo(
      500000 - 200000 - (100000 + 100000 * (Math.pow(1.025, 10) - 1)) - 40000 - 1633.91 - 2500,
      0,
    );
    expect(r.warnings).toEqual([]);
  });

  it('2. Standard 3-ROOM subsidised', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 350000,
        outstandingLoan: 100000,
        flatType: '3 ROOM',
        owner1Cpf: { oaUsed: 60000, purchaseYear: 2010 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.resaleLevy).toBe(30000);
    expect(r.netCashProceeds).toBeGreaterThan(0);
  });

  it('3. 5-ROOM non-subsidised (no levy)', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 700000,
        flatType: '5 ROOM',
        subsidyType: 'non_subsidised',
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.resaleLevy).toBe(0);
  });

  // --- Zero deduction cases ---

  it('4. Zero outstanding loan', () => {
    const r = calculateNetProceeds(makeInput({ outstandingLoan: 0 }), COMMISSION, CURRENT_YEAR);
    expect(r.outstandingLoan).toBe(0);
    expect(r.netCashProceeds).toBeGreaterThan(0);
  });

  it('5. Zero CPF usage', () => {
    const r = calculateNetProceeds(
      makeInput({ owner1Cpf: { oaUsed: 0, purchaseYear: 2016 } }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner1Cpf.totalRefund).toBe(0);
    expect(r.totalCpfRefund).toBe(0);
  });

  it('6. Zero loan AND zero CPF', () => {
    const r = calculateNetProceeds(
      makeInput({
        outstandingLoan: 0,
        owner1Cpf: { oaUsed: 0, purchaseYear: 2016 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    // Only deductions: levy + commission + legal
    expect(r.totalDeductions).toBeCloseTo(40000 + 1633.91 + 2500, 2);
  });

  // --- Unknown CPF ---

  it('7. Unknown CPF usage → estimated', () => {
    const r = calculateNetProceeds(
      makeInput({ owner1Cpf: { oaUsed: null, purchaseYear: 2016 } }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner1Cpf.isEstimated).toBe(true);
    expect(r.owner1Cpf.oaUsed).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  // --- Joint owners ---

  it('8. Joint owners, both known CPF', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner1Cpf: { oaUsed: 80000, purchaseYear: 2016 },
        owner2Cpf: { oaUsed: 70000, purchaseYear: 2016 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner2Cpf).toBeDefined();
    expect(r.totalCpfRefund).toBeCloseTo(
      r.owner1Cpf.totalRefund + r.owner2Cpf!.totalRefund,
      2,
    );
  });

  it('9. Joint owners, one unknown CPF', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner1Cpf: { oaUsed: 80000, purchaseYear: 2016 },
        owner2Cpf: { oaUsed: null, purchaseYear: 2016 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner1Cpf.isEstimated).toBe(false);
    expect(r.owner2Cpf!.isEstimated).toBe(true);
  });

  it('10. Joint owners, both unknown CPF', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner1Cpf: { oaUsed: null, purchaseYear: 2016 },
        owner2Cpf: { oaUsed: null, purchaseYear: 2016 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner1Cpf.isEstimated).toBe(true);
    expect(r.owner2Cpf!.isEstimated).toBe(true);
  });

  // --- Negative net proceeds ---

  it('11. Negative net proceeds — warning, not error', () => {
    const r = calculateNetProceeds(
      makeInput({ salePrice: 100000, outstandingLoan: 300000 }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.netCashProceeds).toBeLessThan(0);
    expect(r.warnings).toContain(
      'Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures.',
    );
  });

  // --- Resale levy for every flat type (subsidised, second-timer) ---

  it('12. 2-ROOM levy = $15,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '2 ROOM' }), COMMISSION, CURRENT_YEAR);
    expect(r.resaleLevy).toBe(15000);
  });

  it('13. 3-ROOM levy = $30,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '3 ROOM' }), COMMISSION, CURRENT_YEAR);
    expect(r.resaleLevy).toBe(30000);
  });

  it('14. 5-ROOM levy = $45,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: '5 ROOM' }), COMMISSION, CURRENT_YEAR);
    expect(r.resaleLevy).toBe(45000);
  });

  it('15. EXECUTIVE levy = $50,000', () => {
    const r = calculateNetProceeds(makeInput({ flatType: 'EXECUTIVE' }), COMMISSION, CURRENT_YEAR);
    expect(r.resaleLevy).toBe(50000);
  });

  it('16. MULTI-GENERATION levy = $50,000', () => {
    const r = calculateNetProceeds(
      makeInput({ flatType: 'MULTI-GENERATION' }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.resaleLevy).toBe(50000);
  });

  it('17. First-timer pays no resale levy even if subsidised', () => {
    const r = calculateNetProceeds(makeInput({ isFirstTimer: true }), COMMISSION, CURRENT_YEAR);
    expect(r.resaleLevy).toBe(0);
  });

  // --- Commission ---

  it('18. Commission is always $1,633.91', () => {
    const r = calculateNetProceeds(makeInput({}), 1633.91, CURRENT_YEAR);
    expect(r.commission).toBe(1633.91);
  });

  it('19. GST calculation: $1,499 × 1.09 = $1,633.91', () => {
    const amount = 1499;
    const gstRate = 0.09;
    const gstAmount = Math.round(amount * gstRate * 100) / 100;
    const total = Math.round((amount + gstAmount) * 100) / 100;
    expect(total).toBe(1633.91);
  });

  // --- Old lease / old purchase ---

  it('20. Old lease (1985 purchase, 40+ years of CPF interest)', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner1Cpf: { oaUsed: 30000, purchaseYear: 1985 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    // 41 years of interest on $30,000
    expect(r.owner1Cpf.accruedInterest).toBeGreaterThan(50000);
  });

  it('21. Very recent purchase (2025), minimal interest', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner1Cpf: { oaUsed: 100000, purchaseYear: 2025 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.owner1Cpf.accruedInterest).toBeCloseTo(2500, 0);
  });

  // --- Million-dollar flat ---

  it('22. Million-dollar flat', () => {
    const r = calculateNetProceeds(
      makeInput({
        salePrice: 1500000,
        outstandingLoan: 500000,
        owner1Cpf: { oaUsed: 250000, purchaseYear: 2010 },
        flatType: '5 ROOM',
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.salePrice).toBe(1500000);
    expect(r.netCashProceeds).toBeGreaterThan(0);
  });

  // --- Legal fees ---

  it('23. Custom legal fees', () => {
    const r = calculateNetProceeds(makeInput({ legalFeesEstimate: 3000 }), COMMISSION, CURRENT_YEAR);
    expect(r.legalFees).toBe(3000);
  });

  it('24. Default legal fees when not provided', () => {
    const r = calculateNetProceeds(
      makeInput({ legalFeesEstimate: undefined }),
      COMMISSION,
      CURRENT_YEAR,
    );
    expect(r.legalFees).toBe(2500);
  });

  // --- Consistency checks ---

  it('25. totalDeductions = sum of all deduction components', () => {
    const r = calculateNetProceeds(
      makeInput({
        owner2Cpf: { oaUsed: 50000, purchaseYear: 2016 },
      }),
      COMMISSION,
      CURRENT_YEAR,
    );
    const expectedTotal =
      r.outstandingLoan + r.totalCpfRefund + r.resaleLevy + r.commission + r.legalFees;
    expect(r.totalDeductions).toBeCloseTo(expectedTotal, 2);
  });

  it('26. netCashProceeds = salePrice - totalDeductions', () => {
    const r = calculateNetProceeds(makeInput({}), COMMISSION, CURRENT_YEAR);
    expect(r.netCashProceeds).toBeCloseTo(r.salePrice - r.totalDeductions, 2);
  });
});
