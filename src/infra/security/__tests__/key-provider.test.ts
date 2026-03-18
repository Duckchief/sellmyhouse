import crypto from 'crypto';

// Set ENCRYPTION_KEY before importing the module
process.env['ENCRYPTION_KEY'] = crypto.randomBytes(32).toString('hex');

import { EnvKeyProvider, setKeyProvider, getKeyProvider } from '../key-provider';

beforeEach(() => {
  setKeyProvider(null);
});

describe('EnvKeyProvider', () => {
  it('wrapKey then unwrapKey round-trips a 32-byte data key', async () => {
    const provider = new EnvKeyProvider();
    const dataKey = crypto.randomBytes(32);
    const wrapped = await provider.wrapKey(dataKey);
    const unwrapped = await provider.unwrapKey(wrapped);
    expect(unwrapped).toEqual(dataKey);
  });

  it('wrapKey returns a non-empty string', async () => {
    const provider = new EnvKeyProvider();
    const wrapped = await provider.wrapKey(crypto.randomBytes(32));
    expect(typeof wrapped).toBe('string');
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('unwrapKey with wrong token throws', async () => {
    const provider = new EnvKeyProvider();
    await expect(provider.unwrapKey('bad:token:here')).rejects.toThrow();
  });
});

describe('getKeyProvider / setKeyProvider', () => {
  it('returns EnvKeyProvider by default (KEY_PROVIDER not set)', () => {
    delete process.env['KEY_PROVIDER'];
    const provider = getKeyProvider();
    expect(provider).toBeInstanceOf(EnvKeyProvider);
  });

  it('setKeyProvider(null) resets singleton so next call re-creates it', () => {
    const stub = { wrapKey: jest.fn(), unwrapKey: jest.fn() };
    setKeyProvider(stub);
    expect(getKeyProvider()).toBe(stub);
    setKeyProvider(null);
    expect(getKeyProvider()).toBeInstanceOf(EnvKeyProvider);
  });
});
