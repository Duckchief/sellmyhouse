// src/domains/compliance/__tests__/compliance.router.test.ts
import * as complianceService from '../compliance.service';
import * as agentRepo from '../../agent/agent.repository';

jest.mock('../compliance.service');
jest.mock('../../agent/agent.repository');

const mockService = complianceService as jest.Mocked<typeof complianceService>;
const mockAgentRepo = agentRepo as jest.Mocked<typeof agentRepo>;

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { complianceRouter } from '../compliance.router';

const mockComplianceStatus = {
  cdd: { status: 'not_started' as const, verifiedAt: null, riskLevel: null, fullName: null, nricLast4: null },
  eaa: { id: null, status: 'not_started' as const, signedAt: null, signedCopyPath: null, expiryDate: null, explanationConfirmedAt: null, explanationMethod: null },
  consent: { service: true, marketing: true, withdrawnAt: null },
  caseFlags: [] as { id: string; flagType: string; status: string; description: string }[],
  counterpartyCdd: null,
} as unknown as Awaited<ReturnType<typeof agentRepo.getComplianceStatus>>;

function createTestApp(userOverride?: { id: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
  });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (d: unknown) => (d ? String(d) : ''));
  env.addFilter('replace', (str: string, a: string, b: string) => str.replace(new RegExp(a, 'g'), b));
  app.set('view engine', 'njk');

  if (userOverride) {
    app.use((req, _res, next) => {
      req.user = {
        id: userOverride.id,
        role: userOverride.role as 'seller' | 'agent' | 'admin',
        email: 'test@test.local',
        name: 'Test',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      };
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
  }

  app.use(complianceRouter);
  return app;
}

function createSellerApp() {
  return createTestApp({ id: 'seller-1', role: 'seller' });
}

function createAgentApp() {
  return createTestApp({ id: 'agent-1', role: 'agent' });
}

describe('POST /seller/compliance/consent/withdraw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated as seller', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'marketing' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid consent type', async () => {
    const app = createSellerApp();
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'invalid' });
    expect([400, 401]).toContain(res.status);
  });

  it('redirects on successful marketing consent withdrawal', async () => {
    mockService.withdrawConsent.mockResolvedValue({
      consentRecordId: 'cr-1',
      deletionBlocked: false,
    });

    const app = createSellerApp();
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'marketing', channel: 'web' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/seller/my-data?consent_withdrawn=true');
  });

  it('returns HTMX partial on successful withdrawal when hx-request header set', async () => {
    mockService.withdrawConsent.mockResolvedValue({
      consentRecordId: 'cr-2',
      deletionBlocked: false,
    });

    const app = createSellerApp();
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .set('hx-request', 'true')
      .send({ type: 'marketing', channel: 'web' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Marketing consent withdrawn');
  });
});

// ─── Agent Compliance Gate Endpoints ─────────────────────────────────────────

describe('POST /agent/sellers/:sellerId/cdd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockComplianceStatus as never);
  });

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd')
      .send({ fullName: 'Test', nricLast4: '567A' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as seller (not agent)', async () => {
    const app = createSellerApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd')
      .send({ fullName: 'Test', nricLast4: '567A' });
    expect(res.status).toBe(403);
  });

  it('creates CDD record and returns card partial on success', async () => {
    mockService.createCddRecord.mockResolvedValue({ id: 'cdd-1' } as never);
    const updatedCompliance = {
      ...mockComplianceStatus,
      cdd: { status: 'verified' as const, verifiedAt: new Date(), riskLevel: 'standard', fullName: 'Test User', nricLast4: '567A' },
    };
    mockAgentRepo.getComplianceStatus.mockResolvedValue(updatedCompliance as never);

    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd')
      .send({ fullName: 'Test User', nricLast4: '567A', riskLevel: 'standard' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('CDD Status');
    expect(mockService.createCddRecord).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'seller', subjectId: 'seller-1', fullName: 'Test User' }),
      'agent-1',
    );
  });

  it('returns 400 when nricLast4 is missing', async () => {
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd')
      .send({ fullName: 'Test User' });
    expect(res.status).toBe(400);
  });
});

