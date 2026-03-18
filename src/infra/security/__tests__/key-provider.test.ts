// Fixed test key — deterministic across runs. Never use in production.
process.env['ENCRYPTION_KEY'] = 'c'.repeat(64); // 32 bytes of 0xCC

import { EnvKeyProvider, setKeyProvider, getKeyProvider } from '../key-provider';
import crypto from 'crypto';

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
    await expect(provider.unwrapKey('bad:token:here')).rejects.toThrow('Failed to unwrap key');
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

  it('getKeyProvider throws if ENCRYPTION_KEY is missing when using env provider', () => {
    const saved = process.env['ENCRYPTION_KEY'];
    delete process.env['ENCRYPTION_KEY'];
    delete process.env['KEY_PROVIDER'];
    expect(() => getKeyProvider()).toThrow('ENCRYPTION_KEY');
    process.env['ENCRYPTION_KEY'] = saved!;
  });
});
