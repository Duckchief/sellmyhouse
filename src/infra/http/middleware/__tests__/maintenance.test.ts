import { Request, Response, NextFunction } from 'express';
import * as settingsService from '@/domains/shared/settings.service';

jest.mock('@/domains/shared/settings.service');

const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

// Import after mocking
import { maintenanceMiddleware, __clearMaintenanceCache } from '../maintenance';

function makeReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    path: '/seller/dashboard',
    isAuthenticated: (() => false) as any,
    user: undefined,
    headers: {},
    ...overrides,
  };
}

function makeRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.render = jest.fn().mockReturnValue(res);
  res.locals = {};
  return res;
}

describe('maintenanceMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    __clearMaintenanceCache();
  });

  it('passes through when maintenance_mode is false', async () => {
    mockSettings.get.mockResolvedValue('false');
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through when maintenance_mode setting is missing (defaults false)', async () => {
    mockSettings.get.mockResolvedValue('false');
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('passes through admin routes even when maintenance is on', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({ path: '/admin/maintenance' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through /health even when maintenance is on', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({ path: '/health' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through webhook paths even when maintenance is on', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({ path: '/api/webhook/whatsapp' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through for admin role', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: (() => true) as any,
      user: { id: 'u1', role: 'admin' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('passes through for agent role', async () => {
    mockSettings.get.mockResolvedValue('true');
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: (() => true) as any,
      user: { id: 'u1', role: 'agent' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.render).not.toHaveBeenCalled();
  });

  it('renders 503 maintenance page for public visitor when maintenance is on', async () => {
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'maintenance_mode') return 'true';
      return '';
    });
    const req = makeReq({ path: '/' }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
    expect(res.render).toHaveBeenCalledWith(
      'pages/public/maintenance',
      expect.objectContaining({ maintenanceMessage: '', maintenanceEta: '' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('renders 503 maintenance page for logged-in seller when maintenance is on', async () => {
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'maintenance_mode') return 'true';
      if (key === 'maintenance_message') return 'Upgrading the system.';
      return '';
    });
    const req = makeReq({
      path: '/seller/dashboard',
      isAuthenticated: (() => true) as any,
      user: { id: 'u1', role: 'seller' } as any,
    }) as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.render).toHaveBeenCalledWith(
      'pages/public/maintenance',
      expect.objectContaining({ maintenanceMessage: 'Upgrading the system.' }),
    );
  });

  it('passes error to next when settings service throws', async () => {
    const err = new Error('DB error');
    mockSettings.get.mockRejectedValue(err);
    const req = makeReq() as Request;
    const res = makeRes() as Response;

    await maintenanceMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls settings service only once for rapid sequential requests', async () => {
    mockSettings.get.mockResolvedValue('false');

    await maintenanceMiddleware(makeReq() as Request, makeRes() as Response, next);
    await maintenanceMiddleware(makeReq() as Request, makeRes() as Response, next);
    await maintenanceMiddleware(makeReq() as Request, makeRes() as Response, next);

    // Should be cached after first call — only 1 DB hit
    expect(mockSettings.get).toHaveBeenCalledTimes(1);
  });
});
