import { validateLeadInput } from '../lead.validator';

describe('validateLeadInput', () => {
  const validInput = {
    name: 'John Tan',
    phone: '91234567',
    consentService: true,
    consentMarketing: false,
    consentHuttonsTransfer: true,
    leadSource: 'website' as const,
    formLoadedAt: Date.now() - 10000, // 10 seconds ago
  };

  it('accepts valid input', () => {
    const result = validateLeadInput(validInput);
    expect(result).toBeNull();
  });

  it('rejects empty name', () => {
    const result = validateLeadInput({ ...validInput, name: '' });
    expect(result).toEqual({ name: 'Name is required' });
  });

  it('rejects whitespace-only name', () => {
    const result = validateLeadInput({ ...validInput, name: '   ' });
    expect(result).toEqual({ name: 'Name is required' });
  });

  it('rejects phone not starting with 8 or 9', () => {
    const result = validateLeadInput({ ...validInput, phone: '61234567' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects phone with wrong length', () => {
    const result = validateLeadInput({ ...validInput, phone: '9123456' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects phone with non-digits', () => {
    const result = validateLeadInput({ ...validInput, phone: '9123abcd' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects missing service consent', () => {
    const result = validateLeadInput({ ...validInput, consentService: false });
    expect(result).toEqual({ consentService: 'Service consent is required' });
  });

  it('detects honeypot filled (bot)', () => {
    const result = validateLeadInput({ ...validInput, honeypot: 'spam' });
    expect(result).toEqual({ _bot: 'Submission rejected' });
  });

  it('rejects fast submissions (under 3 seconds)', () => {
    const result = validateLeadInput({ ...validInput, formLoadedAt: Date.now() - 1000 });
    expect(result).toEqual({ _bot: 'Submission rejected' });
  });

  it('allows submission without formLoadedAt (skip timing check)', () => {
    const input = { ...validInput };
    delete (input as Partial<typeof validInput>).formLoadedAt;
    const result = validateLeadInput(input);
    expect(result).toBeNull();
  });

  it('rejects missing Huttons transfer consent', () => {
    const result = validateLeadInput({ ...validInput, consentHuttonsTransfer: false });
    expect(result).toEqual({
      consentHuttonsTransfer: 'You must consent to data transfer to Huttons Asia Pte Ltd to proceed',
    });
  });
});
