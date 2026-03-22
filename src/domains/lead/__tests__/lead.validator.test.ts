import { validateLeadInput } from '../lead.validator';

describe('validateLeadInput', () => {
  const validInput = {
    name: 'John Tan',
    email: 'test@example.com',
    countryCode: '+65',
    nationalNumber: '91234567',
    phone: '+6591234567',
    consentService: true,
    consentMarketing: false,
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

  it('returns error when email is missing', () => {
    const input = { ...validInput, email: '' };
    expect(validateLeadInput(input)).toEqual({ email: 'Email is required' });
  });

  it('returns error when email format is invalid', () => {
    const input = { ...validInput, email: 'not-an-email' };
    expect(validateLeadInput(input)).toEqual({ email: 'Please enter a valid email address' });
  });

  it('accepts valid email', () => {
    const input = { ...validInput, email: 'grogu@example.com' };
    expect(validateLeadInput(input)).toBeNull();
  });

  it('rejects SG phone not starting with 8 or 9', () => {
    const result = validateLeadInput({ ...validInput, nationalNumber: '61234567' });
    expect(result).toEqual({
      nationalNumber:
        'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)',
    });
  });

  it('rejects SG phone with wrong length', () => {
    const result = validateLeadInput({ ...validInput, nationalNumber: '9123456' });
    expect(result).toEqual({
      nationalNumber:
        'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)',
    });
  });

  it('rejects SG phone with non-digits', () => {
    const result = validateLeadInput({ ...validInput, nationalNumber: '9123abcd' });
    expect(result).toEqual({
      nationalNumber:
        'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)',
    });
  });

  it('accepts valid Malaysia input', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '1234567890',
      phone: '+601234567890',
    });
    expect(result).toBeNull();
  });

  it('rejects non-SG phone with too few digits', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '123456',
      phone: '+60123456',
    });
    expect(result).toEqual({
      nationalNumber: 'Please enter a valid phone number (7-15 digits)',
    });
  });

  it('rejects non-SG phone with non-digits', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+60',
      nationalNumber: '12345abc',
      phone: '+6012345abc',
    });
    expect(result).toEqual({
      nationalNumber: 'Please enter a valid phone number (7-15 digits)',
    });
  });

  it('rejects unknown country code', () => {
    const result = validateLeadInput({
      ...validInput,
      countryCode: '+1',
      nationalNumber: '2025551234',
      phone: '+12025551234',
    });
    expect(result).toEqual({ countryCode: 'Please select a valid country' });
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

});
