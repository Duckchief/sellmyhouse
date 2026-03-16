// src/infra/http/filters/date.filter.ts

const TZ = 'Asia/Singapore';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value as string | number);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parts(d: Date) {
  // Extract date/time parts in SGT using Intl
  const fmt = new Intl.DateTimeFormat('en-SG', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(({ type, value }) => [type, value]));
  return {
    day: parseInt(p.day, 10),
    month: parseInt(p.month, 10) - 1, // 0-indexed
    year: p.year,
    hour: p.hour === '24' ? '00' : p.hour,
    minute: p.minute,
  };
}

function formatDefault(d: Date): string {
  const { day, month, year, hour, minute } = parts(d);
  return `${day} ${MONTHS[month]} ${year} ${hour}:${minute}`;
}

function formatDateOnly(d: Date): string {
  const { day, month, year } = parts(d);
  return `${day} ${MONTHS[month]} ${year}`;
}

function formatShort(d: Date): string {
  const { month, year } = parts(d);
  return `${MONTHS[month]} ${year}`;
}

function formatYear(d: Date): string {
  return parts(d).year;
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return formatDefault(d);
}

export function dateFilter(value: unknown, format?: string): string {
  // Special case: copyright year
  if (value === 'now') return new Date().getFullYear().toString();

  const d = toDate(value);
  if (!d) return '';

  switch (format) {
    case 'DD MMM YYYY':
    case 'D MMM YYYY':
      return formatDateOnly(d);
    case 'D MMM YYYY HH:mm':
    case 'DD MMM YYYY HH:mm':
      return formatDefault(d);
    case 'YYYY':
      return formatYear(d);
    case 'short':
      return formatShort(d);
    case 'relative':
      return formatRelative(d);
    default:
      return formatDefault(d);
  }
}
