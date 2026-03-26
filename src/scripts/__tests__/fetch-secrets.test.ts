import { parseCredentials, computeSignature, formatExportLine } from '../fetch-secrets';

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
});
