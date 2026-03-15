import * as sellerService from '../seller.service';
import * as propertyService from '../../property/property.service';
import { TOTAL_ONBOARDING_STEPS } from '../seller.types';
import type { VideoTutorial } from '@prisma/client';

jest.mock('../seller.service');
jest.mock('../../property/property.service');
jest.mock('../../notification/notification.repository', () => ({
  countUnreadForRecipient: jest.fn().mockResolvedValue(0),
  findUnreadForRecipient: jest.fn().mockResolvedValue([]),
}));
jest.mock('../case-flag.service', () => ({
  getCaseFlagsForSeller: jest.fn().mockResolvedValue([]),
  getChecklistForType: jest.fn().mockReturnValue([]),
}));

const mockedService = jest.mocked(sellerService);
const mockedPropertyService = jest.mocked(propertyService);

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { sellerRouter } from '../seller.router';

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
  app.set('view engine', 'njk');

  // Mock authenticated seller
  app.use((req, _res, next) => {
    req.user = {
      id: 'seller-1',
      role: 'seller',
      email: 'test@test.local',
      name: 'Test',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });

  app.use(sellerRouter);
  return app;
}

describe('seller.router', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /seller/dashboard', () => {
    it('redirects to onboarding if not complete', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: {
          id: 'seller-1',
          name: 'Test',
          email: 'test@test.local',
          phone: '91234567',
          status: 'lead',
          onboardingStep: 2,
        },
        onboarding: { currentStep: 2, isComplete: false, completedSteps: [1, 2] },
        property: null,
        propertyStatus: null,
        transactionStatus: null,
        caseFlags: [],
        upcomingViewings: 0,
        totalViewings: 0,
        unreadNotificationCount: 0,
        nextSteps: [],
      });

      const res = await request(app).get('/seller/dashboard');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');
    });

    it('renders dashboard when onboarding is complete', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: {
          id: 'seller-1',
          name: 'Test',
          email: 'test@test.local',
          phone: '91234567',
          status: 'engaged',
          onboardingStep: 5,
        },
        onboarding: { currentStep: 5, isComplete: true, completedSteps: [1, 2, 3, 4, 5] },
        property: null,
        propertyStatus: null,
        transactionStatus: null,
        caseFlags: [],
        upcomingViewings: 0,
        totalViewings: 0,
        unreadNotificationCount: 3,
        nextSteps: [],
      });

      const res = await request(app).get('/seller/dashboard');

      expect(res.status).toBe(200);
    });

    it('returns HTMX partial when hx-request is set', async () => {
      mockedService.getDashboardOverview.mockResolvedValue({
        seller: {
          id: 'seller-1',
          name: 'Test',
          email: 'test@test.local',
          phone: '91234567',
          status: 'engaged',
          onboardingStep: 5,
        },
        onboarding: { currentStep: 5, isComplete: true, completedSteps: [1, 2, 3, 4, 5] },
        property: null,
        propertyStatus: null,
        transactionStatus: null,
        caseFlags: [],
        upcomingViewings: 0,
        totalViewings: 0,
        unreadNotificationCount: 0,
        nextSteps: [],
      });

      const res = await request(app).get('/seller/dashboard').set('HX-Request', 'true');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /seller/onboarding', () => {
    it('renders onboarding page', async () => {
      mockedService.getOnboardingStatus.mockResolvedValue({
        currentStep: 0,
        isComplete: false,
        completedSteps: [],
      });

      const res = await request(app).get('/seller/onboarding');

      expect(res.status).toBe(200);
    });

    it('redirects to dashboard if onboarding is complete', async () => {
      mockedService.getOnboardingStatus.mockResolvedValue({
        currentStep: TOTAL_ONBOARDING_STEPS,
        isComplete: true,
        completedSteps: [1, 2, 3, 4, 5],
      });

      const res = await request(app).get('/seller/onboarding');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/dashboard');
    });
  });

  describe('POST /seller/onboarding/step/:step', () => {
    it('completes step and returns next step partial for HTMX', async () => {
      mockedService.completeOnboardingStep.mockResolvedValue({ onboardingStep: 2 });
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);
      mockedPropertyService.createProperty.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/seller/onboarding/step/2')
        .set('HX-Request', 'true')
        .send({
          town: 'TAMPINES',
          street: 'Tampines St 11',
          block: '123',
          flatType: '4 ROOM',
          storeyRange: '07 TO 09',
          floorAreaSqm: '95',
          flatModel: 'Model A',
          leaseCommenceDate: '1995',
        });

      expect(res.status).toBe(200);
      expect(mockedService.completeOnboardingStep).toHaveBeenCalledWith({
        sellerId: 'seller-1',
        step: 2,
      });
    });

    it('redirects to dashboard after completing last step', async () => {
      mockedService.completeOnboardingStep.mockResolvedValue({
        onboardingStep: TOTAL_ONBOARDING_STEPS,
      });

      const res = await request(app)
        .post(`/seller/onboarding/step/${TOTAL_ONBOARDING_STEPS}`)
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(res.headers['hx-redirect']).toBe('/seller/dashboard');
    });
  });

  describe('GET /seller/my-data', () => {
    it('renders My Data page', async () => {
      mockedService.getMyData.mockResolvedValue({
        personalInfo: { name: 'Test', email: 'test@test.local', phone: '91234567' },
        consentStatus: {
          service: true,
          marketing: false,
          consentTimestamp: new Date(),
          withdrawnAt: null,
        },
        consentHistory: [],
        dataActions: {
          canRequestCorrection: true,
          canRequestDeletion: true,
          canWithdrawConsent: true,
        },
      });

      const res = await request(app).get('/seller/my-data');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /seller/tutorials', () => {
    it('renders tutorials page with grouped data', async () => {
      mockedService.getTutorialsGrouped.mockResolvedValue({
        photography: [{ id: 't1', title: 'Photo tips' } as unknown as VideoTutorial],
      });

      const res = await request(app).get('/seller/tutorials');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /seller/settings', () => {
    it('renders settings page for authenticated seller', async () => {
      mockedService.getSellerSettings = jest
        .fn()
        .mockResolvedValue({ notificationPreference: 'whatsapp_and_email' });

      const res = await request(app).get('/seller/settings');

      expect(res.status).toBe(200);
      expect(mockedService.getSellerSettings).toHaveBeenCalledWith('seller-1');
    });

    it('returns HTMX partial when HX-Request header is set', async () => {
      mockedService.getSellerSettings = jest
        .fn()
        .mockResolvedValue({ notificationPreference: 'whatsapp_and_email' });

      const res = await request(app).get('/seller/settings').set('HX-Request', 'true');

      expect(res.status).toBe(200);
    });
  });

  describe('PUT /seller/settings/notifications', () => {
    it('updates preference and returns 200', async () => {
      mockedService.updateNotificationPreference = jest
        .fn()
        .mockResolvedValue({ notificationPreference: 'email_only' });

      const res = await request(app)
        .put('/seller/settings/notifications')
        .set('HX-Request', 'true')
        .send({ preference: 'email_only' });

      expect(res.status).toBe(200);
      expect(mockedService.updateNotificationPreference).toHaveBeenCalledWith(
        expect.objectContaining({ preference: 'email_only', sellerId: 'seller-1' }),
      );
    });

    it('returns 400 for invalid preference value', async () => {
      const res = await request(app)
        .put('/seller/settings/notifications')
        .send({ preference: 'invalid_value' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /seller/case-flags', () => {
    it('renders case flags page for authenticated seller', async () => {
      const res = await request(app).get('/seller/case-flags');
      expect(res.status).toBe(200);
    });

    it('returns HTMX partial when HX-Request header is set', async () => {
      const res = await request(app).get('/seller/case-flags').set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });
  });
});
