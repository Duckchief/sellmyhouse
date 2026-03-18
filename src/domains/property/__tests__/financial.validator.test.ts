import {
  validateCalculationInput,
  validateApproveInput,
  validateSendInput,
} from '../financial.validator';

describe('financial.validator', () => {
  describe('validateCalculationInput', () => {
    const validBody = {
      salePrice: 500000,
      outstandingLoan: 200000,
      ownerCpfs: [{ cpfRefund: 100000 }],
      flatType: '4 ROOM',
      subsidyType: 'subsidised',
      isFirstTimer: true,
      legalFeesEstimate: 2500,
    };

    it('returns validated input for valid body', () => {
      const result = validateCalculationInput(validBody);
      expect(result.salePrice).toBe(500000);
      expect(result.ownerCpfs[0].cpfRefund).toBe(100000);
    });

    it('throws for zero sale price', () => {
      expect(() => validateCalculationInput({ ...validBody, salePrice: 0 })).toThrow(
        'Sale price must be greater than zero',
      );
    });

    it('throws for negative sale price', () => {
      expect(() => validateCalculationInput({ ...validBody, salePrice: -1 })).toThrow(
        'Sale price must be greater than zero',
      );
    });

    it('accepts sale price of 1 (boundary)', () => {
      const result = validateCalculationInput({ ...validBody, salePrice: 1 });
      expect(result.salePrice).toBe(1);
    });

    it('throws for negative outstanding loan', () => {
      expect(() => validateCalculationInput({ ...validBody, outstandingLoan: -1 })).toThrow(
        'Outstanding loan cannot be negative',
      );
    });

    it('defaults to single owner with zero CPF when ownerCpfs not provided', () => {
      const { ownerCpfs: _omit, ...bodyWithout } = validBody;
      const result = validateCalculationInput(bodyWithout);
      expect(result.ownerCpfs).toHaveLength(1);
      expect(result.ownerCpfs[0].cpfRefund).toBe(0);
    });

    it('throws for invalid flat type', () => {
      expect(() => validateCalculationInput({ ...validBody, flatType: 'MANSION' })).toThrow(
        'Invalid flat type',
      );
    });

    it('handles multiple owners in ownerCpfs', () => {
      const result = validateCalculationInput({
        ...validBody,
        ownerCpfs: [{ cpfRefund: 100000 }, { cpfRefund: 50000 }],
      });
      expect(result.ownerCpfs).toHaveLength(2);
      expect(result.ownerCpfs[1].cpfRefund).toBe(50000);
    });

    it('throws for more than 4 owners', () => {
      expect(() =>
        validateCalculationInput({
          ...validBody,
          ownerCpfs: [
            { cpfRefund: 10000 },
            { cpfRefund: 10000 },
            { cpfRefund: 10000 },
            { cpfRefund: 10000 },
            { cpfRefund: 10000 },
          ],
        }),
      ).toThrow('ownerCpfs may not have more than 4 entries');
    });

    it('throws for missing sale price', () => {
      const body = { ...validBody };
      delete (body as Record<string, unknown>).salePrice;
      expect(() => validateCalculationInput(body)).toThrow('Sale price is required');
    });
  });

  describe('validateApproveInput', () => {
    it('returns valid input', () => {
      const result = validateApproveInput({ reviewNotes: 'Looks good' });
      expect(result.reviewNotes).toBe('Looks good');
    });

    it('allows empty review notes', () => {
      const result = validateApproveInput({});
      expect(result.reviewNotes).toBeUndefined();
    });
  });

  describe('validateSendInput', () => {
    it('returns valid input', () => {
      const result = validateSendInput({ channel: 'whatsapp' });
      expect(result.channel).toBe('whatsapp');
    });

    it('throws for invalid channel', () => {
      expect(() => validateSendInput({ channel: 'sms' })).toThrow('Invalid channel');
    });

    it('defaults to whatsapp', () => {
      const result = validateSendInput({});
      expect(result.channel).toBe('whatsapp');
    });
  });
});
