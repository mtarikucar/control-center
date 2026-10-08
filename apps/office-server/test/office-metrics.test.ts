import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { RENUDGE_MS } from '../src/company/dispatcher.ts';
import { officeMetrics } from '../src/company/office-metrics.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], now);
  const metrics = () => officeMetrics({ db: s.db, roster: s.roster, tasks: c.tasks }, clock);
  const advance = (ms: number) => void (clock += ms);
  return { ...s, ...c, metrics, advance, now };
}

describe('office metrics — busy', () => {
  it('in progress or blocked is busy; the coordinator and the archived are not counted; idle since the last finish, else the hire', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const deniz = t.company.hire(c.id, { name: 'Deniz', role: 'r', title: 'Testçi' });
    const gone = t.company.hire(c.id, { name: 'Eski', role: 'r' });
    t.roster.update(gone.id, { lifecycle: 'archived' });
    // The coordinator at work counts for nobody.
    t.company.start(t.company.createTask(OWNER, { assignee: c.id, title: 'Plan' }).id);
    t.company.start(t.company.createTask(c.id, { assignee: ada.id, title: 'A' }).id);
    const b = t.company.createTask(c.id, { assignee: can.id, title: 'B' });
    t.company.start(b.id);
    t.company.update(can.id, b.id, { blocked: true });
    const d = t.company.createTask(c.id, { assignee: deniz.id, title: 'D' });
    t.company.start(d.id);
    t.advance(HOUR);
    t.company.finish(deniz.id, d.id, { summary: 'd', outputs: [], learned: '' });
    t.advance(HOUR);
    const selin = t.company.hire(c.id, { name: 'Selin', role: 'r' });
    // A task in the queue is not work in hand: Deniz is still idle.
    t.company.createTask(c.id, { assignee: deniz.id, title: 'E' });
    t.advance(5 * HOUR);

    expect(t.metrics().busy).toEqual({
      busy: 2,
      total: 4,
      idle: [
        { id: deniz.id, name: 'Deniz', title: 'Testçi', since: T0 + HOUR },
        { id: selin.id, name: 'Selin', title: '', since: T0 + 2 * HOUR },
      ],
    });
  });

  it('the longest idle comes first', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    t.company.start(a.id);
    t.advance(HOUR);
    t.company.finish(ada.id, a.id, { summary: 'a', outputs: [], learned: '' });
    expect(t.metrics().busy.idle).toEqual([
      { id: can.id, name: 'Can', title: '', since: T0 },
      { id: ada.id, name: 'Ada', title: '', since: T0 + HOUR },
    ]);
  });
});

describe('office metrics — delivered', () => {
  it('work done in the last 24 hours, reviews and hand-overs left out; the first-pass rate among the reviewed', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const deniz = t.company.hire(c.id, { name: 'Deniz', role: 'r' });
    const hand = (id: string) => t.company.finish(ada.id, id, { summary: 's', outputs: [], learned: '' });
    const decide = (decision: 'approve' | 'changes') => {
      const r = t.tasks.list({ assignee: can.id, statuses: ['waiting'] }).find((x) => x.kind === 'review')!;
      t.company.start(r.id);
      t.company.reviewDecide(can.id, r.id, decision === 'approve' ? { decision } : { decision, findings: [{ severity: 'important', text: 'eksik' }] });
    };
    // Done a day and an hour before the reading: outside the window.
    const old = t.company.createTask(c.id, { assignee: ada.id, title: 'Eski' });
    t.company.start(old.id);
    hand(old.id);
    t.advance(2 * HOUR);
    // A: sent back once, then approved — not a first pass.
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A', reviewer: can.id });
    t.company.start(a.id);
    hand(a.id);
    decide('changes');
    t.company.start(a.id);
    hand(a.id);
    decide('approve');
    // B: approved at once.
    const b = t.company.createTask(c.id, { assignee: ada.id, title: 'B', reviewer: can.id });
    t.company.start(b.id);
    hand(b.id);
    decide('approve');
    // C: no reviewer — delivered, not counted in the rate.
    const cTask = t.company.createTask(c.id, { assignee: ada.id, title: 'C' });
    t.company.start(cTask.id);
    hand(cTask.id);
    // D: handed in, still waiting for its reviewer — not delivered yet.
    const d = t.company.createTask(c.id, { assignee: ada.id, title: 'D', reviewer: can.id });
    t.company.start(d.id);
    hand(d.id);
    // Deniz's hand-over is done: not work.
    const handover = t.company.beginHandover(deniz.id);
    t.company.start(handover.id);
    t.company.finish(deniz.id, handover.id, { summary: 'devir', outputs: [], learned: '' });
    t.advance(23 * HOUR);

    expect(t.tasks.list({ statuses: ['done'] }).filter((x) => x.kind === 'review')).toHaveLength(3);
    expect(t.metrics().delivered).toEqual({ count: 3, firstPassRate: 0.5, windowHours: 24 });
  });

  it('no first-pass rate until something delivered was reviewed', () => {
    const t = make();
    expect(t.metrics().delivered).toEqual({ count: 0, firstPassRate: null, windowHours: 24 });
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    t.company.start(a.id);
    t.company.finish(ada.id, a.id, { summary: 's', outputs: [], learned: '' });
    expect(t.metrics().delivered).toEqual({ count: 1, firstPassRate: null, windowHours: 24 });
  });
});

