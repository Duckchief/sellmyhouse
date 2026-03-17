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
  cdd: {
    status: 'not_started' as const,
    verifiedAt: null,
    riskLevel: null,
    fullName: null,
    nricLast4: null,
  },
  eaa: {
    id: null,
    status: 'not_started' as const,
    signedAt: null,
    signedCopyPath: null,
    expiryDate: null,
    explanationConfirmedAt: null,
    explanationMethod: null,
  },
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
  env.addFilter('replace', (str: string, a: string, b: string) =>
    str.replace(new RegExp(a, 'g'), b),
  );
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

  // Error handler — converts typed errors to HTTP status codes
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      err.name === 'ValidationError'
        ? 400
        : err.name === 'UnauthorizedError'
          ? 401
          : err.name === 'ForbiddenError'
            ? 403
            : err.name === 'NotFoundError'
              ? 404
              : err.name === 'ConflictError'
                ? 409
                : 500;
    res.status(status).json({ error: err.message });
  });

  return app;
}

function createSellerApp() {
  return createTestApp({ id: 'seller-1', role: 'seller' });
}

function createAgentApp() {
  return createTestApp({ id: 'agent-1', role: 'agent' });
}

function createAdminApp() {
  return createTestApp({ id: 'admin-1', role: 'admin' });
}

const mockVerifiedComplianceStatus = {
  ...mockComplianceStatus,
  cdd: {
    ...mockComplianceStatus.cdd,
    status: 'verified' as const,
    verifiedAt: new Date('2026-03-17'),
  },
} as unknown as Awaited<ReturnType<typeof agentRepo.getComplianceStatus>>;

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

describe('PATCH /agent/sellers/:sellerId/cdd/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const app = createTestApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for seller role', async () => {
    const app = createSellerApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid status value', async () => {
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('calls updateCddStatus and re-renders cdd card on success', async () => {
    mockService.updateCddStatus.mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      cdd: {
        status: 'verified' as const,
        verifiedAt: new Date(),
        riskLevel: null,
        fullName: null,
        nricLast4: null,
      },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('compliance-cdd-card');
    expect(mockService.updateCddStatus).toHaveBeenCalledWith(
      'seller-1',
      'verified',
      'agent-1',
      false,
    );
  });

  it('calls updateCddStatus with not_started to delete the record', async () => {
    mockService.updateCddStatus.mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      cdd: {
        status: 'not_started' as const,
        verifiedAt: null,
        riskLevel: null,
        fullName: null,
        nricLast4: null,
      },
    } as never);

    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });

    expect(res.status).toBe(200);
    expect(mockService.updateCddStatus).toHaveBeenCalledWith(
      'seller-1',
      'not_started',
      'agent-1',
      false,
    );
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
      eaa: {
        id: 'eaa-1',
        status: 'draft' as const,
        signedAt: null,
        signedCopyPath: null,
        expiryDate: null,
        explanationConfirmedAt: null,
        explanationMethod: null,
      },
    };
    mockAgentRepo.getComplianceStatus.mockResolvedValue(updatedCompliance as never);

    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/eaa')
      .send({ agreementType: 'non_exclusive' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('compliance-eaa-card');
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
    mockService.updateEaaStatus.mockResolvedValue({
      id: 'eaa-1',
      sellerId: 'seller-1',
      status: 'sent_to_seller',
    } as never);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      eaa: {
        id: 'eaa-1',
        status: 'sent_to_seller' as const,
        signedAt: null,
        signedCopyPath: null,
        expiryDate: null,
        explanationConfirmedAt: null,
        explanationMethod: null,
      },
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
    mockService.confirmEaaExplanation.mockResolvedValue({
      id: 'eaa-1',
      sellerId: 'seller-1',
    } as never);
    mockAgentRepo.getComplianceStatus.mockResolvedValue({
      ...mockComplianceStatus,
      eaa: {
        id: 'eaa-1',
        status: 'signed' as const,
        signedAt: new Date(),
        signedCopyPath: null,
        expiryDate: null,
        explanationConfirmedAt: new Date(),
        explanationMethod: 'video_call',
      },
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
      counterpartyCdd: {
        status: 'verified' as const,
        verifiedAt: new Date(),
        transactionId: 'tx-1',
      },
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

describe('GET /agent/sellers/:sellerId/cdd/verify-modal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();
    const res = await request(app).get('/agent/sellers/seller-1/cdd/verify-modal');
    expect(res.status).toBe(401);
  });

  // NOTE: This test will pass once the template partials/agent/cdd-verify-modal.njk is created (Task 5).
  // Until then, Nunjucks will throw a 500 because the template does not exist.
  it('returns 200 with modal HTML when authenticated as agent', async () => {
    const app = createAgentApp();
    const res = await request(app).get('/agent/sellers/seller-1/cdd/verify-modal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('I confirm');
  });
});

describe('POST /agent/sellers/:sellerId/cdd/verify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when phrase is wrong', async () => {
    mockService.verifyCdd = jest.fn().mockRejectedValue(
      Object.assign(new Error('Invalid confirmation phrase'), {
        name: 'ValidationError',
        statusCode: 400,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when already verified', async () => {
    mockService.verifyCdd = jest.fn().mockRejectedValue(
      Object.assign(new Error('CDD is already verified and locked'), {
        name: 'ConflictError',
        statusCode: 409,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'I confirm' });
    expect(res.status).toBe(409);
  });

  it('returns 200 with refreshed locked CDD card on correct phrase', async () => {
    mockService.verifyCdd = jest.fn().mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockVerifiedComplianceStatus);
    const app = createAgentApp();
    const res = await request(app)
      .post('/agent/sellers/seller-1/cdd/verify')
      .send({ phrase: 'I confirm' });
    expect(res.status).toBe(200);
    expect(mockService.verifyCdd).toHaveBeenCalledWith('seller-1', 'agent-1', 'I confirm');
    expect(res.text).toContain('Locked');
  });
});

describe('PATCH /agent/sellers/:sellerId/cdd/status — lock guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 when agent tries to set status=verified', async () => {
    mockService.updateCddStatus = jest.fn().mockRejectedValue(
      Object.assign(new Error('Agents must use the verification modal'), {
        name: 'ForbiddenError',
        statusCode: 403,
      }),
    );
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when agent tries to change a locked record', async () => {
    mockService.updateCddStatus = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('CDD is locked'), { name: 'ForbiddenError', statusCode: 403 }),
      );
    const app = createAgentApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });
    expect(res.status).toBe(403);
  });

  it('returns 200 and calls updateCddStatus with isAdmin=true when admin patches', async () => {
    mockService.updateCddStatus = jest.fn().mockResolvedValue(undefined);
    mockAgentRepo.getComplianceStatus.mockResolvedValue(mockComplianceStatus);
    const app = createAdminApp();
    const res = await request(app)
      .patch('/agent/sellers/seller-1/cdd/status')
      .send({ status: 'not_started' });
    expect(res.status).toBe(200);
    expect(mockService.updateCddStatus).toHaveBeenCalledWith(
      'seller-1',
      'not_started',
      'admin-1',
      true,
    );
  });
});
