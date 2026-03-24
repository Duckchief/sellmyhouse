import { buildListingDescriptionPrompt } from '../listing-description';
import { ValidationError } from '../../../errors';

const property = {
  flatType: '4 ROOM',
  town: 'ANG MO KIO',
  block: '123',
  street: 'Ang Mo Kio Ave 3',
  floorAreaSqm: 90,
  storey: '04',
  leaseCommencementDate: 1990,
};

const template =
  'Flat: {flatType}, Town: {town}, Blk {block} {street}, {floorAreaSqm}sqm, Storey {storey}, Lease {leaseCommencementDate}';

describe('buildListingDescriptionPrompt', () => {
  it('substitutes all placeholders', () => {
    const result = buildListingDescriptionPrompt(template, property);
    expect(result).toBe(
      'Flat: 4 ROOM, Town: ANG MO KIO, Blk 123 Ang Mo Kio Ave 3, 90sqm, Storey 04, Lease 1990',
    );
  });

  it('throws ValidationError when template is empty', () => {
    expect(() => buildListingDescriptionPrompt('', property)).toThrow(ValidationError);
  });

  it('throws ValidationError when template is blank whitespace', () => {
    expect(() => buildListingDescriptionPrompt('   ', property)).toThrow(ValidationError);
  });

  it('leaves unknown placeholders intact', () => {
    const result = buildListingDescriptionPrompt('Hello {unknown}', property);
    expect(result).toBe('Hello {unknown}');
  });
});
