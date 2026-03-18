import { validateCalculationInput } from '../financial.validator';
import { ValidationError } from '@/domains/shared/errors';

describe('validateCalculationInput', () => {
  const base = {
    salePrice: '500000',
    outstandingLoan: '200000',
    cpfRefund1: '128000',
    flatType: '4 ROOM',
    subsidyType: 'subsidised',
    isFirstTimer: 'false',
  };

  it('parses single owner correctly', () => {
    const result = validateCalculationInput(base);
    expect(result.ownerCpfs).toEqual([{ cpfRefund: 128000 }]);
  });

  it('parses up to 4 owners', () => {
    const result = validateCalculationInput({
      ...base,
      cpfRefund2: '70000',
      cpfRefund3: '50000',
      cpfRefund4: '30000',
    });
    expect(result.ownerCpfs).toHaveLength(4);
    expect(result.ownerCpfs[3].cpfRefund).toBe(30000);
  });

  it('allows cpfRefund of 0 (paid cash)', () => {
    const result = validateCalculationInput({ ...base, cpfRefund1: '0' });
    expect(result.ownerCpfs[0].cpfRefund).toBe(0);
  });

  it('throws ValidationError when no CPF refund provided', () => {
    const { cpfRefund1, ...withoutCpf } = base;
    expect(() => validateCalculationInput(withoutCpf)).toThrow(ValidationError);
  });

  it('throws ValidationError when cpfRefund is negative', () => {
    expect(() => validateCalculationInput({ ...base, cpfRefund1: '-1000' })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when salePrice is missing', () => {
    const { salePrice, ...withoutPrice } = base;
    expect(() => validateCalculationInput(withoutPrice)).toThrow(ValidationError);
  });

  it('throws ValidationError when salePrice is zero', () => {
    expect(() => validateCalculationInput({ ...base, salePrice: '0' })).toThrow(ValidationError);
  });

  it('throws ValidationError when outstandingLoan is negative', () => {
    expect(() => validateCalculationInput({ ...base, outstandingLoan: '-1' })).toThrow(
      ValidationError,
    );
  });

  it('defaults legalFeesEstimate to undefined when not provided', () => {
    const result = validateCalculationInput(base);
    expect(result.legalFeesEstimate).toBeUndefined();
  });

  it('parses legalFeesEstimate when provided', () => {
    const result = validateCalculationInput({ ...base, legalFeesEstimate: '3000' });
    expect(result.legalFeesEstimate).toBe(3000);
  });

  it('parses isFirstTimer as boolean', () => {
    const t = validateCalculationInput({ ...base, isFirstTimer: 'true' });
    const f = validateCalculationInput({ ...base, isFirstTimer: 'false' });
    expect(t.isFirstTimer).toBe(true);
    expect(f.isFirstTimer).toBe(false);
  });

  it('does not include purchaseYear in output', () => {
    const result = validateCalculationInput({ ...base, purchaseYear: '2010' });
    // purchaseYear should be silently ignored — not in FinancialCalculationInput
    expect(result.ownerCpfs[0]).toEqual({ cpfRefund: 128000 });
  });

  it('stops at first gap in owner sequence', () => {
    // cpfRefund2 present, cpfRefund3 absent, cpfRefund4 present — stops after cpfRefund2
    const result = validateCalculationInput({ ...base, cpfRefund2: '60000', cpfRefund4: '30000' });
    expect(result.ownerCpfs).toHaveLength(2);
  });
});
