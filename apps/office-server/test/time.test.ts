import { describe, expect, it } from 'vitest';
import { cronLabel, formatWhen, minIntervalMinutes, nextCron, parseCron, parseUntil } from '../src/company/time.ts';

const T0 = new Date(2026, 9, 7, 14, 10).getTime(); // 7 Eki 2026 14:10 local
const PARK = { maxDays: 30, label: 'Dönüş saati' };

describe('parseUntil', () => {
  it('reads relative minutes, hours and days from now', () => {
    expect(parseUntil('+90m', T0, PARK)).toBe(T0 + 90 * 60_000);
    expect(parseUntil('+6h', T0, PARK)).toBe(T0 + 6 * 3_600_000);
    expect(parseUntil('+1d', T0, PARK)).toBe(T0 + 24 * 3_600_000);
    expect(parseUntil(' +2H ', T0, PARK)).toBe(T0 + 2 * 3_600_000);
  });

  it('reads a local wall-clock time in three spellings', () => {
    const want = new Date(2026, 9, 8, 14, 55).getTime();
    expect(parseUntil('2026-10-08T14:55', T0, PARK)).toBe(want);
    expect(parseUntil('2026-10-08 14:55', T0, PARK)).toBe(want);
    expect(parseUntil('2026-10-08T14:55:30', T0, PARK)).toBe(want + 30_000);
  });

  it('review focus: refuses the past, zero, nonsense, words, a zone suffix and too far ahead — in Turkish, naming the forms', () => {
    for (const bad of ['+0h', '+0m', '2026-10-07T14:10', '2026-10-07T09:00', '2026-13-40T99:99', 'yarın', '2026-10-08T14:55Z', '2026-10-08T14:55+03:00', '+31d', '+745h', '', 'h+2']) {
      expect(() => parseUntil(bad, T0, PARK), bad).toThrow(/Dönüş saati.*(\+6h|2026-10-08T14:55|gelecekte|en fazla 30 gün)/);
    }
    expect(parseUntil('+30d', T0, PARK)).toBe(T0 + 30 * 24 * 3_600_000);
    expect(() => parseUntil('+400d', T0, { maxDays: 365, label: 'Son tarih' })).toThrow(/Son tarih en fazla 365 gün/);
  });

  it('review focus: takes a relative number of any length, and a too-large one is refused by the day bound, never accepted', () => {
    expect(parseUntil('+43200m', T0, PARK)).toBe(T0 + 30 * 24 * 3_600_000);
    expect(parseUntil('+10000m', T0, PARK)).toBe(T0 + 10_000 * 60_000);
    expect(() => parseUntil('+43201m', T0, PARK)).toThrow(/Dönüş saati en fazla 30 gün/);
    expect(() => parseUntil(`+${'9'.repeat(30)}m`, T0, PARK)).toThrow(/Dönüş saati en fazla 30 gün/);
    expect(() => parseUntil(`+${'9'.repeat(400)}d`, T0, PARK)).toThrow(/Dönüş saati en fazla 30 gün/); // Number(…) is Infinity
  });
});

describe('formatWhen', () => {
  it('says today, tomorrow, or the day and month; the year only when it differs', () => {
    expect(formatWhen(new Date(2026, 9, 7, 16, 5).getTime(), T0)).toBe('bugün 16:05');
    expect(formatWhen(new Date(2026, 9, 8, 9, 0).getTime(), T0)).toBe('yarın 09:00');
    expect(formatWhen(new Date(2026, 9, 12, 14, 55).getTime(), T0)).toBe('12 Eki 14:55');
    expect(formatWhen(new Date(2027, 0, 3, 8, 30).getTime(), T0)).toBe('3 Oca 2027 08:30');
    expect(formatWhen(new Date(2026, 9, 6, 18, 0).getTime(), T0)).toBe('6 Eki 18:00');
  });
});

describe('cron', () => {
  it('parses the five fields with *, lists, ranges and steps; refuses anything else in Turkish', () => {
    expect(parseCron('0 9 * * 1-5').fields.dow).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('*/15 * * * *').fields.minute).toEqual([0, 15, 30, 45]);
    expect(parseCron('30 8,18 1,15 * *').fields.hour).toEqual([8, 18]);
    expect(parseCron('0 0 * * 7').fields.dow).toEqual([0]);
    for (const bad of ['0 9 * *', '60 9 * * *', '0 24 * * *', '0 9 32 * *', '0 9 * 13 *', '0 9 * * 8', 'a b c d e', '0 9 * * 1-', '']) {
      expect(() => parseCron(bad), bad).toThrow(/Zamanlama.*5 alan/);
    }
  });

  it('finds the next occurrence strictly after a time, in local time', () => {
    const daily9 = parseCron('0 9 * * *');
    expect(nextCron(daily9, T0)).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    expect(nextCron(daily9, new Date(2026, 9, 8, 9, 0).getTime())).toBe(new Date(2026, 9, 9, 9, 0).getTime());
    expect(nextCron(daily9, new Date(2026, 9, 8, 8, 59, 59).getTime())).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    const weekdays18 = parseCron('0 18 * * 1-5');
    // 7 Eki 2026 is a Wednesday → the same day 18:00; Friday 9 Eki 18:01 → Monday 12 Eki 18:00.
    expect(nextCron(weekdays18, T0)).toBe(new Date(2026, 9, 7, 18, 0).getTime());
    expect(nextCron(weekdays18, new Date(2026, 9, 9, 18, 1).getTime())).toBe(new Date(2026, 9, 12, 18, 0).getTime());
    const monthly = parseCron('0 10 31 * *');
    expect(nextCron(monthly, new Date(2026, 10, 1).getTime())).toBe(new Date(2026, 11, 31, 10, 0).getTime());
    expect(() => nextCron(parseCron('0 0 30 2 *'), T0)).toThrow(/366 gün/);
  });

  it('labels common patterns in Turkish and leaves the rest as cron', () => {
    expect(cronLabel(parseCron('0 9 * * *'))).toBe('her gün 09:00');
    expect(cronLabel(parseCron('30 18 * * 1-5'))).toBe('hafta içi 18:30');
    expect(cronLabel(parseCron('0 10 * * 1'))).toBe('her Pazartesi 10:00');
    expect(cronLabel(parseCron('0 * * * *'))).toBe('her saat');
    expect(cronLabel(parseCron('*/15 * * * *'))).toBe('her 15 dakikada');
    expect(cronLabel(parseCron('0 9 1 * *'))).toBe('her ayın 1. günü 09:00');
    expect(cronLabel(parseCron('0 9 10 * *'))).toBe('her ayın 10. günü 09:00');
    expect(cronLabel(parseCron('0 9,17 * * *'))).toBe('0 9,17 * * *');
  });

  it('measures the smallest gap between the first five occurrences', () => {
    expect(minIntervalMinutes(parseCron('*/15 * * * *'), T0)).toBe(15);
    expect(minIntervalMinutes(parseCron('0 9 * * *'), T0)).toBe(24 * 60);
    expect(minIntervalMinutes(parseCron('0 9,10 * * *'), T0)).toBe(60);
    expect(minIntervalMinutes(parseCron('0 0 30 2 *'), T0)).toBe(Number.POSITIVE_INFINITY);
  });
});
