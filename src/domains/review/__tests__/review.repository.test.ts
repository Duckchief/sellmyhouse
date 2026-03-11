import { mapMcsToFrs, buildAddress } from '../review.repository';

describe('mapMcsToFrs', () => {
  it('maps published to sent', () => {
    expect(mapMcsToFrs('published')).toBe('sent');
  });

  it('passes through ai_generated', () => {
    expect(mapMcsToFrs('ai_generated')).toBe('ai_generated');
  });

  it('passes through pending_review', () => {
    expect(mapMcsToFrs('pending_review')).toBe('pending_review');
  });

  it('passes through approved', () => {
    expect(mapMcsToFrs('approved')).toBe('approved');
  });

  it('passes through rejected', () => {
    expect(mapMcsToFrs('rejected')).toBe('rejected');
  });
});

describe('buildAddress', () => {
  it('combines block, street, and town', () => {
    expect(buildAddress('Bishan', 'Bishan Street 22', '123')).toBe('123 Bishan Street 22, Bishan');
  });

  it('trims extra whitespace', () => {
    expect(buildAddress('Tampines', 'Tampines Ave 4', '456')).toBe('456 Tampines Ave 4, Tampines');
  });
});
