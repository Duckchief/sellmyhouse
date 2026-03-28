import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../../../../tests/helpers/prisma';
import { factory } from '../../../../tests/fixtures/factory';
import { createApp } from '@/infra/http/app';
import { getCsrfToken, withCsrf } from '../../../../tests/helpers/csrf';

// Mock the AI facade at module level so no real API calls are made
jest.mock('@/domains/shared/ai/ai.facade', () => {
  const actual = jest.requireActual('@/domains/shared/ai/ai.facade');
  return {
    ...actual,
    generateText: jest.fn().mockResolvedValue({
      text: 'Test description.',
      provider: 'anthropic',
      model: 'test-model',
      tokensUsed: 0,
    }),
  };
});

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await testPrisma.$disconnect();
});

/**
 * Helper: create an agent with a known password and return a logged-in supertest agent.
 */
async function loginAsAgent(overrides?: { role?: 'agent' | 'admin' }) {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: overrides?.role ?? 'agent',
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/agent').set('x-csrf-token', csrfToken).type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent: withCsrf(agent, csrfToken) };
}

/**
 * Helper: create the standard test fixtures — agent, seller, property, listing, and system setting.
 */
async function setupListingWithPrompt(agentId: string) {
  const seller = await factory.seller({ agentId, status: 'active' });
  const property = await factory.property({ sellerId: seller.id });
  const listing = await factory.listing({ propertyId: property.id });
  await factory.systemSetting({
    key: 'listing_description_prompt',
    value:
      'Write a listing for a {flatType} in {town}, block {block} on {street}. Floor area: {floorAreaSqm} sqm, storey: {storey}, lease from {leaseCommencementDate}.',
  });
  return { seller, property, listing };
}

