import { ValidationError } from '../errors.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A time an employee or the owner gives (spec §4.2): relative (`+30m`, `+6h`, `+1d`) or a local wall-clock time
 * (`2026-10-08T14:55`, `2026-10-08 14:55`, with optional seconds). No zone: the machine's local time. Must lie in the
 * future and within `maxDays`.
 */
export function parseUntil(value: string, now: number, o: { maxDays: number; label: string }): number {
  const text = (value ?? '').trim();
  const forms = `${o.label} gelecekte bir zaman olmalı: göreli (+30m, +6h, +1d) ya da yerel saat (2026-10-08T14:55 ya da 2026-10-08 14:55)`;
  let at: number;
  const rel = /^\+(\d+)\s*([mhdMHD])$/.exec(text);
  const abs = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (rel) {
    // No digit cap: a huge number becomes a huge (or Infinity) time, which the maxDays check below refuses.
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    at = now + n * (unit === 'm' ? MINUTE : unit === 'h' ? HOUR : DAY);
  } else if (abs) {
    const [y, mo, d, h, mi, s] = abs.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
    const date = new Date(y, mo - 1, d, h, mi, s);
    // A rolled-over date (month 13, hour 99) is not the date that was written.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) throw new ValidationError(`${forms}.`);
    at = date.getTime();
  } else {
    throw new ValidationError(`${forms}.`);
  }
  if (at <= now) throw new ValidationError(`${forms}; verilen zaman geçmişte ya da şimdi.`);
  if (at - now > o.maxDays * DAY) throw new ValidationError(`${o.label} en fazla ${o.maxDays} gün ileri olabilir.`);
  return at;
}

/** "bugün 14:55", "yarın 09:00", "12 Eki 14:55", "3 Oca 2027 08:30" — local time, relative to `now`. */
export function formatWhen(ms: number, now: number): string {
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, n)) return `bugün ${time}`;
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (sameDay(d, tomorrow)) return `yarın ${time}`;
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${time}`;
}

/** "8 Eki 2026 09:00" — the moment itself, local time, never relative: for titles and notes read on any later day. */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface CronSpec {
  expr: string;
  fields: { minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[] };
  /** `*` was given (the field restricts nothing). */
  any: { dom: boolean; dow: boolean };
}

const RANGES = { minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 7] } as const;

function field(name: keyof typeof RANGES, text: string): { values: number[]; any: boolean } {
  const [lo, hi] = RANGES[name];
  const out = new Set<number>();
  let any = false;
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(part);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(part);
    let from: number = lo;
    let to: number = hi;
    if (m[1] !== '*') {
      const [a, b] = m[1]!.split('-').map(Number) as [number, number | undefined];
      from = a;
      to = b ?? (m[2] === undefined ? a : hi);
      if (from < lo || to > hi || from > to) throw new Error(part);
    } else if (m[2] === undefined) any = true;
    for (let v = from; v <= to; v += step) out.add(name === 'dow' && v === 7 ? 0 : v);
  }
  return { values: [...out].sort((a, b) => a - b), any };
}

/** Five fields — minute hour day-of-month month day-of-week — with `*`, lists, ranges and steps; 7 = Sunday too. */
export function parseCron(expr: string): CronSpec {
  const parts = (expr ?? '').trim().split(/\s+/);
  const why = 'Zamanlama (cron) 5 alan olmalı: dakika saat ay-günü ay hafta-günü; ör. "0 9 * * 1-5" (hafta içi 09:00).';
  if (parts.length !== 5 || parts.some((p) => p === '')) throw new ValidationError(why);
  try {
    const minute = field('minute', parts[0]!);
    const hour = field('hour', parts[1]!);
    const dom = field('dom', parts[2]!);
    const month = field('month', parts[3]!);
    const dow = field('dow', parts[4]!);
    return { expr: parts.join(' '), fields: { minute: minute.values, hour: hour.values, dom: dom.values, month: month.values, dow: dow.values }, any: { dom: dom.any, dow: dow.any } };
  } catch {
    throw new ValidationError(why);
  }
}

/** Standard cron: when both day fields are restricted, a day matches if either does. */
function dayMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.fields.month.includes(d.getMonth() + 1)) return false;
  const domOk = spec.fields.dom.includes(d.getDate());
  const dowOk = spec.fields.dow.includes(d.getDay());
  if (spec.any.dom && spec.any.dow) return true;
  if (spec.any.dom) return dowOk;
  if (spec.any.dow) return domOk;
  return domOk || dowOk;
}

/**
 * The first occurrence strictly after `afterMs`, in local time. A wall-clock time that does not exist (spring forward)
 * is skipped; one that happens twice (fall back) yields its first instant, so a routine fires at most once for it.
 */
export function nextCron(spec: CronSpec, afterMs: number): number {
  const after = new Date(afterMs);
  // The same wall-clock minute as `after` is never "next": on the fall-back day the repeated hour would fire twice.
  const sameMinute = (d: Date) =>
    d.getFullYear() === after.getFullYear() && d.getMonth() === after.getMonth() && d.getDate() === after.getDate() && d.getHours() === after.getHours() && d.getMinutes() === after.getMinutes();
  for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + dayOffset);
    if (!dayMatches(spec, day)) continue;
    for (const h of spec.fields.hour) {
      for (const m of spec.fields.minute) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        if (candidate.getHours() !== h || candidate.getMinutes() !== m) continue; // does not exist on this day
        if (candidate.getTime() > afterMs && !sameMinute(candidate)) return candidate.getTime();
      }
    }
  }
  throw new ValidationError('Bu zamanlama önümüzdeki 366 gün içinde hiç tetiklenmiyor.');
}

/** The smallest gap between the first five occurrences from `fromMs`, in minutes (Infinity with fewer than two). */
export function minIntervalMinutes(spec: CronSpec, fromMs: number): number {
  const times: number[] = [];
  let t = fromMs;
  for (let i = 0; i < 5; i += 1) {
    try {
      t = nextCron(spec, t);
    } catch {
      break;
    }
    times.push(t);
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < times.length; i += 1) min = Math.min(min, (times[i]! - times[i - 1]!) / MINUTE);
  return min;
}

/** A Turkish label for the common shapes; anything else stays as the cron text. */
export function cronLabel(spec: CronSpec): string {
  const { minute, hour, dom, month, dow } = spec.fields;
  const allDays = spec.any.dom && spec.any.dow && month.length === 12;
  const oneTime = minute.length === 1 && hour.length === 1;
  const time = oneTime ? `${pad(hour[0]!)}:${pad(minute[0]!)}` : '';
  if (oneTime && allDays) return `her gün ${time}`;
  if (oneTime && spec.any.dom && month.length === 12 && dow.join(',') === '1,2,3,4,5') return `hafta içi ${time}`;
  if (oneTime && spec.any.dom && month.length === 12 && dow.length === 1) return `her ${DAYS[dow[0]!]} ${time}`;
  if (oneTime && spec.any.dow && month.length === 12 && dom.length === 1) return `her ayın ${dom[0]}. günü ${time}`;
  if (minute.length === 1 && minute[0] === 0 && hour.length === 24 && allDays) return 'her saat';
  if (hour.length === 24 && allDays && minute.length > 1 && minute[0] === 0 && minute.every((m, i) => m === i * minute[1]!) && 60 % minute[1]! === 0) return `her ${minute[1]} dakikada`;
  return spec.expr;
}
