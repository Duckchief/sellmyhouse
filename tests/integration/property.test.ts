import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import { getCsrfToken, withCsrf } from '../helpers/csrf';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

/**
 * Helper: create a seller with a known password and return a logged-in agent (supertest agent
 * with the session cookie already set).
 */
async function loginAsSeller(overrides?: {
  onboardingStep?: number;
  status?: 'lead' | 'engaged' | 'active' | 'completed' | 'archived';
}) {
  const password = 'TestPassword1!';
  const seller = await factory.seller({
    email: `seller-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 4),
    onboardingStep: overrides?.onboardingStep ?? 5,
    status: overrides?.status ?? 'active',
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/seller').set('x-csrf-token', csrfToken).type('form').send({
    email: seller.email,
    password,
  });

  return { seller, agent: withCsrf(agent, csrfToken) };
}

// ─── Valid property form data ─────────────────────────────────────────────────

const validPropertyData = {
  town: 'TAMPINES',
  street: 'TAMPINES ST 21',
  block: '123',
  flatType: '4 ROOM',
  storeyRange: '07 TO 09',
  floorAreaSqm: '93',
  flatModel: 'Model A',
  leaseCommenceDate: '1995',
};

describe('Property Integration', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // GET /seller/property
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/property', () => {
    it('returns 200 for an authenticated seller', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 5 });
      const res = await agent.get('/seller/property');
      expect(res.status).toBe(200);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await request(app).get('/seller/property');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PUT /seller/property — create property
  // ────────────────────────────────────────────────────────────────────────────

  describe('PUT /seller/property — create property', () => {
    it('creates a property and a draft listing for the seller', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 5 });

      const res = await agent.put('/seller/property').type('form').send(validPropertyData);

      // Should succeed (render the property form partial)
      expect(res.status).toBe(200);

      // Verify property exists in DB
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
        include: { listings: true },
      });
      expect(property).not.toBeNull();
      expect(property!.town).toBe('TAMPINES');
      expect(property!.street).toBe('TAMPINES ST 21');

      // Verify a draft listing was created
      expect(property!.listings.length).toBeGreaterThanOrEqual(1);
      const draftListing = property!.listings.find((l) => l.status === 'draft');
      expect(draftListing).not.toBeUndefined();
    });

    it('creates an audit log entry with action "property.created"', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 5 });

      await agent.put('/seller/property').type('form').send(validPropertyData);

      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(property).not.toBeNull();

      const audit = await testPrisma.auditLog.findFirst({
        where: {
          entityId: property!.id,
          action: 'property.created',
        },
      });
      expect(audit).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PUT /seller/property — update with price change
  // ────────────────────────────────────────────────────────────────────────────

  describe('PUT /seller/property — update with price change', () => {
    it('tracks price change in priceHistory and creates an audit log entry', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 5 });

      // First create the property
      await agent.put('/seller/property').type('form').send(validPropertyData);

      // Now update with an asking price
      const res = await agent
        .put('/seller/property')
        .type('form')
        .send({ ...validPropertyData, askingPrice: '550000' });

      expect(res.status).toBe(200);

      // Verify price history was appended
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(property).not.toBeNull();
      expect(Number(property!.askingPrice)).toBe(550000);

      const priceHistory = JSON.parse(property!.priceHistory as string) as Array<{
        price: number;
        changedAt: string;
        changedBy: string;
      }>;
      expect(priceHistory.length).toBeGreaterThanOrEqual(1);
      expect(priceHistory[priceHistory.length - 1]!.price).toBe(550000);

      // Verify audit log for price change
      const priceAudit = await testPrisma.auditLog.findFirst({
        where: {
          entityId: property!.id,
          action: 'property.price_changed',
        },
      });
      expect(priceAudit).not.toBeNull();
    });

    it('reverts a live listing to pending_review on price change', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 5 });

      // Create the property via the API (creates a draft listing)
      await agent
        .put('/seller/property')
        .type('form')
        .send({ ...validPropertyData, askingPrice: '500000' });

      // Fetch the property and listing from DB
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
        include: { listings: true },
      });
      expect(property).not.toBeNull();
      const listing = property!.listings[0];
      expect(listing).not.toBeUndefined();

      // Manually set listing status to 'live' to simulate an approved listing
      await testPrisma.listing.update({
        where: { id: listing!.id },
        data: { status: 'live' },
      });

      // Now change the asking price — should revert listing to pending_review
      await agent
        .put('/seller/property')
        .type('form')
        .send({ ...validPropertyData, askingPrice: '520000' });

      // Verify listing was reverted to pending_review
      const updatedListing = await testPrisma.listing.findUnique({
        where: { id: listing!.id },
      });
      expect(updatedListing!.status).toBe('pending_review');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /seller/photos
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/photos', () => {
    it('returns 200 for an authenticated seller with a property', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 5 });

      // Create a property so the route doesn't throw NotFoundError
      const property = await factory.property({ sellerId: seller.id });
      await factory.listing({ propertyId: property.id });

      const res = await agent.get('/seller/photos');
      expect(res.status).toBe(200);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await request(app).get('/seller/photos');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Onboarding step 2 — property creation
  // ────────────────────────────────────────────────────────────────────────────

  describe('POST /seller/onboarding/step/2 — property creation', () => {
    it('creates a property and advances onboardingStep to 2', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 1 });

      const res = await agent
        .post('/seller/onboarding/step/2')
        .type('form')
        .send(validPropertyData);

      // Should redirect back to onboarding wizard
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');

      // Verify property was created
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(property).not.toBeNull();
      expect(property!.town).toBe('TAMPINES');

      // Verify onboardingStep advanced to 2
      const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated!.onboardingStep).toBe(2);
    });

    it('creates a property during onboarding step 2 via HTMX and renders next step partial', async () => {
      const { seller, agent } = await loginAsSeller({ onboardingStep: 1 });

      const res = await agent
        .post('/seller/onboarding/step/2')
        .set('HX-Request', 'true')
        .type('form')
        .send(validPropertyData);

      expect(res.status).toBe(200);

      // Verify property was created in the DB
      const property = await testPrisma.property.findFirst({
        where: { sellerId: seller.id },
      });
      expect(property).not.toBeNull();

      // onboardingStep should be 2
      const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated!.onboardingStep).toBe(2);
    });
  });
});