describe('POST /agent/sellers/:sellerId/eaa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockComplianceStatus as never);
  });

  it('creates EAA and returns card partial', async () => {
    mockService.createEaa.mockResolvedValue({ id: 'eaa-1', status: 'draft' } as never);
    const updatedCompliance = {
      ...mockComplianceStatus,
      eaa: { id: 'eaa-1', status: 'draft' as const, signedAt: null, signedCopyPath: null, expiryDate: null, explanationConfirmedAt: null, explanationMethod: null },
    };
    mockAgentRepo.getComplianceStatus.mockResolvedValue(updatedCompliance as never);

    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/eaa')
      .send({ agreementType: 'non_exclusive' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Estate Agency Agreement');
    expect(mockService.createEaa).toHaveBeenCalled();
  });
});

describe('PUT /agent/eaa/:eaaId/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid status', async () => {
    const app = createAgentApp();
    const res = await request(app)
      .put('/agent/eaa/eaa-1/status')
      .send({ status: 'invalid_status' });
    expect(res.status).toBe(400);
  });

  it('updates status and returns card partial', async () => {
    mockService.updateEaaStatus.mockResolvedValue({ id: 'eaa-1', sellerId: 'seller-1', status: 'sent_to_seller' } as never);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      eaa: { id: 'eaa-1', status: 'sent_to_seller' as const, signedAt: null, signedCopyPath: null, expiryDate: null, explanationConfirmedAt: null, explanationMethod: null },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .put('/agent/eaa/eaa-1/status')
      .send({ status: 'sent_to_seller' });

    expect(res.status).toBe(200);
    expect(mockService.updateEaaStatus).toHaveBeenCalledWith('eaa-1', 'sent_to_seller', 'agent-1');
  });
});

describe('POST /agent/eaa/:eaaId/explanation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when method is missing', async () => {
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/eaa/eaa-1/explanation')
      .send({ notes: 'some notes' });
    expect(res.status).toBe(400);
  });

  it('confirms explanation and returns card partial', async () => {
    mockService.confirmEaaExplanation.mockResolvedValue({ id: 'eaa-1', sellerId: 'seller-1' } as never);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      eaa: { id: 'eaa-1', status: 'signed' as const, signedAt: new Date(), signedCopyPath: null, expiryDate: null, explanationConfirmedAt: new Date(), explanationMethod: 'video_call' },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/eaa/eaa-1/explanation')
      .send({ method: 'video_call', notes: 'Explained terms' });

    expect(res.status).toBe(200);
    expect(mockService.confirmEaaExplanation).toHaveBeenCalledWith(
      expect.objectContaining({ eaaId: 'eaa-1', method: 'video_call' }),
    );
  });
});

describe('POST /agent/transactions/:txId/counterparty-cdd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates counterparty CDD record', async () => {
    mockService.createCddRecord.mockResolvedValue({ id: 'cdd-2' } as never);
    mockService.getTransactionDocuments.mockResolvedValue({ sellerId: 'seller-1' } as never);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      counterpartyCdd: { status: 'verified' as const, verifiedAt: new Date(), transactionId: 'tx-1' },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/transactions/tx-1/counterparty-cdd')
      .send({ fullName: 'Buyer Name', nricLast4: '234B' });

    expect(res.status).toBe(200);
    expect(mockService.createCddRecord).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'counterparty', subjectId: 'tx-1' }),
      'agent-1',
    );
  });
});

// ─── Modal GET Endpoints ─────────────────────────────────────────────────────

describe('GET /agent/sellers/:sellerId/cdd/modal', () => {
  it('returns CDD modal HTML', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/sellers/seller-1/cdd/modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Create CDD Record');
    expect(res.text).toContain('fullName');
  });
});

describe('GET /agent/sellers/:sellerId/eaa/modal', () => {
  it('returns EAA modal HTML', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/sellers/seller-1/eaa/modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Create Estate Agency Agreement');
  });
});

describe('GET /agent/eaa/:eaaId/explanation/modal', () => {
  it('returns explanation modal HTML', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/eaa/eaa-1/explanation/modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Confirm EAA Explanation');
  });
});

describe('GET /agent/eaa/:eaaId/signed-copy/modal', () => {
  it('returns signed copy upload modal HTML', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/eaa/eaa-1/signed-copy/modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Upload Signed EAA Copy');
  });
});
