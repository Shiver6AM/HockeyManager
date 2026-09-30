/** Season day 0 is the first Tuesday of October. */
export function dayDate(season: number, day: number): Date {
  const start = new Date(season, 9, 1);
  const offset = (2 - start.getDay() + 7) % 7; // first Tuesday
  return new Date(season, 9, 1 + offset + day);
}

export function dayLabel(season: number, day: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return dayDate(season, day).toLocaleDateString(undefined, opts);
}

export const money = (n: number) => `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;

export function toi(seconds: number, games = 1) {
  const s = Math.round(seconds / Math.max(1, games));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const svPct = (sa: number, ga: number) => (sa ? (1 - ga / sa).toFixed(3).replace(/^0/, '') : '—');
export const gaa = (ga: number, toiSec: number) => (toiSec ? ((ga * 3600) / toiSec).toFixed(2) : '—');
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export const PHASE_LABEL: Record<string, string> = {
  'regular-season': 'Regular season',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
};

export function timeUntil(date: string | Date | null | undefined): string | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 0) return 'any moment';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
}

/** Readable text color on top of a team color. */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b1220' : '#ffffff';
}

export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  // Zod errors arrive as a JSON array string.
  try {
    const parsed = JSON.parse(msg);
    if (Array.isArray(parsed) && parsed[0]?.message) return parsed.map((x: { path?: string[]; message: string }) => `${x.path?.join('.') ?? ''} ${x.message}`.trim()).join('; ');
  } catch {
    /* not JSON */
  }
  return msg;
}

/** 74 → 6'2" */
export const ht = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

/** Every position he plays, his main one first ("C/RW"). */
export const posLabel = (p: { pos: string; altPos?: string[] }) => [p.pos, ...(p.altPos ?? [])].join('/');
