import { MemoryCache } from '../memory-cache';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    cache.set('key', { data: 42 }, 60_000);
    expect(cache.get<{ data: number }>('key')).toEqual({ data: 42 });
  });

  it('returns undefined for expired key', () => {
    cache.set('key', 'value', 0); // TTL of 0ms — already expired
    expect(cache.get('key')).toBeUndefined();
  });

  it('invalidates keys by prefix', () => {
    cache.set('hdb:towns', ['ANG MO KIO'], 60_000);
    cache.set('hdb:flatTypes', ['4 ROOM'], 60_000);
    cache.set('other:key', 'keep', 60_000);

    cache.invalidatePrefix('hdb:');

    expect(cache.get('hdb:towns')).toBeUndefined();
    expect(cache.get('hdb:flatTypes')).toBeUndefined();
    expect(cache.get<string>('other:key')).toBe('keep');
  });

  it('clears all entries', () => {
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
