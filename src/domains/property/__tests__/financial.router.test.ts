import express from 'express';
import request from 'supertest';
import type { FinancialReport } from '@prisma/client';
import { financialRouter } from '../financial.router';
import * as financialService from '../financial.service';

jest.mock('../financial.service');

const mockService = financialService as jest.Mocked<typeof financialService>;

// Stub res.render so tests don't need a full Nunjucks setup
function addRenderStub(app: express.Express) {
  app.use((_req, res, next) => {
    res.render = (_view: string, _data?: object) => {
      res.status(200).send('');
    };
    next();
  });
}

// Minimal app setup for testing with seller auth
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  addRenderStub(app);

  // Mock authenticated seller
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'seller-1',
        role: 'seller',
        name: 'Test Seller',
        email: 'test@test.com',
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
    });
    next();
  });

  app.use(financialRouter);
  return app;
}

// App with agent auth for agent-only routes
function createAgentTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  addRenderStub(app);

  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
    });
    next();
  });

  app.use(financialRouter);
  return app;
}

describe('financial.router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /seller/financial/calculate', () => {
    it('calculates and returns report', async () => {
      mockService.calculateAndCreateReport.mockResolvedValue({
        id: 'report-1',
        version: 1,
        reportData: { outputs: { netCashProceeds: 127857 } },
      } as unknown as FinancialReport);
      mockService.generateNarrative.mockResolvedValue(undefined);

      const app = createTestApp();
      const res = await request(app).post('/seller/financial/calculate').send({
        salePrice: 500000,
        outstandingLoan: 200000,
        cpfOaUsed: 100000,
        purchaseYear: 2016,
        flatType: '4 ROOM',
        subsidyType: 'subsidised',
        isFirstTimer: true,
        propertyId: 'property-1',
        town: 'TAMPINES',
        leaseCommenceDate: 1995,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.report.id).toBe('report-1');
      expect(mockService.calculateAndCreateReport).toHaveBeenCalled();
      // generateNarrative is fire-and-forget — it's called but doesn't block the response
      expect(mockService.generateNarrative).toHaveBeenCalledWith('report-1');
    });

    it('returns 400 for invalid input', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/seller/financial/calculate')
        .send({ salePrice: -1, flatType: '4 ROOM' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /seller/financial', () => {
    it('renders the financial page for non-HTMX requests', async () => {
      mockService.getReportsForSeller.mockResolvedValue([
        { id: 'r1', version: 2 },
        { id: 'r2', version: 1 },
      ] as unknown as FinancialReport[]);

      const app = createTestApp();
      const res = await request(app).get('/seller/financial');

      expect(res.status).toBe(200);
      expect(mockService.getReportsForSeller).toHaveBeenCalledWith('seller-1');
    });

    it('renders financial-list partial for HTMX requests', async () => {
      mockService.getReportsForSeller.mockResolvedValue([
        { id: 'r1', version: 2 },
      ] as unknown as FinancialReport[]);

      const app = createTestApp();
      const res = await request(app).get('/seller/financial').set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockService.getReportsForSeller).toHaveBeenCalledWith('seller-1');
    });
  });

  describe('GET /seller/financial/form', () => {
    it('renders the calculator form partial', async () => {
      const app = createTestApp();
      const res = await request(app).get('/seller/financial/form');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /seller/financial/report/:id', () => {
    it('returns a specific report for the owning seller', async () => {
      mockService.getReportForSeller.mockResolvedValue({
        id: 'report-1',
        sellerId: 'seller-1',
        reportData: {},
      } as unknown as FinancialReport);

      const app = createTestApp();
      const res = await request(app).get('/seller/financial/report/report-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockService.getReportForSeller).toHaveBeenCalledWith('report-1', 'seller-1');
    });

    it('returns 403 when seller tries to access another seller report', async () => {
      const { ForbiddenError } = await import('@/domains/shared/errors');
      mockService.getReportForSeller.mockRejectedValue(
        new ForbiddenError('You do not own this report'),
      );

      const app = createTestApp();
      const res = await request(app).get('/seller/financial/report/report-other');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/financial/report/:id/approve', () => {
    it('agent approves report', async () => {
      mockService.approveReport.mockResolvedValue(undefined);

      const app = createAgentTestApp();
      const res = await request(app)
        .post('/api/v1/financial/report/report-1/approve')
        .send({ reviewNotes: 'Looks good' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Report approved');
      expect(mockService.approveReport).toHaveBeenCalledWith({
        reportId: 'report-1',
        agentId: 'agent-1',
        reviewNotes: 'Looks good',
      });
    });

    it('rejects non-agent users', async () => {
      const app = createTestApp(); // seller auth
      const res = await request(app).post('/api/v1/financial/report/report-1/approve').send({});

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/financial/report/:id/send', () => {
    it('sends report to seller', async () => {
      mockService.sendReport.mockResolvedValue(undefined);

      const app = createAgentTestApp();
      const res = await request(app)
        .post('/api/v1/financial/report/report-1/send')
        .send({ channel: 'whatsapp' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Report sent to seller');
      expect(mockService.sendReport).toHaveBeenCalledWith({
        reportId: 'report-1',
        agentId: 'agent-1',
        channel: 'whatsapp',
      });
    });

    it('rejects non-agent users', async () => {
      const app = createTestApp(); // seller auth
      const res = await request(app)
        .post('/api/v1/financial/report/report-1/send')
        .send({ channel: 'whatsapp' });

      expect(res.status).toBe(403);
    });
  });
});
