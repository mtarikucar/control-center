import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
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
  const metrics = () => officeMetrics({ db: s.db, roster: s.roster, tasks: c.tasks, state: c.state }, clock);
  const advance = (ms: number) => void (clock += ms);
  return { ...s, ...c, metrics, advance, now };
}

describe('office metrics — busy', () => {
  it('the pulse’s idle rule: busy holds an open task, idle can take work and holds none (since the hire, last close or last task moved away), unavailable cannot take work', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const gone = t.company.hire(c.id, { name: 'Eski', role: 'r' });
    t.roster.update(gone.id, { lifecycle: 'archived' });
    const [ada, can, deniz, ece, bora, mert] = ['Ada', 'Can', 'Deniz', 'Ece', 'Bora', 'Mert'].map((name) => t.company.hire(c.id, { name, role: 'r', title: name === 'Deniz' ? 'Testçi' : '' }));
    // The coordinator at work counts for nobody.
    t.company.start(t.company.createTask(OWNER, { assignee: c.id, title: 'Plan' }).id);
    t.company.start(t.company.createTask(c.id, { assignee: ada!.id, title: 'A' }).id);
    const b = t.company.createTask(c.id, { assignee: can!.id, title: 'B' });
    t.company.start(b.id);
    t.company.update(can!.id, b.id, { blocked: true });
    // In the owner's terminal with a task in hand: cannot take work, so not busy and not idle either.
    t.company.start(t.company.createTask(c.id, { assignee: mert!.id, title: 'M' }).id);
    t.roster.update(mert!.id, { lifecycle: 'in_terminal' });
    const d = t.company.createTask(c.id, { assignee: deniz!.id, title: 'D' });
    t.company.start(d.id);
    const x = t.company.createTask(c.id, { assignee: ece!.id, title: 'X' });
    t.advance(HOUR);
    t.company.finish(deniz!.id, d.id, { summary: 'd', outputs: [], learned: '' });
    t.advance(HOUR);
    // A sleeper can take work (a task wakes them).
    const selin = t.company.hire(c.id, { name: 'Selin', role: 'r' });
    t.roster.update(selin.id, { lifecycle: 'sleeping' });
    t.advance(HOUR);
    // Ece's task moves to Bora: her idle stretch starts now; Bora holds a waiting task, which is work in hand.
    t.company.assign(c.id, x.id, bora!.id);
    t.advance(5 * HOUR);

    expect(t.metrics().busy).toEqual({
      busy: 3,
      total: 7,
      idle: [
        { id: deniz!.id, name: 'Deniz', title: 'Testçi', since: T0 + HOUR },
        { id: selin.id, name: 'Selin', title: '', since: T0 + 2 * HOUR },
        { id: ece!.id, name: 'Ece', title: '', since: T0 + 3 * HOUR },
      ],
      unavailable: [{ id: mert!.id, name: 'Mert', title: '', state: 'in_terminal' }],
    });
  });

  it('who cannot take work is listed with their state, whether or not they hold a task', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const states = ['limited', 'error', 'stopped', 'in_terminal'] as const;
    const people = states.map((state, i) => {
      const e = t.company.hire(c.id, { name: `K${i}`, role: 'r' });
      t.roster.update(e.id, { lifecycle: state });
      return e;
    });
    t.company.createTask(c.id, { assignee: people[0]!.id, title: 'bekleyen' });
    const m = t.metrics().busy;
    expect(m).toMatchObject({ busy: 0, total: 4, idle: [] });
    expect(m.unavailable).toEqual(people.map((e, i) => ({ id: e.id, name: e.name, title: '', state: states[i] })));
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
  it('blocked, then past due, then reminded and its holder not working; each task once, in that order', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [mert, ece, ali, su, nur] = ['Mert', 'Ece', 'Ali', 'Su', 'Nur'].map((name) => t.company.hire(c.id, { name, role: 'r' }));
    const remind = (id: string) => t.tasks.update(id, { nudged: true, nudgedAt: t.now() });
    // B1: blocked, and later past due too — counted once, as blocked.
    const b1 = t.company.createTask(c.id, { assignee: mert!.id, title: 'B1', dueAt: '+1h' });
    t.company.start(b1.id);
    t.company.update(mert!.id, b1.id, { blocked: true });
    t.advance(MIN);
    // B2: waiting past its due time.
    const b2 = t.company.createTask(c.id, { assignee: ece!.id, title: 'B2', dueAt: '+30m' });
    t.advance(MIN);
    // B3: the office had to remind, and the holder sits idle with it — however recent the reminder.
    const b3 = t.company.createTask(c.id, { assignee: ali!.id, title: 'B3' });
    t.company.start(b3.id);
    t.advance(MIN);
    // B4: reminded and past due: past due comes first.
    const b4 = t.company.createTask(c.id, { assignee: su!.id, title: 'B4', dueAt: '+20m' });
    t.company.start(b4.id);
    remind(b4.id);
    t.advance(MIN);
    // Not stuck: reminded but the holder is working on it, never reminded, done after its due time, parked.
    const working = t.company.createTask(c.id, { assignee: nur!.id, title: 'Çalışıyor' });
    t.company.start(working.id);
    remind(working.id);
    t.roster.update(nur!.id, { lifecycle: 'working' });
    t.company.start(t.company.createTask(c.id, { assignee: mert!.id, title: 'Sürüyor' }).id);
    const late = t.company.createTask(c.id, { assignee: ali!.id, title: 'Geç bitti', dueAt: '+10m' });
    t.company.start(late.id);
    t.advance(20 * MIN);
    t.company.finish(ali!.id, late.id, { summary: 's', outputs: [], learned: '' });
    const parked = t.company.createTask(c.id, { assignee: su!.id, title: 'Park' });
    t.company.start(parked.id);
    remind(parked.id);
    t.company.parkTask(su!.id, parked.id, '+3h', 'pencere');
    t.advance(64 * MIN);
    remind(b3.id);
    t.roster.update(ali!.id, { lifecycle: 'idle' });

    expect(t.metrics().stuck).toEqual({
      count: 4,
      items: [
        { taskId: b1.id, title: 'B1', assignee: 'Mert', reason: 'blocked' },
        { taskId: b2.id, title: 'B2', assignee: 'Ece', reason: 'overdue' },
        { taskId: b4.id, title: 'B4', assignee: 'Su', reason: 'overdue' },
        { taskId: b3.id, title: 'B3', assignee: 'Ali', reason: 'stalled' },
      ],
    });
  });

  it('a reminded task is stuck while its holder is not working, and clears when they work or it starts again', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    t.company.start(a.id);
    t.roster.update(ada.id, { lifecycle: 'idle' });
    expect(t.metrics().stuck).toEqual({ count: 0, items: [] });
    t.tasks.update(a.id, { nudged: true, nudgedAt: t.now() });
    const stalled = { count: 1, items: [{ taskId: a.id, title: 'A', assignee: 'Ada', reason: 'stalled' }] };
    expect(t.metrics().stuck).toEqual(stalled);
    // A sleeper or a quota limit is not working either.
    for (const lifecycle of ['sleeping', 'limited'] as const) {
      t.roster.update(ada.id, { lifecycle });
      expect(t.metrics().stuck).toEqual(stalled);
    }
    t.roster.update(ada.id, { lifecycle: 'working' });
    expect(t.metrics().stuck.count).toBe(0);
    t.roster.update(ada.id, { lifecycle: 'idle' });
    expect(t.metrics().stuck).toEqual(stalled);
    // Handed out again: a fresh start, no reminder.
    t.company.start(a.id);
    expect(t.metrics().stuck.count).toBe(0);
  });
});
