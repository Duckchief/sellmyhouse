// src/domains/public/__tests__/hdb-transactions.router.test.ts
import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import { publicRouter } from '../public.router';
import { HdbService } from '../../hdb/service';

jest.mock('../../hdb/service');

function buildApp() {
  const app = express();
  app.set('view engine', 'njk');
  const env = nunjucks.configure('src/views', { autoescape: true, express: app });
  env.addFilter('formatPrice', (n: unknown) => String(n));
  env.addFilter('t', (s: string) => s);
  app.use(express.json());
  app.use(publicRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const makeTxn = (id: string) => ({
  id,
  month: '2024-01',
  town: 'TAMPINES',
  flatType: '4 ROOM',
  block: id,
  streetName: 'ST',
  storeyRange: '01 TO 03',
  floorAreaSqm: 90,
  flatModel: 'A',
  leaseCommenceDate: 1995,
  remainingLease: null,
  resalePrice: { toNumber: () => 500000 } as any,
  source: 'csv_seed' as const,
  createdAt: new Date(),
});

const paginatedResult = {
  transactions: [makeTxn('1'), makeTxn('2')],
  total: 25,
  page: 1,
  pageSize: 10,
  totalPages: 3,
};

describe('GET /api/hdb/transactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when town or flatType missing', async () => {
    jest.spyOn(HdbService.prototype, 'getPaginatedTransactions').mockResolvedValue(paginatedResult);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/transactions?town=TAMPINES')
      .set('HX-Request', 'true');

    expect(res.status).toBe(400);
  });

  it('returns 200 and calls service with correct params for HTMX requests', async () => {
    const spy = jest
      .spyOn(HdbService.prototype, 'getPaginatedTransactions')
      .mockResolvedValue(paginatedResult);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/transactions?town=TAMPINES&flatType=4+ROOM&page=1')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ town: 'TAMPINES', flatType: '4 ROOM' }),
      1,
      10,
    );
  });

  it('calculates correct offset for page 2', async () => {
    const spy = jest
      .spyOn(HdbService.prototype, 'getPaginatedTransactions')
      .mockResolvedValue({ ...paginatedResult, page: 2 });
    const app = buildApp();

    await request(app)
      .get('/api/hdb/transactions?town=TAMPINES&flatType=4+ROOM&page=2')
      .set('HX-Request', 'true');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 2, 10);
  });
});
