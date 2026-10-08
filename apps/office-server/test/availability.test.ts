import { afterEach, describe, expect, it } from 'vitest';
import { LIFECYCLES, OWNER } from '@cc/shared';
import { availability } from '../src/company/availability.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 60 * 60_000;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], now);
  const of = (id: string) => availability(s.roster.get(id), { tasks: c.tasks, state: c.state });
  return { ...s, ...c, of, advance: (ms: number) => void (clock += ms) };
}

describe('availability — one idle rule for the pulse and the top bar', () => {
  it('a quota limit, a failed session, stopped by the owner or in the owner’s terminal cannot take work; a sleeper can', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const cannot = new Set(['limited', 'error', 'stopped', 'in_terminal']);
    for (const lifecycle of LIFECYCLES.filter((l) => l !== 'archived')) {
      t.roster.update(ada.id, { lifecycle });
      expect([lifecycle, t.of(ada.id).canTakeWork]).toEqual([lifecycle, !cannot.has(lifecycle)]);
    }
  });

  it('without work since the latest of the hire, the last closed task and the last task moved away', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    expect(t.of(ada.id).idleSince).toBe(T0);
    t.advance(HOUR);
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    t.company.start(a.id);
    t.advance(HOUR);
    t.company.finish(ada.id, a.id, { summary: 's', outputs: [], learned: '' });
    expect(t.of(ada.id).idleSince).toBe(T0 + 2 * HOUR);
    const b = t.company.createTask(c.id, { assignee: ada.id, title: 'B' });
    t.advance(HOUR);
    t.company.assign(c.id, b.id, can.id);
    expect(t.of(ada.id).idleSince).toBe(T0 + 3 * HOUR);
  });
});
