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
  env.addFilter('formatMonth', (s: string) => s);
  env.addFilter('t', (s: string) => s);
  app.use(express.json());
  app.use(publicRouter);
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    },
  );
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe('GET /api/hdb/storey-ranges', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns filtered storey range options when town and flatType provided', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctStoreyRangesByTownAndFlatType')
      .mockResolvedValue(['01 TO 03', '04 TO 06', '07 TO 09']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?town=TAMPINES&flatType=4+ROOM')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(res.text).toContain('01 TO 03');
    expect(res.text).toContain('04 TO 06');
    expect(res.text).toContain('All storeys');
    expect(HdbService.prototype.getDistinctStoreyRangesByTownAndFlatType).toHaveBeenCalledWith(
      'TAMPINES',
      '4 ROOM',
    );
  });

  it('falls back to all storey ranges when town is missing', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctStoreyRanges')
      .mockResolvedValue(['01 TO 03', '04 TO 06']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?flatType=4+ROOM')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(HdbService.prototype.getDistinctStoreyRanges).toHaveBeenCalled();
  });

  it('falls back to all storey ranges when flatType is missing', async () => {
    jest.spyOn(HdbService.prototype, 'getDistinctStoreyRanges').mockResolvedValue(['01 TO 03']);
    const app = buildApp();

    const res = await request(app)
      .get('/api/hdb/storey-ranges?town=TAMPINES')
      .set('HX-Request', 'true');

    expect(res.status).toBe(200);
    expect(HdbService.prototype.getDistinctStoreyRanges).toHaveBeenCalled();
  });
});

describe('GET /api/hdb/flat-types', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns flat types for a given town', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctFlatTypesByTown')
      .mockResolvedValue(['3 ROOM', '4 ROOM', '5 ROOM']);
    const app = buildApp();

    const res = await request(app).get('/api/hdb/flat-types?town=BISHAN');

    expect(res.status).toBe(200);
    expect(res.text).toContain('3 ROOM');
    expect(res.text).toContain('4 ROOM');
    expect(res.text).toContain('5 ROOM');
    // OOB reset element must be present
    expect(res.text).toContain('id="storey-range-select"');
    expect(res.text).toContain('hx-swap-oob="innerHTML"');
  });

  it('falls back to all flat types when town param is missing', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctFlatTypes')
      .mockResolvedValue(['3 ROOM', '4 ROOM']);
    const app = buildApp();

    const res = await request(app).get('/api/hdb/flat-types');

    expect(res.status).toBe(200);
    expect(res.text).toContain('3 ROOM');
  });

  it('returns empty options (only placeholder) when town has no data', async () => {
    jest
      .spyOn(HdbService.prototype, 'getDistinctFlatTypesByTown')
      .mockResolvedValue([]);
    const app = buildApp();

    const res = await request(app).get('/api/hdb/flat-types?town=UNKNOWN');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Select type');
    // No flat type option values beyond the placeholder
    expect(res.text).not.toMatch(/<option value="[^"]+">[\w ]+<\/option>/);
  });
});
