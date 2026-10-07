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

/**
 * An office of `n` people made straight on the roster (more than the constitution lets the company hire), with an
 * agenda that counts its task reads.
 */
function office(n: number) {
  const s = setup(n + 1, () => T0);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, () => T0);
  const people = Array.from({ length: n }, (_, i) => s.roster.create({ name: `Kişi ${i}`, role: 'r' }));
  let lists = 0;
  const tasks = {
    list: (o?: Parameters<typeof c.tasks.list>[0]) => {
      lists += 1;
      return c.tasks.list(o);
    },
    get: (id: string) => c.tasks.get(id),
    durations: (o: Parameters<typeof c.tasks.durations>[0]) => c.tasks.durations(o),
  };
  const agenda = new Agenda({ roster: s.roster, tasks, schedules: c.schedules, company: c.company, now: () => T0 });
  const task = (assignee: string, title: string, dependsOn: string[] = []) =>
    c.tasks.create({ planId: null, title, description: '', done: [], requester: OWNER, assignee, priority: 3, dependsOn, chainDepth: 0 });
  /** Dependencies set after the fact, so a ring can close. */
  const dependOn = (taskId: string, ids: string[]) => s.db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(JSON.stringify(ids), taskId);
  const reads = (read: () => unknown) => {
    lists = 0;
    read();
    return lists;
  };
  return { people, agenda, task, dependOn, reads };
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

  it('one read works each agenda out once: a ring of ten whose tasks wait on the next one’s', () => {
    const o = office(10);
    const pairs = o.people.map((p) => [o.task(p.id, `${p.name} A`), o.task(p.id, `${p.name} B`)] as const);
    pairs.forEach(([a, b], i) => {
      const [nextA, nextB] = pairs[(i + 1) % pairs.length]!;
      o.dependOn(a.id, [nextB.id]);
      o.dependOn(b.id, [nextA.id]);
    });
    expect(o.reads(() => o.agenda.report())).toBeLessThanOrEqual(10 + 1);
    expect(o.reads(() => o.agenda.forEmployee(o.people[0]!.id))).toBeLessThanOrEqual(10 + 1);
    const report = o.agenda.report();
    expect(report.employees.every((e) => e.entries.length === 2 && e.entries.every((x) => x.lowConfidence))).toBe(true);
  });

  it('one read works each agenda out once: twenty people, fifteen tasks each, dependencies both ways', () => {
    const n = 20;
    const o = office(n);
    const rounds: string[][] = [];
    let deps = 0;
    for (let r = 0; r < 15; r += 1) {
      rounds.push(
        o.people.map((p, i) => {
          const wait = r > 0 && (i + r) % 3 === 0 ? [rounds[r - 1]![(i + (r % 2 ? 1 : n - 1)) % n]!] : [];
          deps += wait.length;
          return o.task(p.id, `${p.name} ${r}`, wait).id;
        }),
      );
    }
    expect(deps).toBeGreaterThanOrEqual(90);
    expect(o.reads(() => o.agenda.report())).toBeLessThanOrEqual(n + 1);
    expect(o.reads(() => o.agenda.forEmployee(o.people[7]!.id))).toBeLessThanOrEqual(n + 1);
    expect(o.agenda.report().employees.every((e) => e.entries.length === 15)).toBe(true);
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

  it('shows every started task, the stuck one marked, and queues after the latest end', () => {
    const t = make();
    const stuck = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Takılan' });
    t.company.start(stuck.id);
    t.company.update(t.ada.id, stuck.id, { blocked: true, note: 'şifre yok' });
    t.advance(10 * MIN);
    const started = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Süren' });
    t.company.start(started.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Sıradaki' });
    expect(t.agenda.forEmployee(t.ada.id).entries.map((e) => [e.kind, e.title, e.at, e.until, e.note])).toEqual([
      ['now', 'Takılan', T0, T0 + 45 * MIN, 'takıldı'],
      ['now', 'Süren', T0 + 10 * MIN, T0 + 55 * MIN, null],
      ['queued', 'Sıradaki', T0 + 55 * MIN, T0 + 100 * MIN, null],
    ]);
    expect(t.agenda.text(t.ada.id)).toMatch(/Şimdi: Takılan .*takıldı/);
    t.advance(50 * MIN);
    expect(t.agenda.forEmployee(t.ada.id).entries[0]).toMatchObject({ title: 'Takılan', note: 'takıldı · uzuyor' });
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
    expect(by('İncelenen')).toMatchObject({ kind: 'review_wait', note: 'inceleyici: Can, tur 1' });
    expect(by('Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN, note: 'ölçüm penceresi dolsun' });
    expect(by('Günlük')).toMatchObject({ kind: 'scheduled', note: 'her gün 09:00', at: new Date(2026, 9, 8, 9, 0).getTime() });
    // A parked task past its return but not yet returned by the clock still shows, as due now.
    t.advance(24 * 60 * MIN);
    expect(t.agenda.forEmployee(t.ada.id).entries.find((e) => e.title === 'Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN });
  });

  it('final review F2: a park or start time past the horizon still shows, in the list and the text; a routine run past it does not', () => {
    const t = make();
    const parked = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Uzak park' });
    t.company.parkTask(t.ada.id, parked.id, '+10d', 'ay sonu verisi');
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Uzak başlangıç', startAfter: '+20d' });
    t.company.createSchedule(t.coordinator.id, { title: 'Ayın 15i', assignee: t.ada.id, cron: '0 9 15 * *' });
    const entries = t.agenda.forEmployee(t.ada.id).entries;
    expect(entries.find((e) => e.title === 'Uzak park')).toMatchObject({ kind: 'parked', at: T0 + 10 * 24 * 60 * MIN });
    expect(entries.find((e) => e.title === 'Uzak başlangıç')).toMatchObject({ kind: 'not_before', at: T0 + 20 * 24 * 60 * MIN });
    // 15 October 09:00 is eight days out: past the seven-day horizon.
    expect(entries.some((e) => e.title === 'Ayın 15i')).toBe(false);
    const text = t.agenda.text(t.ada.id);
    expect(text).toContain('Uzak park');
    expect(text).toContain('Uzak başlangıç');
    expect(text).not.toContain('Ayın 15i');
  });

  it('final review F4/F7: the text says Ertelendi for a park and names the reviewer without a suffix', () => {
    const t = make();
    const parked = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Pencere' });
    t.company.parkTask(t.ada.id, parked.id, '+1d', 'ölçüm penceresi dolsun');
    const reviewed = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İncelenen', reviewer: t.can.id });
    t.company.finish(t.ada.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    const text = t.agenda.text(t.ada.id);
    expect(text).toContain('Ertelendi: Pencere (yarın 14:10) — ölçüm penceresi dolsun');
    expect(text).not.toContain('Park:');
    expect(text).toContain('İnceleme bekliyor: İncelenen — inceleyici: Can, tur 1');
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