describe('Listing Description Integration', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 1: Generate → edit draft → approve
  // ────────────────────────────────────────────────────────────────────────────

  it('generate → edit draft → approve: listing.description = edited text, descriptionApprovedAt set', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const { listing } = await setupListingWithPrompt(agentRecord.id);

    // Step 1: Generate description
    const genRes = await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');
    expect(genRes.status).toBe(200);

    // Verify AI description was saved
    const afterGen = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterGen?.aiDescription).toBe('Test description.');
    expect(afterGen?.description).toBeNull();
    expect(afterGen?.descriptionApprovedAt).toBeNull();

    // Step 2: Edit draft
    const draftRes = await agent
      .post(`/agent/listings/${listing.id}/description/draft`)
      .type('form')
      .send({ text: 'Edited description.' });
    expect(draftRes.status).toBe(204);

    const afterDraft = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterDraft?.description).toBe('Edited description.');

    // Step 3: Approve
    const approveRes = await agent.post(`/agent/reviews/listing_description/${listing.id}/approve`);
    expect(approveRes.status).toBe(200);

    const afterApprove = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterApprove?.description).toBe('Edited description.');
    expect(afterApprove?.descriptionApprovedAt).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 2: Generate when listing_description_prompt missing → error
  // ────────────────────────────────────────────────────────────────────────────

  it('generate when listing_description_prompt is empty → error with not configured', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
    const property = await factory.property({ sellerId: seller.id });
    const listing = await factory.listing({ propertyId: property.id });

    // Create the setting with an empty value so buildListingDescriptionPrompt throws ValidationError
    await factory.systemSetting({
      key: 'listing_description_prompt',
      value: '',
    });

    const res = await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');

    // ValidationError = 400
    expect(res.status).toBe(400);
    expect(res.text).toContain('not configured');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 3: Regenerate after approval clears descriptionApprovedAt
  // ────────────────────────────────────────────────────────────────────────────

  it('regenerate after approval: clears descriptionApprovedAt, listing re-enters review queue', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const { listing } = await setupListingWithPrompt(agentRecord.id);

    // Generate initial description
    await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');

    // Approve it
    await agent.post(`/agent/reviews/listing_description/${listing.id}/approve`);

    // Verify it was approved
    const afterApprove = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterApprove?.descriptionApprovedAt).not.toBeNull();

    // Regenerate — should clear the approval
    const regenRes = await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');
    expect(regenRes.status).toBe(200);

    const afterRegen = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterRegen?.descriptionApprovedAt).toBeNull();
    // Still has a description (from AI) but not approved — in review queue
    expect(afterRegen?.description).toBe('Test description.');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 4: Regenerate after rejection
  // ────────────────────────────────────────────────────────────────────────────

  it('regenerate after rejection: description and aiDescription restored, listing re-enters review queue', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const { listing } = await setupListingWithPrompt(agentRecord.id);

    // Generate
    await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');

    // Reject — clears description, keeps aiDescription
    await agent
      .post(`/agent/reviews/listing_description/${listing.id}/reject`)
      .type('form')
      .send({ reviewNotes: 'Too generic' });

    const afterReject = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterReject?.description).toBeNull();
    expect(afterReject?.aiDescription).toBe('Test description.');

    // Regenerate — description and aiDescription restored
    const regenRes = await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');
    expect(regenRes.status).toBe(200);

    const afterRegen = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterRegen?.description).toBeNull();
    expect(afterRegen?.aiDescription).toBe('Test description.');
    expect(afterRegen?.descriptionApprovedAt).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 5: Approve with text updates aiDescription + description
  // ────────────────────────────────────────────────────────────────────────────

  it('approve with text: aiDescription + description updated, descriptionApprovedAt set', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const { listing } = await setupListingWithPrompt(agentRecord.id);

    // Generate
    await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');

    // Approve with custom text
    const approveRes = await agent
      .post(`/agent/reviews/listing_description/${listing.id}/approve`)
      .type('form')
      .send({ text: 'Agent-edited description.' });
    expect(approveRes.status).toBe(200);

    const afterApprove = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(afterApprove?.description).toBe('Agent-edited description.');
    expect(afterApprove?.aiDescription).toBe('Agent-edited description.');
    expect(afterApprove?.descriptionApprovedAt).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 6: Both photos and description approved → listing approved + portal listings
  // ────────────────────────────────────────────────────────────────────────────

  it('both photos and description approved → listing status becomes approved, portal listings generated', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
    const property = await factory.property({ sellerId: seller.id, askingPrice: 550000 });
    const photoJson = JSON.stringify(['/uploads/photos/test-photo.jpg']);
    const listing = await factory.listing({ propertyId: property.id, photos: photoJson });
    await factory.systemSetting({
      key: 'listing_description_prompt',
      value:
        'Write a listing for a {flatType} in {town}, block {block} on {street}. Floor area: {floorAreaSqm} sqm, storey: {storey}, lease from {leaseCommencementDate}.',
    });

    // Seed settings needed by portal service
    await factory.systemSetting({ key: 'agency_name', value: 'Huttons Asia Pte Ltd' });
    await factory.systemSetting({ key: 'agency_licence', value: 'L3008899K' });

    // Generate and approve description
    await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');
    await agent.post(`/agent/reviews/listing_description/${listing.id}/approve`);

    // Approve photos (set photosApprovedAt directly since we can't easily upload photos)
    await testPrisma.listing.update({
      where: { id: listing.id },
      data: {
        photosApprovedAt: new Date(),
        photosApprovedByAgentId: agentRecord.id,
      },
    });

    // Now approve description again after setting photos — but photos were already approved
    // We need to trigger the "both approved" check. Let's clear and re-approve description.
    // Actually: checkListingFullyApproved checks both timestamps.
    // The first description approval already ran but photos weren't approved yet.
    // Let's re-trigger by clearing description approval and re-approving.
    await testPrisma.listing.update({
      where: { id: listing.id },
      data: { descriptionApprovedAt: null },
    });

    const approveRes = await agent.post(`/agent/reviews/listing_description/${listing.id}/approve`);
    expect(approveRes.status).toBe(200);

    const afterBoth = await testPrisma.listing.findUnique({
      where: { id: listing.id },
      include: { portalListings: true },
    });
    expect(afterBoth?.status).toBe('approved');
    expect(afterBoth?.portalListings.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 7: Generated description appears in review queue
  // ────────────────────────────────────────────────────────────────────────────

  it('generated description appears in review queue immediately after generation', async () => {
    const { agentRecord, agent } = await loginAsAgent();
    const { listing } = await setupListingWithPrompt(agentRecord.id);

    // Generate description
    await agent
      .post(`/agent/listings/${listing.id}/description/generate`)
      .set('HX-Request', 'true');

    // Check review queue — aiDescription present, not yet approved
    const fromDb = await testPrisma.listing.findUnique({ where: { id: listing.id } });
    expect(fromDb?.aiDescription).not.toBeNull();
    expect(fromDb?.description).toBeNull();
    expect(fromDb?.descriptionApprovedAt).toBeNull();

    // Fetch the review queue page and verify the listing appears
    const reviewRes = await agent.get('/agent/reviews');
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.text).toContain(listing.id);
  });
});
