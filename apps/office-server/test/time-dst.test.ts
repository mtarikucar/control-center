// A zone with daylight saving; `TZ` must be set before the first `Date` call in the worker. The previous value is put
// back afterwards so the zone does not leak into another test file sharing the worker.
const previousTZ = process.env.TZ;
process.env.TZ = 'Europe/Berlin';
import { afterAll, describe, expect, it } from 'vitest';
import { nextCron, parseCron } from '../src/company/time.ts';

afterAll(() => {
  if (previousTZ === undefined) delete process.env.TZ;
  else process.env.TZ = previousTZ;
});

describe('cron across daylight saving (Europe/Berlin)', () => {
  it('runs in the zone it sets', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin');
  });

  it('skips a wall-clock time that does not exist on the spring-forward day', () => {
    // 29 Mar 2026: 02:00 → 03:00. "30 2 * * *" has no 02:30 that day; the next is 30 Mar 02:30.
    const spec = parseCron('30 2 * * *');
    const after = new Date(2026, 2, 28, 12, 0).getTime();
    const next = new Date(nextCron(spec, after));
    expect([next.getDate(), next.getMonth(), next.getHours(), next.getMinutes()]).toEqual([30, 2, 2, 30]);
  });

  it('fires once, not twice, on the fall-back day', () => {
    // 25 Oct 2026: 03:00 → 02:00; 02:30 happens twice. The first is chosen; the next is the day after.
    const spec = parseCron('30 2 * * *');
    const first = nextCron(spec, new Date(2026, 9, 24, 12, 0).getTime());
    const d = new Date(first);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([25, 2, 30]);
    const second = new Date(nextCron(spec, first));
    expect([second.getDate(), second.getHours(), second.getMinutes()]).toEqual([26, 2, 30]);
  });
});
