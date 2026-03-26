import {
  parseCredentials,
  computeSignature,
  formatExportLine,
  fetchSecrets,
  getApiBaseUrl,
  main,
} from '../fetch-secrets';
import type { OvhCredentials } from '../fetch-secrets';
import * as https from 'https';
import * as fs from 'fs';

// Mock https and fs
jest.mock('https');
jest.mock('fs');

describe('fetch-secrets', () => {
  describe('parseCredentials', () => {
    it('parses a valid credentials file', () => {
      const content = [
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        'OVH_APP_SECRET=secret456',
        'OVH_CONSUMER_KEY=consumer789',
        'OVH_PROJECT_ID=proj-abc',
        'OVH_REGION=sgp1',
        'OVH_VAULT_ID=vault-xyz',
      ].join('\n');

      const creds = parseCredentials(content);

      expect(creds).toEqual({
        endpoint: 'ovh-eu',
        appKey: 'app123',
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        projectId: 'proj-abc',
        region: 'sgp1',
        vaultId: 'vault-xyz',
      });
    });

    it('throws on missing required field', () => {
      const content = [
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        // missing OVH_APP_SECRET and others
      ].join('\n');

      expect(() => parseCredentials(content)).toThrow(
        'Missing required credential: OVH_APP_SECRET',
      );
    });

    it('ignores blank lines and comments', () => {
      const content = [
        '# This is a comment',
        '',
        'OVH_ENDPOINT=ovh-eu',
        'OVH_APP_KEY=app123',
        'OVH_APP_SECRET=secret456',
        '  ',
        'OVH_CONSUMER_KEY=consumer789',
        'OVH_PROJECT_ID=proj-abc',
        'OVH_REGION=sgp1',
        'OVH_VAULT_ID=vault-xyz',
      ].join('\n');

      const creds = parseCredentials(content);
      expect(creds.appKey).toBe('app123');
    });
  });

  describe('computeSignature', () => {
    it('computes the OVHcloud HMAC-SHA1 signature', () => {
      const sig = computeSignature({
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
        timestamp: '1711500000',
      });

      expect(sig).toMatch(/^\$1\$[a-f0-9]{40}$/);

      // Verify deterministic
      const sig2 = computeSignature({
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
        timestamp: '1711500000',
      });
      expect(sig).toBe(sig2);
    });

    it('produces different signatures for different timestamps', () => {
      const params = {
        appSecret: 'secret456',
        consumerKey: 'consumer789',
        method: 'GET',
        url: 'https://eu.api.ovh.com/v1/auth/time',
        body: '',
      };

      const sig1 = computeSignature({ ...params, timestamp: '1711500000' });
      const sig2 = computeSignature({ ...params, timestamp: '1711500001' });
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('formatExportLine', () => {
    it('formats a simple key-value pair', () => {
      expect(formatExportLine('DATABASE_URL', 'postgresql://localhost/db')).toBe(
        "export DATABASE_URL='postgresql://localhost/db'",
      );
    });

    it('escapes single quotes in values', () => {
      expect(formatExportLine('KEY', "value'with'quotes")).toBe(
        "export KEY='value'\"'\"'with'\"'\"'quotes'",
      );
    });

    it('handles empty values', () => {
      expect(formatExportLine('EMPTY', '')).toBe("export EMPTY=''");
    });

    it('handles values with spaces and special characters', () => {
      expect(formatExportLine('PASS', 'p@ss w0rd!$&')).toBe(
        "export PASS='p@ss w0rd!$&'",
      );
    });
  });

  describe('getApiBaseUrl', () => {
    it('maps ovh-eu to eu.api.ovh.com', () => {
      expect(getApiBaseUrl('ovh-eu')).toBe('https://eu.api.ovh.com/v1');
    });

    it('maps ovh-ca to ca.api.ovh.com', () => {
      expect(getApiBaseUrl('ovh-ca')).toBe('https://ca.api.ovh.com/v1');
    });

    it('maps ovh-us to api.us.ovhcloud.com', () => {
      expect(getApiBaseUrl('ovh-us')).toBe('https://api.us.ovhcloud.com/v1');
    });

    it('throws on unknown endpoint', () => {
      expect(() => getApiBaseUrl('ovh-invalid')).toThrow('Unknown OVH endpoint: ovh-invalid');
    });
  });

  describe('fetchSecrets', () => {
    const mockCredentials: OvhCredentials = {
      endpoint: 'ovh-eu',
      appKey: 'app123',
      appSecret: 'secret456',
      consumerKey: 'consumer789',
      projectId: 'proj-abc',
      region: 'sgp1',
      vaultId: 'vault-xyz',
    };

    beforeEach(() => {
      jest.resetAllMocks();
    });

    it('fetches time, lists secrets, fetches each payload', async () => {
      const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

      const createMockResponse = (statusCode: number, body: string) => {
        return (_opts: unknown, callback: (res: unknown) => void) => {
          const res: { statusCode: number; on: jest.Mock } = {
            statusCode,
            on: jest.fn((event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(body));
              if (event === 'end') handler();
              return res;
            }),
          };
          callback(res);
          return {
            on: jest.fn().mockReturnThis(),
            end: jest.fn(),
          };
        };
      };

      mockRequest
        .mockImplementationOnce(createMockResponse(200, '1711500000') as unknown as typeof https.request)
        .mockImplementationOnce(
          createMockResponse(
            200,
            JSON.stringify([
              { id: 'sec-1', name: 'DATABASE_URL' },
              { id: 'sec-2', name: 'SESSION_SECRET' },
            ]),
          ) as unknown as typeof https.request,
        )
        .mockImplementationOnce(
          createMockResponse(
            200,
            JSON.stringify({ name: 'DATABASE_URL', payload: 'postgresql://prod:pass@host/db' }),
          ) as unknown as typeof https.request,
        )
        .mockImplementationOnce(
          createMockResponse(
            200,
            JSON.stringify({ name: 'SESSION_SECRET', payload: 'super-secret-session' }),
          ) as unknown as typeof https.request,
        );

      const secrets = await fetchSecrets(mockCredentials);

      expect(secrets).toEqual({
        DATABASE_URL: 'postgresql://prod:pass@host/db',
        SESSION_SECRET: 'super-secret-session',
      });

      expect(mockRequest).toHaveBeenCalledTimes(4);
    });

    it('throws on non-200 response from secret list', async () => {
      const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

      const createMockResponse = (statusCode: number, body: string) => {
        return (_opts: unknown, callback: (res: unknown) => void) => {
          const res: { statusCode: number; on: jest.Mock } = {
            statusCode,
            on: jest.fn((event: string, handler: (data?: unknown) => void) => {
              if (event === 'data') handler(Buffer.from(body));
              if (event === 'end') handler();
              return res;
            }),
          };
          callback(res);
          return {
            on: jest.fn().mockReturnThis(),
            end: jest.fn(),
          };
        };
      };

      mockRequest
        .mockImplementationOnce(createMockResponse(200, '1711500000') as unknown as typeof https.request)
        .mockImplementationOnce(
          createMockResponse(403, JSON.stringify({ message: 'Forbidden' })) as unknown as typeof https.request,
        );

      await expect(fetchSecrets(mockCredentials)).rejects.toThrow('OVHcloud API error (403)');
    });
  });

  describe('main', () => {
    const originalEnv = process.env;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let processExitSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.resetAllMocks();
      process.env = { ...originalEnv };
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    });

    afterEach(() => {
      process.env = originalEnv;
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('skips when OVH_CREDENTIALS_PATH is not set', async () => {
      delete process.env['OVH_CREDENTIALS_PATH'];

      await main();

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('skips when NODE_ENV is development', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['OVH_CREDENTIALS_PATH'] = '/some/path';

      await main();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('exits with code 1 when credentials file is missing', async () => {
      process.env['OVH_CREDENTIALS_PATH'] = '/nonexistent/path';
      process.env['NODE_ENV'] = 'production';

      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      await main();

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
