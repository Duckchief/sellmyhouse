// tests/integration/portal.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as portalService from '../../src/domains/property/portal.service';

describe('portal integration', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;
  let listingId: string;

  beforeEach(async () => {
    await testPrisma.offer.deleteMany();
    await testPrisma.portalListing.deleteMany();
    await testPrisma.listing.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    const agent = await factory.agent({ ceaRegNo: 'R012345A' });
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({
      sellerId,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      askingPrice: 650000,
    });
    propertyId = property.id;
    const listing = await factory.listing({
      propertyId,
      title: 'Bright 4-Room in Tampines',
      description: 'Well-maintained flat.',
      status: 'approved',
      photos: '[]',
    });
    listingId = listing.id;

    await testPrisma.systemSetting.createMany({
      data: [
        { id: 's1', key: 'agency_name', value: 'Huttons Asia Pte Ltd', description: 'test' },
        { id: 's2', key: 'agency_licence', value: 'L3008899K', description: 'test' },
      ],
    });
  });

  it('generates portal listing records for all three portals', async () => {
    await portalService.generatePortalListings(listingId);

    const portalListings = await testPrisma.portalListing.findMany({
      where: { listingId },
    });

    expect(portalListings).toHaveLength(3);
    const portalNames = portalListings.map((p) => p.portalName);
    expect(portalNames).toContain('propertyguru');
    expect(portalNames).toContain('ninety_nine_co');
    expect(portalNames).toContain('srx');
  });

  it('generated content always includes all CEA fields', async () => {
    await portalService.generatePortalListings(listingId);

    const portalListings = await testPrisma.portalListing.findMany({ where: { listingId } });
    for (const pl of portalListings) {
      const content = pl.portalReadyContent as Record<string, unknown>;
      const ceaDetails = content['ceaDetails'] as Record<string, string>;
      expect(ceaDetails['agencyName']).toBe('Huttons Asia Pte Ltd');
      expect(ceaDetails['agencyLicence']).toBe('L3008899K');
      expect(ceaDetails['ceaRegNo']).toBe('R012345A');
    }
  });

  it('marks a portal listing as posted with URL', async () => {
    await portalService.generatePortalListings(listingId);
    const pl = await testPrisma.portalListing.findFirst({ where: { listingId } });

    const updated = await portalService.markAsPosted(
      pl!.id,
      'https://www.propertyguru.com.sg/listing/12345',
    );

    expect(updated.status).toBe('posted');
    expect(updated.portalListingUrl).toBe('https://www.propertyguru.com.sg/listing/12345');
    expect(updated.postedManuallyAt).not.toBeNull();
  });

  it('regenerates portal content on re-approval (upsert replaces existing)', async () => {
    await portalService.generatePortalListings(listingId);
    await portalService.generatePortalListings(listingId); // second call

    const portalListings = await testPrisma.portalListing.findMany({ where: { listingId } });
    expect(portalListings).toHaveLength(3); // no duplicates
  });
});
