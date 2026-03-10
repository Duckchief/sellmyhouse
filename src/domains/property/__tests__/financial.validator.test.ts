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
      cpfOaUsed: 100000,
      purchaseYear: 2016,
      flatType: '4 ROOM',
      subsidyType: 'subsidised',
      isFirstTimer: true,
      legalFeesEstimate: 2500,
    };

    it('returns validated input for valid body', () => {
      const result = validateCalculationInput(validBody);
      expect(result.salePrice).toBe(500000);
      expect(result.owner1Cpf.oaUsed).toBe(100000);
    });

    it('throws for negative sale price', () => {
      expect(() => validateCalculationInput({ ...validBody, salePrice: -1 })).toThrow(
        'Sale price must be positive',
      );
    });

    it('throws for negative outstanding loan', () => {
      expect(() => validateCalculationInput({ ...validBody, outstandingLoan: -1 })).toThrow(
        'Outstanding loan cannot be negative',
      );
    });

    it('accepts null/unknown CPF', () => {
      const result = validateCalculationInput({ ...validBody, cpfOaUsed: null });
      expect(result.owner1Cpf.oaUsed).toBeNull();
    });

    it('accepts "unknown" string for CPF', () => {
      const result = validateCalculationInput({ ...validBody, cpfOaUsed: 'unknown' });
      expect(result.owner1Cpf.oaUsed).toBeNull();
    });

    it('throws for invalid flat type', () => {
      expect(() => validateCalculationInput({ ...validBody, flatType: 'MANSION' })).toThrow(
        'Invalid flat type',
      );
    });

    it('handles joint owner CPF fields', () => {
      const result = validateCalculationInput({
        ...validBody,
        jointOwnerCpfOaUsed: 50000,
        jointOwnerPurchaseYear: 2016,
      });
      expect(result.owner2Cpf).toBeDefined();
      expect(result.owner2Cpf!.oaUsed).toBe(50000);
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
