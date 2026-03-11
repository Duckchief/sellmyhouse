// src/domains/transaction/__tests__/transaction.router.test.ts
import express from 'express';
import request from 'supertest';
import { transactionRouter } from '../transaction.router';
import * as txService from '../transaction.service';

jest.mock('../transaction.service');
jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next(),
);
jest.mock('multer', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (): any => ({
    single: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.file = { buffer: Buffer.from('fake'), originalname: 'test.pdf', size: 1024 };
      // Real multer parses multipart body fields into req.body.
      // Supertest sends multipart via .field()/.attach() but the mock doesn't parse it.
      // We need to parse the raw body to simulate multer's field extraction.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const incomingReq = req as any;
      if (!incomingReq.body) incomingReq.body = {};
      // Extract fields from multipart body via busboy-style parse isn't available here.
      // Instead, we inspect the raw incoming request buffer for field values.
      // As a pragmatic test-only approach, read the request body to extract text fields.
      const chunks: Buffer[] = [];
      incomingReq.on?.('data', (chunk: Buffer) => chunks.push(chunk));
      incomingReq.on?.('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        // Parse Content-Disposition fields from multipart
        const fieldMatches = raw.matchAll(
          /Content-Disposition: form-data; name="([^"]+)"\r\n\r\n([^\r\n-]+)/g,
        );
        for (const match of fieldMatches) {
          incomingReq.body[match[1]] = match[2];
        }
        next();
      });
      incomingReq.on?.('error', () => next());
      // If not a streaming request (already buffered), call next directly
      if (!incomingReq.on) next();
    },
  });
  fn.memoryStorage = () => ({});
  return fn;
});

const mockTxService = jest.mocked(txService);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
    });
    next();
  });
  app.use((_req, res, next) => {
    res.render = ((_view: string, _data?: unknown) => {
      res.json({ rendered: true });
    }) as never;
    next();
  });
  app.use(transactionRouter);
  return app;
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    agreedPrice: '600000',
    status: 'option_issued',
    otp: null,
    commissionInvoice: null,
    ...overrides,
  };
}

describe('transaction.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /agent/transactions', () => {
    it('creates transaction and returns 201', async () => {
      mockTxService.createTransaction.mockResolvedValue(makeTx() as never);

      const res = await request(app)
        .post('/agent/transactions')
        .send({ propertyId: 'property-1', sellerId: 'seller-1', agreedPrice: '600000' });

      expect(res.status).toBe(201);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app).post('/agent/transactions').send({ propertyId: 'property-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /agent/transactions/:id', () => {
    it('returns 200 with transaction', async () => {
      mockTxService.getTransaction.mockResolvedValue(makeTx() as never);

      const res = await request(app).get('/agent/transactions/tx-1');

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /agent/transactions/:id/status', () => {
    it('advances transaction status', async () => {
      mockTxService.advanceTransactionStatus.mockResolvedValue(
        makeTx({ status: 'option_exercised' }) as never,
      );

      const res = await request(app)
        .patch('/agent/transactions/tx-1/status')
        .send({ status: 'option_exercised' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/transactions/:id/otp', () => {
    it('creates OTP record', async () => {
      mockTxService.createOtp.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/agent/transactions/tx-1/otp')
        .send({ hdbSerialNumber: 'SN-001' });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /agent/transactions/:id/otp/advance', () => {
    it('advances OTP', async () => {
      mockTxService.advanceOtp.mockResolvedValue({} as never);

      const res = await request(app).post('/agent/transactions/tx-1/otp/advance').send({});

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/transactions/:id/invoice/upload', () => {
    it('uploads invoice PDF', async () => {
      mockTxService.uploadInvoice.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/agent/transactions/tx-1/invoice/upload')
        .field('invoiceNumber', 'INV-001')
        .attach('invoice', Buffer.from('fake-pdf'), 'invoice.pdf');

      expect(res.status).toBe(201);
    });
  });
});
