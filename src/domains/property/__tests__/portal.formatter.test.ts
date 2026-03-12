// src/domains/property/__tests__/portal.formatter.test.ts
import { formatForPortal } from '../portal.formatter';
import type { PortalFormatterInput } from '../portal.formatter';

function makeInput(overrides: Partial<PortalFormatterInput> = {}): PortalFormatterInput {
  return {
    portal: 'propertyguru',
    listing: {
      id: 'listing-1',
      title: '4-Room HDB for Sale in Tampines',
      description: 'Well-maintained flat with great amenities.',
      photos: JSON.stringify(['/uploads/photos/seller-1/prop-1/optimized/photo1.jpg']),
    } as never,
    property: {
      id: 'property-1',
      town: 'TAMPINES',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: 93,
      flatModel: 'Model A',
      leaseCommenceDate: 1995,
      askingPrice: 650000,
      remainingLease: '68 years 03 months',
      block: '123',
      street: 'TAMPINES ST 21',
    } as never,
    agent: {
      id: 'agent-1',
      name: 'Jane Tan',
      ceaRegNo: 'R012345A',
      phone: '91234567',
    } as never,
    agencyName: 'Huttons Asia Pte Ltd',
    agencyLicence: 'L3008899K',
    ...overrides,
  };
}

describe('portal.formatter', () => {
  describe('formatForPortal', () => {
    it('includes CEA compliance fields for all portals', () => {
      for (const portal of ['propertyguru', 'ninety_nine_co', 'srx'] as const) {
        const result = formatForPortal(makeInput({ portal }));
        expect(result.ceaDetails.agentName).toBe('Jane Tan');
        expect(result.ceaDetails.ceaRegNo).toBe('R012345A');
        expect(result.ceaDetails.agencyName).toBe('Huttons Asia Pte Ltd');
        expect(result.ceaDetails.agencyLicence).toBe('L3008899K');
        expect(result.ceaDetails.agentPhone).toBe('91234567');
      }
    });

    it('includes flat details', () => {
      const result = formatForPortal(makeInput());
      expect(result.flatDetails.town).toBe('TAMPINES');
      expect(result.flatDetails.flatType).toBe('4 ROOM');
      expect(result.flatDetails.floorAreaSqm).toBe(93);
      expect(result.flatDetails.askingPrice).toBe(650000);
    });

    it('includes listing title and description', () => {
      const result = formatForPortal(makeInput());
      expect(result.title).toBe('4-Room HDB for Sale in Tampines');
      expect(result.description).toBe('Well-maintained flat with great amenities.');
    });

    it('includes parsed photos array', () => {
      const result = formatForPortal(makeInput());
      expect(result.photos).toEqual(['/uploads/photos/seller-1/prop-1/optimized/photo1.jpg']);
    });

    it('returns empty photos array when listing has no photos', () => {
      const input = makeInput();
      (input.listing as never as { photos: string }).photos = '[]';
      const result = formatForPortal(input);
      expect(result.photos).toEqual([]);
    });

    it('includes the portal name in the result', () => {
      const result = formatForPortal(makeInput({ portal: 'ninety_nine_co' }));
      expect(result.portal).toBe('ninety_nine_co');
    });

    it('returns empty photos array when photos JSON is invalid', () => {
      const input = makeInput();
      (input.listing as never as { photos: string }).photos = 'not-valid-json';
      const result = formatForPortal(input);
      expect(result.photos).toEqual([]);
    });

    it('uses fallback title when listing.title is null', () => {
      const input = makeInput();
      (input.listing as never as { title: null }).title = null;
      const result = formatForPortal(input);
      expect(result.title).toBe('4 ROOM HDB Flat for Sale in TAMPINES');
    });
  });
});
