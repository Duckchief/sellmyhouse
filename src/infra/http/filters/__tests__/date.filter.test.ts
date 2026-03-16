// src/infra/http/filters/__tests__/date.filter.test.ts
import { dateFilter } from '../date.filter';

// Pin a known UTC timestamp: 2026-03-14T01:30:00.000Z = 14 Mar 2026 09:30 SGT
const UTC_TS = '2026-03-14T01:30:00.000Z';
const UTC_DATE = new Date(UTC_TS);

describe('dateFilter', () => {
  describe('null / undefined / empty', () => {
    it('returns empty string for null', () => {
      expect(dateFilter(null)).toBe('');
    });
    it('returns empty string for undefined', () => {
      expect(dateFilter(undefined)).toBe('');
    });
    it('returns empty string for empty string', () => {
      expect(dateFilter('')).toBe('');
    });
  });

  describe('now (copyright year)', () => {
    it('returns current year string for "now"', () => {
      const year = new Date().getFullYear().toString();
      expect(dateFilter('now')).toBe(year);
      expect(dateFilter('now', 'YYYY')).toBe(year);
    });
  });

  describe('default format (no arg) → DD MMM YYYY HH:mm SGT', () => {
    it('formats ISO string as "14 Mar 2026 09:30"', () => {
      expect(dateFilter(UTC_TS)).toBe('14 Mar 2026 09:30');
    });
    it('formats Date object', () => {
      expect(dateFilter(UTC_DATE)).toBe('14 Mar 2026 09:30');
    });
    it('normalises midnight — does not render as "24:00"', () => {
      // 2026-03-13T16:00:00.000Z = 14 Mar 2026 00:00 SGT
      expect(dateFilter('2026-03-13T16:00:00.000Z')).toBe('14 Mar 2026 00:00');
    });
  });

  describe('DD MMM YYYY (date-only)', () => {
    it('formats as "14 Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'DD MMM YYYY')).toBe('14 Mar 2026');
    });
    it('D MMM YYYY also formats as "14 Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'D MMM YYYY')).toBe('14 Mar 2026');
    });
  });

  describe('D MMM YYYY HH:mm (explicit datetime)', () => {
    it('formats as "14 Mar 2026 09:30"', () => {
      expect(dateFilter(UTC_TS, 'D MMM YYYY HH:mm')).toBe('14 Mar 2026 09:30');
    });
  });

  describe('YYYY (year only)', () => {
    it('returns "2026"', () => {
      expect(dateFilter(UTC_TS, 'YYYY')).toBe('2026');
    });
  });

  describe('short (Mon YYYY)', () => {
    it('formats as "Mar 2026"', () => {
      expect(dateFilter(UTC_TS, 'short')).toBe('Mar 2026');
    });
  });

  describe('relative', () => {
    it('returns "just now" for < 1 minute ago', () => {
      const recent = new Date(Date.now() - 30_000);
      expect(dateFilter(recent, 'relative')).toBe('just now');
    });
    it('returns "X minutes ago" for < 1 hour ago', () => {
      const ago = new Date(Date.now() - 5 * 60_000);
      expect(dateFilter(ago, 'relative')).toBe('5 minutes ago');
    });
    it('returns "1 hour ago" for ~1 hour ago', () => {
      const ago = new Date(Date.now() - 70 * 60_000);
      expect(dateFilter(ago, 'relative')).toBe('1 hour ago');
    });
    it('returns "X hours ago" for < 24 hours ago', () => {
      const ago = new Date(Date.now() - 3 * 3600_000);
      expect(dateFilter(ago, 'relative')).toBe('3 hours ago');
    });
    it('returns "1 day ago" for ~1 day ago', () => {
      const ago = new Date(Date.now() - 25 * 3600_000);
      expect(dateFilter(ago, 'relative')).toBe('1 day ago');
    });
    it('returns "X days ago" for < 30 days ago', () => {
      const ago = new Date(Date.now() - 5 * 86400_000);
      expect(dateFilter(ago, 'relative')).toBe('5 days ago');
    });
    it('falls back to default format for old dates', () => {
      // 40 days ago — should fall back to DD MMM YYYY HH:mm
      const old = new Date(Date.now() - 40 * 86400_000);
      const result = dateFilter(old, 'relative');
      // Just check it looks like a date, not "X days ago"
      expect(result).toMatch(/\d{1,2} \w{3} \d{4} \d{2}:\d{2}/);
    });
  });

  describe('invalid input', () => {
    it('returns empty string for invalid date string', () => {
      expect(dateFilter('not-a-date')).toBe('');
    });
  });
});
