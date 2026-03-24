import * as financialService from '../financial.service';
import * as sellerService from '@/domains/seller/seller.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as propertyService from '@/domains/property/property.service';

jest.mock('../financial.service');
jest.mock('@/domains/seller/seller.service');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/property/property.service');
jest.mock('@/domains/shared/audit.service', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const mockedFinancialService = jest.mocked(financialService);
const mockedSellerService = jest.mocked(sellerService);
const mockedSettingsService = jest.mocked(settingsService);
const mockedPropertyService = jest.mocked(propertyService);

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { financialRouter } from '../financial.router';

function createTestApp() {
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
  env.addFilter('formatPrice', (n: unknown) => String(n));
  app.set('view engine', 'njk');

  app.use((req, res, next) => {
    const user = {
      id: 'seller-1',
      role: 'seller' as const,
      email: 'test@test.local',
      name: 'Test',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.user = user;
    res.locals.user = user;
    res.locals.hasAvatar = false;
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });

  app.use(financialRouter);
  return app;
}

const mockCommission = {
  amount: 1499,
  gstRate: 0.09,
  total: 1633.91,
};

const mockSaleProceeds = {
  sellingPrice: 500000,
  outstandingLoan: 200000,
  cpfSeller1: 50000,
  cpfSeller2: null,
  cpfSeller3: null,
  cpfSeller4: null,
  resaleLevy: 0,
  otherDeductions: 0,
  commission: 1633.91,
  netProceeds: 248366.09,
};

describe('GET /seller/financial (hub)', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue(mockCommission);
  });

  it('renders financial hub with saleProceeds and reports', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue(mockSaleProceeds);
    mockedFinancialService.getApprovedReportsForSeller = jest.fn().mockResolvedValue([]);

    const res = await request(app).get('/seller/financial');

    expect(res.status).toBe(200);
    expect(mockedSellerService.getSaleProceeds).toHaveBeenCalledWith('seller-1');
    expect(mockedFinancialService.getApprovedReportsForSeller).toHaveBeenCalledWith('seller-1');
  });

  it('returns HTMX partial when hx-request is set', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue(null);
    mockedFinancialService.getApprovedReportsForSeller = jest.fn().mockResolvedValue([]);

    const res = await request(app).get('/seller/financial').set('HX-Request', 'true');

    expect(res.status).toBe(200);
  });
});

describe('GET /seller/financial/estimate/edit', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue(mockCommission);
  });

  it('renders the sale proceeds form for editing', async () => {
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue(mockSaleProceeds);
    mockedPropertyService.getPropertyForSeller = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/seller/financial/estimate/edit');

    expect(res.status).toBe(200);
  });
});

describe('POST /seller/financial/estimate', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    mockedSettingsService.getCommission = jest.fn().mockResolvedValue(mockCommission);
  });

  it('saves sale proceeds and returns updated estimate summary', async () => {
    mockedSellerService.saveSaleProceeds = jest.fn().mockResolvedValue(mockSaleProceeds);
    mockedSellerService.getSaleProceeds = jest.fn().mockResolvedValue(mockSaleProceeds);

    const res = await request(app)
      .post('/seller/financial/estimate')
      .set('HX-Request', 'true')
      .send({
        sellingPrice: '500000',
        outstandingLoan: '200000',
        cpfSeller1: '50000',
        resaleLevy: '0',
        otherDeductions: '0',
        buyerDeposit: '3000',
      });

    expect(res.status).toBe(200);
    expect(mockedSellerService.saveSaleProceeds).toHaveBeenCalledWith(
      expect.objectContaining({ buyerDeposit: 3000 }),
    );
    expect(mockedSellerService.saveSaleProceeds).toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/seller/financial/estimate')
      .set('HX-Request', 'true')
      .send({ sellingPrice: '500000' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when buyer deposit exceeds $5000', async () => {
    const res = await request(app)
      .post('/seller/financial/estimate')
      .set('HX-Request', 'true')
      .send({
        sellingPrice: '500000',
        outstandingLoan: '200000',
        cpfSeller1: '50000',
        resaleLevy: '0',
        otherDeductions: '0',
        buyerDeposit: '9999',
      });

    expect(res.status).toBe(400);
  });
});