describe('office metrics — stuck', () => {
  it('blocked, then past due, then reminded and still not moving after the re-nudge window; each task once, in that order', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [mert, ece, ali, su, nur] = ['Mert', 'Ece', 'Ali', 'Su', 'Nur'].map((name) => t.company.hire(c.id, { name, role: 'r' }));
    const remind = (id: string, at: number | null = t.now()) => t.tasks.update(id, { nudged: true, nudgedAt: at });
    // B1: blocked, and later past due too — counted once, as blocked.
    const b1 = t.company.createTask(c.id, { assignee: mert!.id, title: 'B1', dueAt: '+1h' });
    t.company.start(b1.id);
    t.company.update(mert!.id, b1.id, { blocked: true });
    t.advance(MIN);
    // B2: waiting past its due time.
    const b2 = t.company.createTask(c.id, { assignee: ece!.id, title: 'B2', dueAt: '+30m' });
    t.advance(MIN);
    // B3: reminded long ago and still in progress.
    const b3 = t.company.createTask(c.id, { assignee: ali!.id, title: 'B3' });
    t.company.start(b3.id);
    remind(b3.id);
    t.advance(MIN);
    // B4: reminded long ago and past due: past due comes first.
    const b4 = t.company.createTask(c.id, { assignee: su!.id, title: 'B4', dueAt: '+20m' });
    t.company.start(b4.id);
    remind(b4.id);
    t.advance(MIN);
    // B5: a reminder from before its time was kept counts as long ago (as the dispatcher reads it).
    const b5 = t.company.createTask(c.id, { assignee: nur!.id, title: 'B5' });
    t.company.start(b5.id);
    remind(b5.id, null);
    t.advance(MIN);
    // Not stuck: reminded only ten minutes before the reading, never reminded, done after its due time, parked.
    const fresh = t.company.createTask(c.id, { assignee: ece!.id, title: 'Taze' });
    t.company.start(fresh.id);
    t.company.start(t.company.createTask(c.id, { assignee: mert!.id, title: 'Sürüyor' }).id);
    const late = t.company.createTask(c.id, { assignee: ali!.id, title: 'Geç bitti', dueAt: '+10m' });
    t.company.start(late.id);
    t.advance(20 * MIN);
    t.company.finish(ali!.id, late.id, { summary: 's', outputs: [], learned: '' });
    const parked = t.company.createTask(c.id, { assignee: su!.id, title: 'Park' });
    t.company.start(parked.id);
    t.company.parkTask(su!.id, parked.id, '+3h', 'pencere');
    t.advance(55 * MIN);
    remind(fresh.id);
    t.advance(10 * MIN);

    expect(t.metrics().stuck).toEqual({
      count: 5,
      items: [
        { taskId: b1.id, title: 'B1', assignee: 'Mert', reason: 'blocked' },
        { taskId: b2.id, title: 'B2', assignee: 'Ece', reason: 'overdue' },
        { taskId: b4.id, title: 'B4', assignee: 'Su', reason: 'overdue' },
        { taskId: b3.id, title: 'B3', assignee: 'Ali', reason: 'stalled' },
        { taskId: b5.id, title: 'B5', assignee: 'Nur', reason: 'stalled' },
      ],
    });
  });

  it('a reminder is "still not moving" exactly at the dispatcher’s re-nudge window', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    t.company.start(a.id);
    t.tasks.update(a.id, { nudged: true, nudgedAt: t.now() });
    t.advance(RENUDGE_MS - 1);
    expect(t.metrics().stuck).toEqual({ count: 0, items: [] });
    t.advance(1);
    expect(t.metrics().stuck).toEqual({ count: 1, items: [{ taskId: a.id, title: 'A', assignee: 'Ada', reason: 'stalled' }] });
  });
});
