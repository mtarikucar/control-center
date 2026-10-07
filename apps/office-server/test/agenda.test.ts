import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const MIN = 60_000;

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r' });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget, now });
  /** A finished task that took `minutes`, for the estimates. */
  const history = (assignee: string, minutes: number, difficulty?: 'easy' | 'hard') => {
    const t = c.company.createTask(coordinator.id, { assignee, title: `geçmiş ${minutes}`, difficulty });
    c.tasks.update(t.id, { status: 'in_progress', startedAt: clock - minutes * MIN - 1000 });
    c.tasks.update(t.id, { status: 'done', finishedAt: clock - 1000 });
  };
  return { ...s, ...c, coordinator, ada, can, agenda, history, advance: (ms: number) => (clock += ms) };
}

describe('Agenda (spec §6.1)', () => {
  it('review focus: a fresh office — no history — estimates with the constitution default and says so', () => {
    const t = make();
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İlk iş' });
    const ada = t.agenda.forEmployee(t.ada.id);
    expect(ada.entries).toHaveLength(1);
    expect(ada.entries[0]).toMatchObject({ kind: 'queued', title: 'İlk iş', at: T0, until: T0 + 45 * MIN, basis: 'varsayılan', lowConfidence: false });
  });

  it('chains the queue in delivery order with medians from the employee’s history, by difficulty when it has enough samples', () => {
    const t = make();
    for (const m of [20, 30, 40]) t.history(t.ada.id, m, 'easy');
    for (const m of [90, 100, 110]) t.history(t.ada.id, m, 'hard');
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Süren', difficulty: 'easy' });
    t.company.start(running.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Zor', difficulty: 'hard', priority: 2 });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Sıradan', priority: 3 });
    const [now, zor, siradan] = t.agenda.forEmployee(t.ada.id).entries;
    expect(now).toMatchObject({ kind: 'now', title: 'Süren', at: T0, until: T0 + 30 * MIN, basis: 'zorluk: kolay, 3 iş' });
    expect(zor).toMatchObject({ kind: 'queued', title: 'Zor', at: T0 + 30 * MIN, until: T0 + 130 * MIN, basis: 'zorluk: zor, 3 iş' });
    expect(siradan).toMatchObject({ kind: 'queued', title: 'Sıradan', at: T0 + 130 * MIN, basis: 'son 6 iş' });
    expect(siradan!.until! - siradan!.at!).toBe(65 * MIN); // median of 20,30,40,90,100,110
  });

  it('review focus: a dependency on another employee’s unfinished task shows "X bitince" with low confidence, after X’s estimated end', () => {
    const t = make();
    t.history(t.can.id, 60);
    const theirs = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'Can’ın işi' });
    t.company.start(theirs.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Bağımlı', dependsOn: [theirs.id] });
    const entry = t.agenda.forEmployee(t.ada.id).entries[0]!;
    expect(entry).toMatchObject({ kind: 'queued', title: 'Bağımlı', note: '“Can’ın işi” bitince', lowConfidence: true, at: T0 + 60 * MIN });
  });

  it('two employees whose queued tasks wait on each other’s other tasks: both agendas render, the dependent entries low confidence (R6)', () => {
    const t = make();
    const t1 = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'T1' });
    const t2 = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'T2' });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'T3', dependsOn: [t2.id] });
    t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'T4', dependsOn: [t1.id] });
    for (const read of [() => t.agenda.report().employees, () => [t.agenda.forEmployee(t.ada.id), t.agenda.forEmployee(t.can.id)]]) {
      const people = read();
      const ada = people.find((e) => e.id === t.ada.id)!;
      const can = people.find((e) => e.id === t.can.id)!;
      expect(ada.entries.map((e) => e.title)).toEqual(['T1', 'T3']);
      expect(can.entries.map((e) => e.title)).toEqual(['T2', 'T4']);
      expect(ada.entries[1]).toMatchObject({ note: '“T2” bitince', lowConfidence: true, at: T0 + 45 * MIN });
      expect(can.entries[1]).toMatchObject({ note: '“T1” bitince', lowConfidence: true, at: T0 + 45 * MIN });
    }
    expect(t.agenda.text()).toContain('T4');
  });

  it('one report works each employee’s agenda out once, even when another’s waits on it', () => {
    const t = make();
    const theirs = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'Can’ın işi' });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Bağımlı', dependsOn: [theirs.id] });
    const reads: string[] = [];
    const list = t.tasks.list.bind(t.tasks);
    t.tasks.list = (o = {}) => {
      if (o.assignee) reads.push(o.assignee);
      return list(o);
    };
    t.agenda.report();
    expect(reads.filter((id) => id === t.can.id)).toHaveLength(1);
  });

  it('a task waiting on the same employee’s later task comes after it, as the dispatcher would hand them out', () => {
    const t = make();
    const first = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Önce', priority: 3 });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Sonra', priority: 1, dependsOn: [first.id] });
    const entries = t.agenda.forEmployee(t.ada.id).entries;
    expect(entries.map((e) => e.title)).toEqual(['Önce', 'Sonra']);
    expect(entries[0]).toMatchObject({ at: T0, until: T0 + 45 * MIN, lowConfidence: false });
    expect(entries[1]).toMatchObject({ at: T0 + 45 * MIN, note: '“Önce” bitince', lowConfidence: true });
  });

  it('ready work fills the wait for another employee’s task', () => {
    const t = make();
    t.history(t.can.id, 60);
    t.history(t.ada.id, 30);
    const theirs = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'Can’ın işi' });
    t.company.start(theirs.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Bağımlı', dependsOn: [theirs.id] });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Bağımsız' });
    const entries = t.agenda.forEmployee(t.ada.id).entries;
    expect(entries.map((e) => [e.title, e.at, e.until])).toEqual([
      ['Bağımsız', T0, T0 + 30 * MIN],
      ['Bağımlı', T0 + 60 * MIN, T0 + 90 * MIN],
    ]);
  });

  it('shows parked tasks at their return, start-timed tasks at their time, review waits, routines, and overdue in red', () => {
    const t = make();
    const parked = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Pencere' });
    t.company.parkTask(t.ada.id, parked.id, '+1d', 'ölçüm penceresi dolsun');
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Takip', startAfter: '+2h' });
    const reviewed = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İncelenen', reviewer: t.can.id });
    t.company.finish(t.ada.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    t.company.createSchedule(t.coordinator.id, { title: 'Günlük', assignee: t.ada.id, cron: '0 9 * * *' });
    const late = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Geç', dueAt: '+1h' });
    t.advance(2 * 60 * MIN);
    const entries = t.agenda.forEmployee(t.ada.id).entries;
    const by = (title: string) => entries.find((e) => e.title.startsWith(title))!;
    expect(by('Geç')).toMatchObject({ kind: 'queued', overdue: true, dueAt: late.dueAt });
    expect(by('Takip')).toMatchObject({ kind: 'queued' }); // its time came while we advanced
    expect(by('İncelenen')).toMatchObject({ kind: 'review_wait', note: 'Can’da, tur 1' });
    expect(by('Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN, note: 'ölçüm penceresi dolsun' });
    expect(by('Günlük')).toMatchObject({ kind: 'scheduled', note: 'her gün 09:00', at: new Date(2026, 9, 8, 9, 0).getTime() });
    // A parked task past its return but not yet returned by the clock still shows, as due now.
    t.advance(24 * 60 * MIN);
    expect(t.agenda.forEmployee(t.ada.id).entries.find((e) => e.title === 'Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN });
  });

  it('shows at most three runs of a routine within the horizon, none after its end', () => {
    const t = make();
    t.company.createSchedule(t.coordinator.id, { title: 'Günlük', assignee: t.ada.id, cron: '0 9 * * *' });
    t.company.createSchedule(t.coordinator.id, { title: 'Kısa', assignee: t.ada.id, cron: '0 10 * * *', until: '+2d' });
    const runs = (title: string) => t.agenda.forEmployee(t.ada.id).entries.filter((e) => e.title === title).map((e) => e.at);
    expect(runs('Günlük')).toEqual([8, 9, 10].map((d) => new Date(2026, 9, d, 9, 0).getTime()));
    expect(runs('Kısa')).toEqual([8, 9].map((d) => new Date(2026, 9, d, 10, 0).getTime()));
  });

  it('states sleeping, the reserve, pause and the limit; the report covers everyone and the clock', () => {
    const t = make();
    t.roster.update(t.can.id, { lifecycle: 'sleeping' });
    t.company.pause();
    const report = t.agenda.report();
    expect(report.employees.map((e) => e.name).sort()).toEqual(['Ada', 'Can', 'Koordinatör']);
    expect(report.employees.find((e) => e.name === 'Can')?.state).toContain('uyuyor');
    expect(report.employees.find((e) => e.name === 'Ada')?.state).toContain('duraklatıldı');
    expect(report.horizonMs).toBe(7 * 24 * 60 * MIN);
    expect(report.clock).toMatchObject({ nextDueAt: null });
    t.company.resume();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.99, resetsAt: T0 + 60 * MIN }, sevenDay: null, updatedAt: T0 });
    expect(t.agenda.forEmployee(t.ada.id).state).toContain('kota payı');
    t.roster.update(t.can.id, { lifecycle: 'limited', limitResetsAt: T0 + 6 * 60 * MIN });
    expect(t.agenda.forEmployee(t.can.id).state).toContain('limit doldu, açılış bugün 20:10');
  });

  it('writes the agenda as Turkish text for the coordinator', () => {
    const t = make();
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İlk iş' });
    const text = t.agenda.text(t.ada.id);
    expect(text).toContain('Ada');
    expect(text).toMatch(/Sırada: İlk iş .*~14:55/);
    expect(text).toContain('~45 dk · varsayılan');
    expect(t.agenda.text()).toContain('Koordinatör');
  });

  it('changes nothing it reads', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'İş' });
    const before = { task: t.tasks.get(task.id), seq: t.events.lastSeq() };
    t.agenda.report();
    t.agenda.text();
    expect({ task: t.tasks.get(task.id), seq: t.events.lastSeq() }).toEqual(before);
  });
});
