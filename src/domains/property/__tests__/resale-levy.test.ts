import { getResaleLevy } from '../resale-levy';
import type { FlatType } from '../financial.types';

describe('getResaleLevy', () => {
  describe('subsidised flats (second-timer)', () => {
    it.each([
      ['2 ROOM', 15000],
      ['3 ROOM', 30000],
      ['4 ROOM', 40000],
      ['5 ROOM', 45000],
      ['EXECUTIVE', 50000],
      ['MULTI-GENERATION', 50000],
    ] as [FlatType, number][])(
      'returns correct levy for %s subsidised flat (second-timer)',
      (flatType, expected) => {
        expect(getResaleLevy(flatType, 'subsidised', false)).toBe(expected);
      },
    );
  });

  describe('first-timer pays no levy even if subsidised', () => {
    it.each([['2 ROOM'], ['3 ROOM'], ['4 ROOM'], ['5 ROOM'], ['EXECUTIVE'], ['MULTI-GENERATION']] as [FlatType][])(
      'returns 0 for %s subsidised flat (first-timer)',
      (flatType) => {
        expect(getResaleLevy(flatType, 'subsidised', true)).toBe(0);
      },
    );
  });

  describe('non-subsidised flats', () => {
    it.each([
      ['2 ROOM', 0],
      ['3 ROOM', 0],
      ['4 ROOM', 0],
      ['5 ROOM', 0],
      ['EXECUTIVE', 0],
    ] as [FlatType, number][])(
      'returns 0 for %s non-subsidised flat',
      (flatType, expected) => {
        expect(getResaleLevy(flatType, 'non_subsidised', false)).toBe(expected);
      },
    );
  });

  it('returns 0 for unknown flat type', () => {
    expect(getResaleLevy('UNKNOWN' as FlatType, 'subsidised', false)).toBe(0);
  });
});
